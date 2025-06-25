// listeners/events.js
// Handles Slack events like mentions, channel joins, and message posts.

const { subtype } = require('@slack/bolt');
const db = require('../db');
const { handleInquiry } = require('../utils/inquiry-handler');
const CONFIG = require('../config');

async function postConfigRequest(client, channelId, userId) {
    await client.chat.postEphemeral({
        token: CONFIG.SLACK_BOT_TOKEN,
        channel: channelId,
        user: userId,
        text: "It appears I have not yet been configured for this channel.",
        blocks: [
            { "type": "section", "text": { "type": "mrkdwn", "text": "Greetings. Before I can arrange engagements, I require a brief moment of your time to set my duties in order." } },
            { "type": "actions", "elements": [ { "type": "button", "text": { "type": "plain_text", "text": "Configure Sir Reginald", "emoji": true }, "style": "primary", "value": "configure_channel", "action_id": "configure_channel_button" } ] }
        ]
    });
}

const registerEventHandlers = (app) => {
    // --- Bot is invited to a new channel ---
    app.event('member_joined_channel', async ({ event, client, logger }) => {
        try {
            const { user, channel } = event;
            const botInfo = await client.auth.test();
            
            if (user === botInfo.user_id) {
                logger.info(`I have been invited to channel ${channel}. Posting configuration prompt.`);
                await client.chat.postMessage({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: channel,
                    text: "Greetings! I am Sir Reginald, at your service.",
                    blocks: [
                        { "type": "section", "text": { "type": "mrkdwn", "text": "Greetings! I am Sir Reginald, at your service. To tailor my duties to this channel's specific needs, an administrator may configure me using the button below." } },
                        { "type": "actions", "elements": [ { "type": "button", "text": { "type": "plain_text", "text": "Configure Sir Reginald", "emoji": true }, "style": "primary", "value": "configure_channel", "action_id": "configure_channel_button" } ] }
                    ]
                });
            }
        } catch (error) {
            logger.error('Error in member_joined_channel event:', error);
        }
    });

    // --- User mentions the bot ---
    app.event('app_mention', async ({ event, client, logger }) => {
        logger.info(`Received app_mention event from user ${event.user}`);
      
        const replyText = await handleInquiry(event.text, event.user);
        try {
            await client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: event.channel, thread_ts: event.ts, text: replyText });
        } catch (error) {
            logger.error('Failed to post threaded reply to mention:', error);
        }
    });
    
    // --- A scheduled message was successfully posted ---
    // This is the specific listener that "connects the dots" for scheduled events.
    app.message(subtype('message_posted'), async ({ message, logger }) => {
        const scheduledMessageId = message.previous_message?.scheduled_message_id;
        if (!scheduledMessageId) return;

        try {
            const event = await db.findSessionByScheduledId(scheduledMessageId);
            if (event) {
                logger.info(`[SCHEDULED_POST] Found event ${event._id} for scheduled_id ${scheduledMessageId}.`);
                logger.info(`[SCHEDULED_POST] Updating event with new message_ts ${message.ts} in channel ${message.channel}.`);
                event.postedMessages.push({ channelId: message.channel, messageTs: message.ts });
                event.status = 'ACTIVE';
                await db.setSessionState(event);
                logger.info(`[SCHEDULED_POST] Successfully updated event ${event._id}.`);
            } else {
                 logger.warn(`[SCHEDULED_POST] Received a posted scheduled message, but could not find a matching event in the DB for scheduled_id: ${scheduledMessageId}`);
            }
        } catch (error) {
            logger.error(`[SCHEDULED_POST] Error updating record for posted scheduled message ${scheduledMessageId}:`, error);
        }
    });

    // --- User sends a Direct Message to the bot ---
    app.message(async ({ message, client, logger }) => {
        // --- FIX: This listener now ONLY handles DMs and explicitly ignores any message with a subtype ---
        // This prevents it from interfering with the 'message_posted' listener above.
        if (message.subtype === undefined && message.channel_type === 'im' && !message.bot_id && message.text) {
            logger.info(`[DM] Received DM from user ${message.user}: "${message.text}"`);
            const replyText = await handleInquiry(message.text, message.user);
            try {
                await client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: message.channel, text: replyText });
            } catch (error) {
                logger.error('[DM] Failed to post reply to DM:', error);
            }
        }
    });
};

module.exports = { registerEventHandlers, postConfigRequest };
