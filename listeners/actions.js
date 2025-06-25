// listeners/actions.js
// Handles interactive component actions, like button clicks.

const db = require('../db');
const CONFIG = require('../config');
const { createCalendarEvent, getAuthUrl } = require('../utils/google-calendar');

const registerActionListeners = (app) => {
    // --- User clicks the "Join Event" button on an announcement ---
    app.action('join_event_button', async ({ ack, body, client, context, logger }) => {
        await ack();
        
        const userId = body.user.id;
        const eventId = body.actions[0].value; 

        try {
            const event = await db.findSessionById(eventId);
            if (!event) throw new Error("Could not find the event for this message.");

            const isAlreadyOnList = event.rosters.some(r => r.players.some(p => p.id === userId)) || event.standby.some(p => p.id === userId);
            if (isAlreadyOnList) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: body.channel.id, user: userId, text: "It appears you are already on the roster or standby list for this event." });
                return;
            }
            
            // --- FIX: Use a more robust calculation for spots taken ---
            const getSpotsLeft = (roster) => {
                const spotsTaken = roster.players.reduce((total, player) => {
                    const guests = Number(player.plusOneCount) || 0;
                    return total + 1 + guests;
                }, 0);
                return roster.capacity - spotsTaken;
            };

            const availableRosters = event.rosters
                .filter(r => getSpotsLeft(r) > 0)
                .map(r => ({
                    text: { type: 'plain_text', text: `${r.name} (${getSpotsLeft(r)} spots left)` },
                    value: r.id,
                    allowPlusOne: r.allowPlusOne
                }));

            // No spots left on any roster
            if (availableRosters.length === 0) {
                 await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: body.channel.id, user: userId, text: "My apologies, but all positions for this event are currently filled. I have added you to the standby list."});
                 const userInfoResponse = await client.users.info({ user: userId });
                 const playerObject = { id: userId, email: userInfoResponse.user?.profile?.email || null, plusOneCount: 0 };
                 event.standby.push(playerObject);
                 await db.setSessionState(event);
                 const channelConfig = await db.getChannelConfig(body.channel.id);
                 await require('../utils/slack-messages').updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);
                 return;
            }
            
            // Guest selection block with radio buttons
            const guestSelectionBlock = {
                type: 'input',
                block_id: 'guest_selection_block',
                label: { type: 'plain_text', text: 'Are you bringing guests?' },
                element: {
                    type: 'radio_buttons',
                    action_id: 'guest_selection_input',
                    initial_option: { text: { type: 'plain_text', text: 'Just me' }, value: '0' },
                    options: [
                        { text: { type: 'plain_text', text: 'Just me' }, value: '0' },
                        { text: { type: 'plain_text', text: 'Plus One (+1)' }, value: '1' },
                        { text: { type: 'plain_text', text: 'Plus Two (+2)' }, value: '2' },
                    ]
                }
            };
            
            // Case 1: Exactly one roster is available
            if (availableRosters.length === 1) {
                const soleRosterInfo = availableRosters[0];
                const rosterToJoin = event.rosters.find(r => r.id === soleRosterInfo.value);

                // Sub-case 1A: The sole roster does NOT allow guests. Join directly.
                if (!rosterToJoin.allowPlusOne) {
                    const userInfoResponse = await client.users.info({ user: userId });
                    const playerObject = { id: userId, email: userInfoResponse.user?.profile?.email || null, plusOneCount: 0 };
                    
                    rosterToJoin.players.push(playerObject);
                    await db.setSessionState(event);

                    const channelConfig = await db.getChannelConfig(body.channel.id);
                    await require('../utils/slack-messages').updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);
                    
                    await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: body.channel.id, user: userId, text: `Excellent. I have added you to the roster for *${rosterToJoin.name}*.` });
                    return;
                } 
                // Sub-case 1B: The sole roster DOES allow guests. Open a simplified modal.
                else {
                     await client.views.open({
                        trigger_id: body.trigger_id,
                        view: {
                            type: 'modal',
                            callback_id: 'join_roster_view',
                            private_metadata: JSON.stringify({ eventId: event._id, singleRosterId: soleRosterInfo.value }),
                            title: { type: 'plain_text', text: 'Join an Engagement' },
                            submit: { type: 'plain_text', text: 'Confirm' },
                            blocks: [
                                { type: 'section', text: { type: 'mrkdwn', text: `You are joining *${rosterToJoin.name}* for the event: *${event.title}*.` } },
                                guestSelectionBlock
                            ]
                        }
                    });
                    return;
                }
            }
            
            // Case 2: Multiple rosters are available. Open the full modal.
            if (availableRosters.length > 1) {
                let viewBlocks = [
                    { type: 'section', text: { type: 'mrkdwn', text: `You are joining the event: *${event.title}*.` } },
                    { type: 'input', block_id: 'roster_select_block', label: { type: 'plain_text', text: 'Please select a roster' }, element: { type: 'static_select', action_id: 'roster_select_input', options: availableRosters.map(({text, value}) => ({text, value})) } },
                    { type: 'context', elements: [{type: 'mrkdwn', text: "Note: The option to bring guests may only be available for specific rosters."}] },
                    guestSelectionBlock
                ];

                await client.views.open({
                    trigger_id: body.trigger_id,
                    view: {
                        type: 'modal',
                        callback_id: 'join_roster_view',
                        private_metadata: JSON.stringify({ eventId: event._id, singleRosterId: null }),
                        title: { type: 'plain_text', text: 'Join an Engagement' },
                        submit: { type: 'plain_text', text: 'Confirm' },
                        blocks: viewBlocks
                    }
                });
            }

        } catch (error) {
            logger.error("Error in join_event_button action:", error);
        }
    });

    // --- User clicks the "Add Roster/Tier" button in the Roster Editor ---
    app.action('add_roster_button', async ({ ack, body, client, logger }) => {
        await ack();
        try {
            await client.views.push({
                trigger_id: body.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'add_roster_view',
                    private_metadata: body.view.private_metadata,
                    title: { type: 'plain_text', text: 'Add a Roster' },
                    submit: { type: 'plain_text', text: 'Add' },
                    blocks: [
                        { type: 'input', block_id: 'roster_name_block', label: { type: 'plain_text', text: 'Roster Name' }, element: { type: 'plain_text_input', action_id: 'roster_name_input', placeholder: { type: 'plain_text', text: 'e.g., Court 1, Skybox' } } },
                        { type: 'input', block_id: 'roster_capacity_block', label: { type: 'plain_text', text: 'Capacity' }, element: { type: 'number_input', is_decimal_allowed: false, action_id: 'roster_capacity_input' } },
                        {
                            "type": "input",
                            "block_id": "plus_one_block",
                            "optional": true,
                            "element": {
                                "type": "checkboxes",
                                "options": [
                                    {
                                        "text": { "type": "mrkdwn", "text": "Allow guests for this roster (+1, +2)" },
                                        "value": "allow_plus_one"
                                    }
                                ],
                                "action_id": "plus_one_input"
                            },
                            "label": { "type": "plain_text", "text": "Guest Policy" }
                        }
                    ]
                }
            });
        } catch (error) {
            logger.error("Error opening add_roster_view modal:", error);
        }
    });

    // --- User clicks the "Add to Google Calendar" button ---
    app.action('add_to_gcal_button', async ({ ack, body, client, logger }) => {
        await ack();

        const userId = body.user.id;
        const channelId = body.channel.id;
        const eventId = body.actions[0].value;

        try {
            const event = await db.findSessionById(eventId);
            if (!event) throw new Error("Could not find the original event.");

            const isUserParticipant =
                (event.rosters || []).some(r => r.players.some(p => p.id === userId)) ||
                (event.standby || []).some(p => p.id === userId);

            if (!isUserParticipant) {
                await client.chat.postEphemeral({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: channelId,
                    user: userId,
                    text: `You must first join the event using the 'Join Event' button before adding it to your calendar.`
                });
                return;
            }
            
            const tokenData = await db.getUserTokens(userId);
            if (!tokenData) {
                const authUrl = getAuthUrl(userId);
                await client.chat.postEphemeral({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: channelId,
                    user: userId,
                    text: "You must first connect your Google Account.",
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: "Before I can add this to your calendar, you must grant me permission. Please click the button below to sign in." } },
                        { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: 'Connect to Google Calendar', emoji: true }, url: authUrl, style: 'primary' } ] }
                    ]
                });
                return;
            }

            const calendarEvent = await createCalendarEvent(userId, event);
            
            await client.chat.postEphemeral({
                token: CONFIG.SLACK_BOT_TOKEN,
                channel: channelId,
                user: userId,
                text: `I have added *${event.title}* to your Google Calendar.`,
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `Very good. I have added *<${calendarEvent.htmlLink}|${event.title}>* to your primary Google Calendar.` } }
                ]
            });
        } catch (error) {
            logger.error("Error in add_to_gcal_button action:", error);
            await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: `My apologies, I encountered an error creating the calendar event: ${error.message}` });
        }
    });

    app.action('configure_channel_button', async ({ ack, body, client, logger }) => {
        await ack();
        
        try {
            const channelId = body.channel.id;
            const triggerId = body.trigger_id;

            const existingConfig = await db.getChannelConfig(channelId);
            const allProfiles = await db.getAllEventProfiles();
            
            if (allProfiles.length === 0) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: body.user.id, text: "My apologies, but no Event Profiles have been created yet. An administrator must first use `/create-profile`." });
                return;
            }

            const eventTypeOptions = allProfiles.map(p => ({ text: { type: 'plain_text', text: p._id }, value: p._id }));
            const initialEventTypeOption = existingConfig ? eventTypeOptions.find(opt => opt.value === existingConfig.defaultEventType) : undefined;
            const defaultReminderText = "A gentle reminder, esteemed combatants. Our engagement, *{eventTitle}*, is scheduled for tomorrow at {eventTime}. Pray, prepare accordingly. {weather}";

            await client.views.open({
                trigger_id: triggerId,
                view: {
                    type: 'modal',
                    callback_id: 'configure_channel_view',
                    private_metadata: JSON.stringify({ channelId }),
                    title: { type: 'plain_text', text: 'Channel Configuration' },
                    submit: { type: 'plain_text', text: 'Save Settings' },
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: `Configure my duties for <#${channelId}>.` } },
                        { type: 'input', block_id: 'default_event_type_block', label: { type: 'plain_text', text: 'Default Engagement Type' }, element: { type: 'static_select', action_id: 'default_event_type_input', options: eventTypeOptions, ...(initialEventTypeOption && { initial_option: initialEventTypeOption }) } },
                        { type: 'input', block_id: 'reaction_emoji_block', label: { type: 'plain_text', text: 'Reaction Emoji' }, element: { type: 'plain_text_input', action_id: 'reaction_emoji_input', initial_value: existingConfig?.reactionEmoji || CONFIG.DEFAULT_REACTION_EMOJI, placeholder: { type: 'plain_text', text: 'e.g., hand' } } },
                        { type: 'input', block_id: 'display_emoji_block', label: { type: 'plain_text', text: 'Display Emoji' }, element: { type: 'plain_text_input', action_id: 'display_emoji_input', initial_value: existingConfig?.displayEmoji || CONFIG.DEFAULT_DISPLAY_EMOJI, placeholder: { type: 'plain_text', text: 'e.g., scroll' } } },
                        {
                            type: 'input',
                            block_id: 'reminder_text_block',
                            label: { type: 'plain_text', text: 'Custom Reminder Message' },
                            element: {
                                type: 'plain_text_input',
                                multiline: true,
                                action_id: 'reminder_text_input',
                                initial_value: existingConfig?.reminderText || defaultReminderText,
                            },
                            hint: { type: 'plain_text', text: 'Use placeholders like {eventTitle}, {eventTime}, and {weather}.' }
                        }
                    ]
                }
            });
        } catch (error) {
            logger.error('Error opening configuration modal:', error);
        }
    });
};

module.exports = registerActionListeners;
