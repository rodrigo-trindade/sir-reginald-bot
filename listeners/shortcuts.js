// listeners/shortcuts.js
// Handles global and message shortcuts.

const db = require('../db');
const CONFIG = require('../config');

// Helper function to robustly parse the Event ID from a message's context block
const getEventIdFromMessage = (message) => {
    // --- FIX: Find the divider block with the special ID format ---
    const idBlock = message.blocks.find(b => b.block_id && b.block_id.startsWith('event_id::'));
    if (idBlock) {
        return idBlock.block_id.split('::')[1];
    }
    return null;
};

const registerShortcutListeners = (app) => {
    /**
     * Handles the 'share_event_shortcut' message shortcut.
     */

    app.shortcut('share_event_shortcut', async ({ shortcut, ack, client, logger }) => {
        await ack();
        const userId = shortcut.user.id;
        const channelId = shortcut.channel.id;

        try {
            const isAdmin = await db.isUserChannelAdmin(channelId, userId);
            if (!isAdmin) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: "My apologies, but this is an administrative duty." });
                return;
            }

            const eventId = getEventIdFromMessage(shortcut.message);
            if (!eventId) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: "I'm sorry, I could not determine which event this message belongs to." });
                return;
            }

            await client.views.open({
                trigger_id: shortcut.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'share_event_view',
                    private_metadata: JSON.stringify({ eventId }),
                    title: { type: 'plain_text', text: 'Share Event' },
                    submit: { type: 'plain_text', text: 'Share' },
                    blocks: [
                        {
                            type: 'section',
                            text: { type: 'mrkdwn', text: 'Please select a public channel to share this event announcement in.' }
                        },
                        {
                            type: 'input',
                            block_id: 'channel_select_block',
                            label: { type: 'plain_text', text: 'Channel' },
                            element: {
                                type: 'conversations_select',
                                placeholder: { type: 'plain_text', text: 'Select a channel' },
                                action_id: 'channel_select_input',
                                filter: {
                                    include: ["public"]
                                }
                            }
                        }
                    ]
                }
            });
        } catch (error) {
            logger.error('Error in share_event_shortcut:', error);
        }
    });

    /**
     * Handles the 'copy_event_id' message shortcut.
     */
    app.shortcut('copy_event_id', async ({ shortcut, ack, client, logger }) => {
        await ack();
        const userId = shortcut.user.id;
        const channelId = shortcut.channel.id;

        try {

            const isAdmin = await db.isUserChannelAdmin(channelId, userId);
            if (!isAdmin) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: "My apologies, but this is an administrative duty." });
                return;
            }

            const eventId = getEventIdFromMessage(shortcut.message);
            if (!eventId) {
                await client.chat.postEphemeral({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: channelId,
                    user: userId,
                    text: "I'm sorry, I could not determine the Event ID from this message. It may be an outdated format."
                });
                return;
            }

            await client.chat.postEphemeral({
                token: CONFIG.SLACK_BOT_TOKEN,
                channel: channelId,
                user: userId,
                text: "Here is the Event ID you requested.",
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `The ID for this event is:\n\`\`\`${eventId}\`\`\``
                        }
                    }
                ]
            });
        } catch (error) {
            logger.error('Error in copy_event_id shortcut:', error);
        }
    });


    /**
     * Handles the 'copy_emails' message shortcut.
     */
    app.shortcut('copy_emails', async ({ shortcut, ack, client, logger }) => {
        await ack();
        const userId = shortcut.user.id;
        const channelId = shortcut.channel.id;

        try {
            const eventId = getEventIdFromMessage(shortcut.message);
            if (!eventId) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: "I'm sorry, I could not determine which event this message belongs to." });
                return;
            }

            logger.info(`'copy_emails' shortcut triggered by ${userId} for event ${eventId}`);
            const session = await db.findSessionById(eventId);

            if (!session) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: "I'm sorry, I could not find an active event associated with that message." });
                return;
            }

            const allParticipants = [...session.rosters.flatMap(r => r.players), ...session.standby];
            const emails = allParticipants.map(p => p.email).filter(Boolean);

            if (emails.length === 0) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: userId, text: `There are currently no participants with stored email addresses for the event: *${session.title}*.` });
                return;
            }

            const emailString = emails.join(', ');

            await client.chat.postEphemeral({
                token: CONFIG.SLACK_BOT_TOKEN,
                channel: channelId,
                user: userId,
                text: `Here are the emails for *${session.title}*`,
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `I have gathered the email addresses for all participants and reserves for the event: *${session.title}*.` } },
                    { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${emailString}\`\`\`` } },
                    { type: 'context', elements: [{ type: 'mrkdwn', text: 'You may copy the text from the block above to easily create a calendar invitation.' }] }
                ]
            });

        } catch (error) {
            logger.error('Error in copy_emails shortcut:', error);
        }
    });
};

module.exports = registerShortcutListeners;
