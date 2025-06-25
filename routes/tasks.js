// routes/tasks.js
// Defines HTTP endpoints for scheduled tasks.

const crypto = require('crypto');
const db = require('../db');
const CONFIG = require('../config');
const { getBookingDateForWeeksAhead } = require('../utils/date');
const { formatEventMessage } = require('../utils/slack-messages');
const { getWeatherForecast } = require('../utils/weather');

// Middleware to secure the endpoint against unauthorized access
const requireCronSecret = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null || token !== CONFIG.CRON_SECRET_TOKEN) {
        return res.sendStatus(403); // Forbidden
    }
    next();
};

const registerRoutes = (receiver, client, logger) => {
    // Middleware to check for the CRON secret token
    
    receiver.app.post('/tasks/post-scheduled', requireCronSecret, async (req, res) => {
        logger.info('[CRON] Received request to post scheduled events.');
        try {
            const pendingEvents = await db.findPendingScheduledEvents();
            
            if (pendingEvents.length === 0) {
                logger.info('[CRON] No announcements are due at this time.');
                return res.status(200).send('No events to post.');
            }

            logger.info(`[CRON] Found ${pendingEvents.length} event(s) to post.`);
            let postedCount = 0;

            for (const event of pendingEvents) {
                const channelConfig = await db.getChannelConfig(event.channelIdForScheduled);
                if (!channelConfig) {
                    logger.error(`[CRON] Could not find channel config for ${event.channelIdForScheduled}. Skipping post for event ${event._id}.`);
                    continue;
                }
                
                const blocks = formatEventMessage(event, channelConfig);

                const result = await client.chat.postMessage({
                    token: CONFIG.SLACK_BOT_TOKEN,
                    channel: event.channelIdForScheduled,
                    blocks: blocks,
                    text: `An invitation to ${event.title} awaits!`
                });

                if (result.ok) {
                    event.status = 'ACTIVE';
                    event.postedMessages.push({ channelId: result.channel, messageTs: result.ts });
                    await db.setSessionState(event);
                    postedCount++;
                } else {
                    throw new Error(result.error);
                }
            }
            logger.info(`[CRON] Successfully posted ${postedCount} event(s).`);
            return res.status(200).send(`Posted ${postedCount} event(s).`);
        } catch (error) {
            logger.error('[CRON] An error occurred during the task:', error);
            return res.status(500).send('An error occurred.');
        }
    });

    // --- Endpoint for scheduled announcements ---
    receiver.app.post('/tasks/send-announcement', async (req, res) => {
      logger.info(`HTTP Task: Received request to send a scheduled announcement.`);
      try {
        // This task posts to a single, default channel defined in the .env file.
        // For this to work, that channel MUST be configured first.
        const channelConfig = await db.getChannelConfig(CONFIG.SLACK_CHANNEL_ID);
        if (!channelConfig) {
            throw new Error(`The primary channel ${CONFIG.SLACK_CHANNEL_ID} has not been configured.`);
        }

        const eventProfile = await db.getEventProfile(channelConfig.defaultEventType);
        if (!eventProfile) {
            throw new Error(`Default event profile "${channelConfig.defaultEventType}" not found in database.`);
        }

        const { dateString, fullDate } = getBookingDateForWeeksAhead(2);
        
        const newSession = {
            _id: `EVT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            title: eventProfile._id,
            eventType: eventProfile._id,
            eventCategory: eventProfile.category,
            venueCode: eventProfile.venueCode,
            bookingDate: dateString,
            bookingFullDate: fullDate,
            bookingTime: CONFIG.DEFAULT_TIME,
            location: eventProfile.defaultLocation,
            description: `A regularly scheduled engagement of ${eventProfile._id}.`,
            rosters: [],
            maxCapacity: 0,
            standby: [],
            createdAt: new Date().toISOString(),
            createdBy: 'scheduled_task',
            postedMessages: [],
        };
        
        const capacity = eventProfile.defaultCapacity;
        if (eventProfile.category === 'SPORT') {
            const playersPerUnit = eventProfile._id.toLowerCase().includes('padel') ? 4 : 2;
            newSession.rosters = Array.from({ length: capacity }, (_, i) => ({ name: `${eventProfile.capacityUnit.slice(0, -1)} ${i + 1}`, players: [], capacity: playersPerUnit }));
            newSession.maxCapacity = capacity * playersPerUnit;
        } else {
            newSession.rosters.push({ name: 'Attendees', players: [], capacity });
            newSession.maxCapacity = capacity;
        }

        const initialBlocks = formatEventMessage(newSession, channelConfig);
        const result = await client.chat.postMessage({
            token: CONFIG.SLACK_BOT_TOKEN,
            channel: CONFIG.SLACK_CHANNEL_ID,
            blocks: initialBlocks,
            text: `An invitation to ${newSession.title} awaits!`,
        });

        if (result.ok) {
            newSession.postedMessages.push({ channelId: CONFIG.SLACK_CHANNEL_ID, messageTs: result.ts });
            await db.setSessionState(newSession);
            logger.info(`A scheduled proclamation for ${newSession.title} has been issued and chronicled.`);
            return res.status(200).send('Proclamation Issued.');
        } else {
            throw new Error(`Slack API error: ${result.error}`);
        }
      } catch (error) {
        logger.error('HTTP Task: The arrangement of the proclamation has failed.', error);
        return res.status(500).send(`Error processing proclamation: ${error.message}`);
      }
    });

    // --- Endpoint for sending daily reminders ---
    receiver.app.post('/tasks/send-reminders', async (req, res) => {
        const isDryRun = req.query.dryRun === 'true';
        logger.info(`HTTP Task: Received request to send daily pre-engagement reminders. (Dry Run: ${isDryRun})`);

        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString();
            const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString();

            const allUpcoming = await db.findAllUpcomingSessions();
            const sessionsForTomorrow = allUpcoming.filter(s => 
                s.bookingFullDate >= tomorrowStart && s.bookingFullDate <= tomorrowEnd
            );

            logger.info(`Found ${sessionsForTomorrow.length} session(s) scheduled for tomorrow.`);

            if (sessionsForTomorrow.length > 0) {
                for (const session of sessionsForTomorrow) {
                    let channelId;
                    if (session.postedMessages && session.postedMessages.length > 0) {
                        channelId = session.postedMessages[0].channelId;
                    } else if (session.channelIdForScheduled) {
                        channelId = session.channelIdForScheduled;
                    }

                    if (!channelId) {
                        logger.warn(`Event ${session._id} has no channel associated with it. Skipping reminder.`);
                        continue;
                    }
                    
                    const channelConfig = await db.getChannelConfig(channelId);
                    console.log(channelConfig);
                    const weather = await getWeatherForecast(session.bookingFullDate, logger);
                    const playerIds = session.rosters.flatMap(r => r.players.map(p => p.id));
                    
                    if (playerIds.length === 0) {
                        logger.info(`Event ${session._id} for tomorrow has no players. Skipping reminder.`);
                        continue;
                    }

                    const defaultTemplate = "A gentle reminder, esteemed combatants. Our engagement, *{eventTitle}*, is scheduled for tomorrow at {eventTime}. Pray, prepare accordingly. {weather}";
                    
                    // --- FIX: Check if the config object and the reminderText property both exist. ---
                    const reminderTemplate = (channelConfig && typeof channelConfig.reminderText === 'string') 
                        ? channelConfig.reminderText 
                        : defaultTemplate;
                    
                    const reminderText = reminderTemplate
                        .replace(/{eventTitle}/g, `*${session.title}*`)
                        .replace(/{eventTime}/g, `*${session.bookingTime}*`)
                        .replace(/{weather}/g, weather);
                    
                    if (isDryRun) {
                        console.log(`\n--- DRY RUN: REMINDER FOR EVENT ${session._id} ---`);
                        console.log(`-> Channel: ${channelId}`);
                        console.log(`-> Using custom template: ${!!(channelConfig && typeof channelConfig.reminderText === 'string')}`);
                        console.log(`-> Template used: "${reminderTemplate}"`);
                        console.log(`-> Recipients: ${playerIds.join(', ')}`);
                        console.log(`-> Final Message: "${reminderText}"`);
                    } else {
                        if (playerIds.length > 1) {
                            const conv = await client.conversations.open({ token: CONFIG.SLACK_BOT_TOKEN, users: playerIds.join(',') });
                            if (conv.ok) await client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: conv.channel.id, text: reminderText });
                        } else {
                            await client.chat.postMessage({ token: CONFIG.SLACK_BOT_TOKEN, channel: playerIds[0], text: reminderText });
                        }
                        logger.info(`Sent reminder for event ${session._id} on ${session.bookingDate}.`);
                    }
                }
            }
            return res.status(200).send(isDryRun ? 'Dry run completed.' : 'Reminders processed.');
        } catch (error) {
            logger.error('HTTP Task: Error sending reminders:', error);
            return res.status(500).send('Error processing reminders.');
        }
    });
};

module.exports = registerRoutes;
