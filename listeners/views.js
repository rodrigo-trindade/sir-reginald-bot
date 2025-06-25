// listeners/views.js
// Handles submissions from interactive modals (views).

const crypto = require('crypto');
const { parse: parseDateFns, format: formatDate } = require('date-fns');
const db = require('../db');
const { formatEventMessage, updateAllEventMessages } = require('../utils/slack-messages');
const { buildRosterEditorView } = require('../utils/view-builder');
const CONFIG = require('../config');

const registerViewListeners = (app) => {
    /**
     * Handles submission of the 'Share Event' modal.
     */
    app.view('share_event_view', async ({ ack, body, view, client, logger }) => {
        await ack();
        const user = body.user.id;
        const { eventId } = JSON.parse(view.private_metadata);
        const targetChannelId = view.state.values.channel_select_block.channel_select_input.selected_conversation;

        try {
            const session = await db.findSessionById(eventId);
            if (!session) return; // Should not happen

            if (session.postedMessages.some(msg => msg.channelId === targetChannelId)) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: user, user: user, text: 'It appears this proclamation has already been issued in that channel.' });
                return;
            }

            const channelConfig = await db.getChannelConfig(targetChannelId);
            if (!channelConfig) {
                 await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: user, user: user, text: `I'm sorry, but I have not yet been configured for <#${targetChannelId}>. Please invite me there and configure my duties first.` });
                 return;
            }
            
            const introText = `A summons is issued! :trumpet:\n\nAll are invited to the engagement of *${session.title}* on *${session.bookingDate}*. There are still positions available. Will you answer the call?`;
            
            const blocks = formatEventMessage(session, channelConfig, introText);
            const result = await client.chat.postMessage({
                token: CONFIG.SLACK_BOT_TOKEN,
                channel: targetChannelId,
                blocks: blocks,
                text: `An invitation to ${session.title} on ${session.bookingDate} awaits!`,
            });

            if (result.ok) {
                session.postedMessages.push({ channelId: targetChannelId, messageTs: result.ts });
                await db.setSessionState(session);
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: user, user: user, text: `✅ Very good. The proclamation has been duly shared in <#${targetChannelId}>.` });
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            logger.error("Error in share_event_view submission:", error);
            await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: user, user: user, text: `❌ Alas, a regrettable error occurred: ${error.message}` });
        }
    });
    
    // --- Step 2a: User submits the small 'Add Roster' modal ---
    app.view('add_roster_view', async ({ ack, body, view }) => {
        const eventData = JSON.parse(view.private_metadata);
        
        const rosterName = view.state.values.roster_name_block.roster_name_input.value;
        const rosterCapacity = parseInt(view.state.values.roster_capacity_block.roster_capacity_input.value, 10);
        const allowPlusOne = view.state.values.plus_one_block?.plus_one_input?.selected_options?.length > 0;
        
        if (!rosterName || isNaN(rosterCapacity) || rosterCapacity < 1) {
            await ack({ response_action: 'errors', errors: { roster_name_block: 'A name is required.', roster_capacity_block: 'Capacity must be a number greater than 0.' } });
            return;
        }
        
        eventData.rosters.push({
            id: crypto.randomBytes(6).toString('hex'), // Assign a unique ID to the roster
            name: rosterName,
            capacity: rosterCapacity,
            allowPlusOne: allowPlusOne,
            players: []
        });
        
        const updatedView = buildRosterEditorView(eventData);
        await ack({ response_action: 'update', view: updatedView });
    });
    
    // --- Handles submission of the 'Join Roster' modal ---
    app.view('join_roster_view', async ({ ack, body, view, client, logger }) => {
        await ack();
        
        const userId = body.user.id;
        
        try {
            const { eventId, singleRosterId } = JSON.parse(view.private_metadata);
            
            // Determine which roster was selected
            let selectedRosterId;
            if (singleRosterId) {
                selectedRosterId = singleRosterId;
            } else {
                selectedRosterId = view.state.values.roster_select_block.roster_select_input.selected_option.value;
            }
            
            const guestCount = parseInt(view.state.values.guest_selection_block.guest_selection_input.selected_option.value, 10);

            if (!selectedRosterId) throw new Error("No roster was selected or available.");

            const event = await db.findSessionById(eventId);
            if (!event) throw new Error("Could not find the event.");

            const rosterToJoin = event.rosters.find(r => r.id === selectedRosterId);
            if (!rosterToJoin) throw new Error("The selected roster could not be found.");
            
            if (guestCount > 0 && !rosterToJoin.allowPlusOne) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: `My apologies, but the roster you selected, *${rosterToJoin.name}*, does not permit guests.` });
                return;
            }

            const spotsNeeded = 1 + guestCount;
            const spotsAvailable = rosterToJoin.capacity - rosterToJoin.players.reduce((acc, p) => acc + 1 + (p.plusOneCount || 0), 0);

            if (spotsNeeded > spotsAvailable) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: `My apologies, but there are not enough spots left for you and your guest(s) on the *${rosterToJoin.name}* roster.` });
                return;
            }

            const userInfoResponse = await client.users.info({ user: userId });
            const playerObject = {
                id: userId,
                email: userInfoResponse.user?.profile?.email || null,
                plusOneCount: guestCount // Store the number of guests
            };
            
            rosterToJoin.players.push(playerObject);
            
            await db.setSessionState(event);
            
            let channelId;
            if (event.postedMessages && event.postedMessages.length > 0) {
                channelId = event.postedMessages[0].channelId;
            } else if (event.channelIdForScheduled) {
                channelId = event.channelIdForScheduled;
            }

            if (channelId) {
                const channelConfig = await db.getChannelConfig(channelId);
                await updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);
            }
            
            let confirmationText = `Excellent. I have added you to the roster for *${rosterToJoin.name}*`;
            if (guestCount === 1) confirmationText += ' with one guest.';
            if (guestCount > 1) confirmationText += ` with ${guestCount} guests.`;
            if (guestCount === 0) confirmationText += '.';
            
            await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: confirmationText });

        } catch (error) {
            logger.error("Error in join_roster_view submission:", error);
        }
    });

    // ... other view listeners for create_profile, configure_channel, etc. ...
    app.view('create_profile_view', async ({ ack, body, view, client, logger }) => {
        const user = body.user.id;
        const values = view.state.values;

        const profileData = {
            _id: values.name_block.name_input.value,
            category: values.category_block.category_input.selected_option.value,
            capacityUnit: values.capacity_unit_block.capacity_unit_input.value,
            defaultLocation: values.default_location_block.default_location_input.value || null,
            venueCode: values.venue_code_block.venue_code_input.value || null,
            defaultCapacity: parseInt(values.default_capacity_block.default_capacity_input.value, 10),
            createdBy: user,
            createdAt: new Date().toISOString(),
        };

        if (!profileData._id || !profileData.capacityUnit) {
            await ack({ response_action: 'errors', errors: { name_block: 'A name is required.', capacity_unit_block: 'A capacity unit is required.' } });
            return;
        }
        await ack();

        try {
            await db.setEventProfile(profileData);
            await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: user, user: user, text: `I have successfully created the event profile: *${profileData._id}*.` });
        } catch (error) {
            logger.error('Failed to save event profile:', error);
        }
    });

    app.view('configure_channel_view', async ({ ack, body, view, client, logger }) => {
        const metadata = JSON.parse(view.private_metadata);
        const channelId = metadata.channelId;
        const user = body.user.id;
        const values = view.state.values;

        const newConfig = {
            _id: channelId,
            defaultEventType: values.default_event_type_block.default_event_type_input.selected_option.value,
            reactionEmoji: values.reaction_emoji_block.reaction_emoji_input.value.replace(/:/g, ''),
            displayEmoji: values.display_emoji_block.display_emoji_input.value.replace(/:/g, ''),
            reminderText: values.reminder_text_block.reminder_text_input.value,
            configuredBy: user,
            configuredAt: new Date().toISOString(),
        };
        await ack();

        try {
            await db.setChannelConfig(newConfig);
            await client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, text: `My duties for this channel have been set by <@${user}>. I am now at your service.` });
        } catch (error) {
            logger.error('Failed to save channel configuration:', error);
        }
    });

    app.view('add_roster_to_existing_view', async ({ ack, body, view, client, logger }) => {
        await ack();
        const metadata = JSON.parse(view.private_metadata);
        const eventId = metadata.eventId;

        try {
            const event = await db.findSessionById(eventId);
            if (!event) throw new Error("Could not find the event to modify.");
            
            const rosterName = view.state.values.roster_name_block.roster_name_input.value;
            const rosterCapacity = parseInt(view.state.values.roster_capacity_block.roster_capacity_input.value, 10);

            if (!rosterName || isNaN(rosterCapacity) || rosterCapacity < 1) {
                logger.warn("Invalid roster data submitted for existing event.");
                return;
            }

            event.rosters.push({
                name: rosterName,
                capacity: rosterCapacity,
                players: []
            });

            event.maxCapacity += rosterCapacity;

            await db.setSessionState(event);
            
            const channelConfig = await db.getChannelConfig(event.postedMessages[0].channelId);
            await updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);

        } catch(error) {
            logger.error("Error in add_roster_to_existing_view submission:", error);
        }
    });

    app.view('create_event_step1_view', async ({ ack, body, view }) => {
        const eventData = {
            title: view.state.values.title_block.title_input.value,
            eventType: view.state.values.type_block.type_input.selected_option.value,
            date: view.state.values.date_block.date_input.selected_date,
            time: view.state.values.time_block.time_input.selected_time,
            location: view.state.values.location_block.location_input.value,
            description: view.state.values.description_block.description_input.value || null,
            postAt: view.state.values.scheduling_block.scheduling_datetime_picker.selected_date_time,
            rosters: [],
            channelId: JSON.parse(view.private_metadata).channelId,
            user: body.user.id,
        };
        
        const rosterEditorView = buildRosterEditorView(eventData);
        await ack({ response_action: 'update', view: rosterEditorView });
    });

    app.view('create_event_step2_view', async ({ ack, body, view, client, logger }) => {
        const finalEventData = JSON.parse(view.private_metadata);

        if (finalEventData.rosters.length === 0) {
            await ack({ response_action: 'errors', errors: {} });
            return;
        }

        await ack();

        try {
            const channelConfig = await db.getChannelConfig(finalEventData.channelId);
            const eventProfile = await db.getEventProfile(finalEventData.eventType);
            const bookingDateObj = parseDateFns(`${finalEventData.date}T${finalEventData.time}`, "yyyy-MM-dd'T'HH:mm", new Date());
            
            const postAtTimestamp = finalEventData.postAt;
            const nowTimestamp = Math.floor(Date.now() / 1000);
            const isScheduled = postAtTimestamp > nowTimestamp + 5;

            const newSession = {
                _id: `EVT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
                title: finalEventData.title,
                eventType: finalEventData.eventType,
                eventCategory: eventProfile.category,
                venueCode: eventProfile.venueCode,
                location: finalEventData.location,
                description: finalEventData.description,
                bookingDate: formatDate(bookingDateObj, "EEEE, MMMM do"),
                bookingFullDate: bookingDateObj.toISOString(),
                bookingTime: formatDate(bookingDateObj, "HH:mm"),
                rosters: finalEventData.rosters,
                maxCapacity: finalEventData.rosters.reduce((sum, r) => sum + r.capacity, 0),
                standby: [],
                createdAt: new Date().toISOString(),
                createdBy: finalEventData.user,
                postedMessages: [],
                status: isScheduled ? 'SCHEDULED' : 'ACTIVE',
                postAt: isScheduled ? postAtTimestamp : null,
                channelIdForScheduled: isScheduled ? finalEventData.channelId : null,
            };
            
            if (isScheduled) {
                // Simply save the event. The internal scheduler will handle posting it.
                await db.setSessionState(newSession);
                await client.chat.postEphemeral({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: finalEventData.channelId,
                    user: finalEventData.user,
                    text: `Very good. I have scheduled the announcement for *${newSession.title}* to be posted on ${new Date(postAtTimestamp * 1000).toLocaleString()}.`
                });
            } else { // Post immediately
                const initialBlocks = formatEventMessage(newSession, channelConfig);
                const result = await client.chat.postMessage({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: finalEventData.channelId,
                    blocks: initialBlocks,
                    text: `An invitation to ${newSession.title} awaits!`
                });

                if (result.ok) {
                    newSession.postedMessages.push({ channelId: result.channel, messageTs: result.ts });
                    await db.setSessionState(newSession);
                }
            }
        } catch(error) {
            logger.error("[VIEW SUBMISSION] Error processing final event:", error);
        }
    });

    app.view('leave_event_view', async ({ ack, body, view, client, logger }) => {
        await ack();
        
        const userId = body.user.id;
        const eventId = view.state.values.event_select_block.event_select_input.selected_option.value;

        try {
            const event = await db.findSessionById(eventId);
            if (!event) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: "My apologies, I could no longer find that event." });
                return;
            }

            let userWasRemoved = false;
            // Find and remove the user from any roster
            for (const roster of event.rosters) {
                const playerIndex = roster.players.findIndex(p => p.id === userId);
                if (playerIndex > -1) {
                    roster.players.splice(playerIndex, 1);
                    userWasRemoved = true;
                    // Try to promote from standby into this newly opened spot
                    if (event.standby.length > 0) {
                        const promotedUser = event.standby.shift();
                        roster.players.push(promotedUser);
                        client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: promotedUser.id, text: `Fortune smiles upon you! A position for *${event.title}* has become available. You are now on the roster for *${roster.name}*.` });
                    }
                    break;
                }
            }
            
            // If not found in a main roster, check standby
            if (!userWasRemoved) {
                const standbyIndex = event.standby.findIndex(p => p.id === userId);
                if (standbyIndex > -1) {
                  event.standby.splice(standbyIndex, 1);
                  userWasRemoved = true;
                }
            }

            if (userWasRemoved) {
                await db.setSessionState(event);
                
                let channelId;
                if (event.postedMessages && event.postedMessages.length > 0) {
                    channelId = event.postedMessages[0].channelId;
                } else if (event.channelIdForScheduled) {
                    channelId = event.channelIdForScheduled;
                }
                
                if (channelId) {
                    const channelConfig = await db.getChannelConfig(channelId);
                    await updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);
                }
                
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: `Very good. I have removed you from the event: *${event.title}*.` });
            } else {
                 await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: userId, user: userId, text: "It appears your name was not on the list for that event after all." });
            }
        } catch (error) {
            logger.error("Error in leave_event_view submission:", error);
        }
    });


};

module.exports = registerViewListeners;
