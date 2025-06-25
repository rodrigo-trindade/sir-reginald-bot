// listeners/commands.js
// Handles all slash commands for the application.

const { format: formatDate } = require('date-fns');
const db = require('../db');
const { formatEventMessage } = require('../utils/slack-messages');
const { updateAllEventMessages } = require('../utils/slack-messages');

const CONFIG = require('../config');
const { getAuthUrl } = require('../utils/google-calendar');
const { postConfigRequest } = require('./events');

const { buildRosterEditorView } = require('../utils/view-builder');

const registerCommandListeners = (app) => {

    app.command('/gcal-login', async ({ ack, command, respond }) => {
        await ack();
        const authUrl = getAuthUrl(command.user_id);
        await respond({
            response_type: 'ephemeral',
            text: "To connect your Google Calendar, please use the following link.",
            blocks: [
                { type: 'section', text: { type: 'mrkdwn', text: "To allow me to create calendar events on your behalf, you must grant me permission. Please click the button below to sign in with Google." } },
                { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Connect to Google Calendar', emoji: true }, url: authUrl, style: 'primary' }] }
            ]
        });
    });

    app.command('/delete-event', async ({ command, respond, client, logger }) => {
        const eventId = command.text.trim().toUpperCase();
        if (!eventId) {
          await respond({ response_type: 'ephemeral', text: "Usage: `/delete-event [Event ID]`" });
          return;
        }
        try {
          const session = await db.findSessionById(eventId);
          if (!session) {
              await respond({ response_type: 'ephemeral', text: `I could not find an event with the ID \`${eventId}\`.` });
              return;
          }
          
          const channelId = session.channelIdForScheduled || session.postedMessages[0]?.channelId;
          const isAdmin = await db.isUserChannelAdmin(channelId, command.user_id);
          if (!isAdmin) {
              await respond({ response_type: 'ephemeral', text: "My apologies, but only the channel administrator may perform this duty." });
              return;
          }
  
          const deletePromises = (session.postedMessages || []).map(msg =>
            client.chat.delete({ token: CONFIG.SLACK_BOT_TOKEN, channel: msg.channelId, ts: msg.messageTs })
              .catch(err => logger.error(`Failed to delete message ${msg.messageTs}`, err))
          );
          
          if (session.scheduledMessageId) {
              deletePromises.push(
                  client.chat.deleteScheduledMessage({
                      token: CONFIG.SLACK_BOT_TOKEN,
                      channel: session.channelIdForScheduled,
                      scheduled_message_id: session.scheduledMessageId,
                  }).catch(err => {
                      if (err.data?.error === 'invalid_scheduled_message_id') {
                          logger.warn(`Scheduled message ${session.scheduledMessageId} likely already posted.`);
                      } else {
                          logger.error(`Failed to delete scheduled message ${session.scheduledMessageId}`, err);
                      }
                  })
              );
          }
          
          await Promise.all(deletePromises);
          await db.deleteSessionState(session._id);
          
          await respond({ response_type: 'ephemeral', text: `✅ The event *${session.title}* has been expunged.` });
        } catch (error) {
          logger.error('Error in /delete-event command:', error);
          await respond({ response_type: 'ephemeral', text: `❌ An unforeseen complication has arisen.` });
        }
      });
  
      app.command('/my-events', async ({ ack, command, respond, logger }) => {
          await ack();
          try {
              const userId = command.user_id;
              const myEvents = await db.findEventsByUser(userId);
  
              if (myEvents.length === 0) {
                  await respond({ response_type: 'ephemeral', text: "Your schedule is presently clear. You have not signed up for any upcoming events." });
                  return;
              }
  
              const eventBlocks = myEvents.flatMap(event => {
                  const userStatus = event.standby.some(p => p.id === userId) ? "(on standby)" : "(confirmed)";
                  return [
                      { type: 'section', text: { type: 'mrkdwn', text: `*${event.title}* - ${userStatus}\n:calendar: ${event.bookingDate} at ${event.bookingTime}` } },
                      { type: 'divider' }
                  ];
              });
  
              await respond({
                  response_type: 'ephemeral',
                  text: 'Here are your upcoming engagements.',
                  blocks: [ { type: 'header', text: { type: 'plain_text', text: 'Your Personal Ledger', emoji: true } }, ...eventBlocks ]
              });
          } catch(error) {
              logger.error("Error in /my-events command:", error);
              await respond({ response_type: 'ephemeral', text: "My apologies, I had trouble consulting your personal ledger." });
          }
      });
  
      app.command('/leave-event', async ({ command, ack, respond, client, logger }) => {
          await ack();
          const userId = command.user_id;
  
          try {
              const myEvents = await db.findEventsByUser(userId);
  
              if (myEvents.length === 0) {
                  await respond({ response_type: 'ephemeral', text: "It appears you are not currently signed up for any upcoming events." });
                  return;
              }
  
              const eventOptions = myEvents.map(event => ({
                  text: { type: 'plain_text', text: `${event.title} - ${event.bookingDate}` },
                  value: event._id
              }));
  
              await client.views.open({
                  trigger_id: command.trigger_id,
                  view: {
                      type: 'modal',
                      callback_id: 'leave_event_view',
                      title: { type: 'plain_text', text: 'Leave an Engagement' },
                      submit: { type: 'plain_text', text: 'Leave Event' },
                      blocks: [
                          {
                              type: 'section',
                              text: { type: 'mrkdwn', text: 'Please select which engagement you wish to withdraw from. This action is irreversible.' }
                          },
                          {
                              type: 'input',
                              block_id: 'event_select_block',
                              label: { type: 'plain_text', text: 'Your Events' },
                              element: {
                                  type: 'static_select',
                                  action_id: 'event_select_input',
                                  options: eventOptions,
                                  placeholder: { type: 'plain_text', text: 'Select an event' }
                              }
                          }
                      ]
                  }
              });
          } catch (error) {
              logger.error('Error in /leave-event command:', error);
              await respond({ response_type: 'ephemeral', text: 'My apologies, a complication arose while fetching your event list.' });
          }
      });

    // --- /create-event command (Step 1: Initial Details) ---
    app.command('/create-event', async ({ ack, client, command, logger }) => {
        await ack();
        try {
            const channelId = command.channel_id;
            const channelConfig = await db.getChannelConfig(channelId);

            if (!channelConfig) {
                await postConfigRequest(client, channelId, command.user_id);
                return;
            }

            const allProfiles = await db.getAllEventProfiles();
            if (allProfiles.length === 0) {
                await client.chat.postEphemeral({ token: CONFIG.SLACK_BOT_TOKEN, channel: channelId, user: command.user_id, text: "My apologies, but no Event Profiles have been created yet. An administrator must first use `/create-profile`." });
                return;
            }

            const defaultProfile = await db.getEventProfile(channelConfig.defaultEventType) || {};
            const eventTypeOptions = allProfiles.map(p => ({ text: { type: 'plain_text', text: p._id }, value: p._id }));
            const initialOption = eventTypeOptions.find(opt => opt.value === channelConfig.defaultEventType);

            await client.views.open({
                trigger_id: command.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'create_event_step1_view',
                    private_metadata: JSON.stringify({ channelId }),
                    title: { type: 'plain_text', text: 'Arrange Engagement (1/2)' },
                    submit: { type: 'plain_text', text: 'Next: Add Rosters' },
                    blocks: [
                        { type: 'input', block_id: 'title_block', label: { type: 'plain_text', text: 'Event Title' }, element: { type: 'plain_text_input', action_id: 'title_input', placeholder: { type: 'plain_text', text: `e.g., ${channelConfig.defaultEventType}` } } },
                        { type: 'input', block_id: 'type_block', label: { type: 'plain_text', text: 'Type of Engagement' }, element: { type: 'static_select', action_id: 'type_input', options: eventTypeOptions, ...(initialOption && { initial_option: initialOption }) } },
                        { type: 'input', block_id: 'date_block', label: { type: 'plain_text', text: 'Date' }, element: { type: 'datepicker', initial_date: formatDate(new Date(), 'yyyy-MM-dd'), action_id: 'date_input' } },
                        { type: 'input', block_id: 'time_block', label: { type: 'plain_text', text: 'Time' }, element: { type: 'timepicker', initial_time: CONFIG.DEFAULT_TIME, action_id: 'time_input' } },
                        { type: 'input', block_id: 'location_block', label: { type: 'plain_text', text: 'Location' }, element: { type: 'plain_text_input', initial_value: defaultProfile.defaultLocation || '', action_id: 'location_input' } },
                        { type: 'input', block_id: 'description_block', optional: true, label: { type: 'plain_text', text: 'Description' }, element: { type: 'plain_text_input', multiline: true, action_id: 'description_input' } },
                        { type: 'divider' },
                        {
                            "type": "input",
                            "block_id": "scheduling_block",
                            "label": {
                                "type": "plain_text",
                                "text": "When should I post the announcement?"
                            },
                            "element": {
                                "type": "datetimepicker",
                                "action_id": "scheduling_datetime_picker",
                                "initial_date_time": Math.floor(Date.now() / 1000)
                            }
                        }
                    ]
                }
            });
        } catch (error) {
            logger.error("Error in /create-event command:", error);
        }
    });

    // Other commands remain the same, but are renamed for clarity
    app.command('/next-event', async ({ ack, respond, logger }) => {
        await ack();
        try {
            const session = await db.findNextSession();
            if (session) {
                const totalPlayers = session.rosters.reduce((sum, roster) => sum + roster.players.length, 0);
                await respond({
                    response_type: 'ephemeral',
                    text: `The next scheduled engagement is ${session.title}.`, // Fallback for notifications
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: 'The Next Engagement',
                                emoji: true
                            }
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `*${session.title}*\n:calendar: ${session.bookingDate} at ${session.bookingTime}\n:round_pushpin: ${session.location}\n:busts_in_silhouette: ${totalPlayers} of ${session.maxCapacity} positions filled`
                            }
                        }
                    ]
                });
            } else {
                await respond({ response_type: 'ephemeral', text: "It appears my scrolls show no upcoming engagements." });
            }
        } catch (error) {
            logger.error('Error in /next-event command:', error);
            await respond({ response_type: 'ephemeral', text: 'A thousand pardons, a complication has arisen in my archives.' });
        }
    });

    // --- /list-events command ---
    app.command('/list-events', async ({ ack, respond, logger }) => {
        await ack();
        try {
            const sessions = await db.findAllUpcomingSessions();
            if (sessions.length === 0) {
                await respond({ response_type: 'ephemeral', text: "My ledger is presently clear of any future engagements." });
                return;
            }

            const headerBlock = {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: 'Forthcoming Engagements',
                    emoji: true
                }
            };

            const eventBlocks = sessions.flatMap(session => {
                const totalPlayers = session.rosters.reduce((sum, roster) => sum + roster.players.length, 0);
                return [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*${session.title}*\n:calendar: ${session.bookingDate} at ${session.bookingTime}\n:round_pushpin: ${session.location}\n:busts_in_silhouette: ${totalPlayers} of ${session.maxCapacity} positions filled`
                        }
                    },
                    {
                        type: 'divider'
                    }
                ];
            });

            await respond({
                response_type: 'ephemeral',
                text: 'Here is a list of upcoming engagements.', // Fallback for notifications
                blocks: [headerBlock, ...eventBlocks]
            });

        } catch (error) {
            logger.error('Error in /list-events command:', error);
            await respond({ response_type: 'ephemeral', text: 'A thousand pardons, a complication has arisen whilst consulting my archives.' });
        }
    });

    app.command('/share-event', async ({ command, ack, respond, client, logger }) => {
        await ack();
        const regex = /(https?:\/\/\S+slack\.com\/archives\/[^\s>|]+)\s+<(#C[^|]+)\|[^>]+>/;
        const match = command.text.match(regex);
        if (!match) {
            await respond({ response_type: 'ephemeral', text: "Usage: `/share-event [message link] [#channel]`\n_Tip: Make sure to select the channel from Slack's autocomplete list._" });
            return;
        }
        const messageLink = match[1];
        const targetChannelId = match[2].substring(1);
        try {
            const linkParts = messageLink.split('/');
            const messageTsWithP = linkParts[linkParts.length - 1].split('?')[0];
            const originalMessageTs = messageTsWithP.substring(1, messageTsWithP.length - 6) + '.' + messageTsWithP.substring(messageTsWithP.length - 6);

            const session = await db.findSessionByMessageTs(originalMessageTs);
            if (!session) {
                await respond({ response_type: 'ephemeral', text: 'I could not find an active event associated with that original message.' });
                return;
            }
            if (session.postedMessages.some(msg => msg.channelId === targetChannelId)) {
                await respond({ response_type: 'ephemeral', text: 'It appears this proclamation has already been issued in that channel.' });
                return;
            }

            const introText = `A summons is issued! :trumpet:\n\nAll are invited to the engagement of *${session.title}* on *${session.bookingDate}*. There are still positions available. Will you answer the call?`;

            const blocks = formatEventMessage(session, introText);
            const result = await client.chat.postMessage({
                token: CONFIG.SLACK_BOT_TOKEN, channel: targetChannelId, blocks: blocks,
                text: `An invitation to ${session.title} on ${session.bookingDate} awaits!`,
            });
            if (result.ok) {
                session.postedMessages.push({ channelId: targetChannelId, messageTs: result.ts });
                await db.setSessionState(session);
                await respond({ response_type: 'ephemeral', text: `✅ Very good. The proclamation has been duly shared in <#${targetChannelId}>.` });
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            logger.error('Error in /share-event command:', error);
            await respond({ response_type: 'ephemeral', text: `❌ Alas, a regrettable error: ${error.message}` });
        }
    });

    app.command('/delete-event', async ({ command, ack, respond, client, logger }) => {
        await ack();
        const eventId = command.text.trim().toUpperCase().replace("#", "");
        if (!eventId) {
            await respond({ response_type: 'ephemeral', text: "Usage: `/delete-event [Event ID]`" });
            return;
        }
        try {
            const session = await db.findSessionById(eventId);
            if (!session) {
                await respond({ response_type: 'ephemeral', text: `I could not find an event with the ID \`${eventId}\`.` });
                return;
            }

            // Delete any posted messages
            const deletePromises = (session.postedMessages || []).map(msg =>
                client.chat.delete({ token: CONFIG.SLACK_BOT_TOKEN, channel: msg.channelId, ts: msg.messageTs })
                    .catch(err => logger.error(`Failed to delete message ${msg.messageTs}`, err))
            );

            // If the message was scheduled, delete the scheduled message
            if (session.scheduledMessageId) {
                logger.info(`Deleting scheduled message ${session.scheduledMessageId}`);
                deletePromises.push(
                    client.chat.deleteScheduledMessage({
                        token: CONFIG.SLACK_BOT_TOKEN,
                        channel: session.channelIdForScheduled,
                        scheduled_message_id: session.scheduledMessageId,
                    }).catch(err => logger.error(`Failed to delete scheduled message ${session.scheduledMessageId}`, err))
                );
            }

            await Promise.all(deletePromises);
            await db.deleteSessionState(session._id);

            await respond({ response_type: 'ephemeral', text: `✅ The event *${session.title}* and its announcements have been expunged from the record.` });
        } catch (error) {
            logger.error('Error in /delete-event command:', error);
            await respond({ response_type: 'ephemeral', text: `❌ An unforeseen complication has arisen.` });
        }
    });

    app.command('/create-profile', async ({ ack, client, command, logger }) => {
        await ack();
        try {
            await client.views.open({
                trigger_id: command.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'create_profile_view',
                    title: { type: 'plain_text', text: 'Create Event Profile' },
                    submit: { type: 'plain_text', text: 'Save Profile' },
                    blocks: [
                        { type: 'input', block_id: 'name_block', label: { type: 'plain_text', text: 'Profile Name' }, element: { type: 'plain_text_input', action_id: 'name_input', placeholder: { type: 'plain_text', text: 'e.g., Padel Match, Movie Night' } } },
                        { type: 'input', block_id: 'category_block', label: { type: 'plain_text', text: 'Category' }, element: { type: 'static_select', action_id: 'category_input', options: [{ text: { type: 'plain_text', text: 'Sport (Participatory)' }, value: 'SPORT' }, { text: { type: 'plain_text', text: 'Spectator (Viewing)' }, value: 'SPECTATOR' }] } },
                        { type: 'input', block_id: 'capacity_unit_block', label: { type: 'plain_text', text: 'Capacity Unit (plural)' }, element: { type: 'plain_text_input', action_id: 'capacity_unit_input', placeholder: { type: 'plain_text', text: 'e.g., courts, attendees, tables' } } },
                        { type: 'input', block_id: 'default_location_block', label: { type: 'plain_text', text: 'Default Location' }, element: { type: 'plain_text_input', action_id: 'default_location_input' }, optional: true },
                        { type: 'input', block_id: 'venue_code_block', label: { type: 'plain_text', text: 'Venue Code' }, element: { type: 'plain_text_input', action_id: 'venue_code_input' }, optional: true },
                        { type: 'input', block_id: 'default_capacity_block', label: { type: 'plain_text', text: 'Default Capacity' }, element: { type: 'number_input', is_decimal_allowed: false, action_id: 'default_capacity_input', initial_value: '1' } },
                    ]
                }
            });
        } catch (error) {
            logger.error("Error opening /create-profile modal:", error);
        }
    });

    app.command('/add-roster', async ({ command, ack, respond, client, logger }) => {
        await ack();
        const eventId = command.text.trim().toUpperCase().replace("#", "");
        if (!eventId) {
            await respond({ response_type: 'ephemeral', text: "Usage: `/add-roster [Event ID]`" });
            return;
        }

        try {
            const event = await db.findSessionById(eventId);
            if (!event) {
                await respond({ response_type: 'ephemeral', text: `I could not find an event with the ID \`${eventId}\`.` });
                return;
            }

            const channelId = event.channelIdForScheduled || event.postedMessages[0]?.channelId;
            const isAdmin = await db.isUserChannelAdmin(channelId, command.user_id);
            if (!isAdmin) {
                await ack();
                await respond({ response_type: 'ephemeral', text: "My apologies, but only the channel administrator may perform this duty." });
                return;
            }

            await client.views.open({
                trigger_id: command.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'add_roster_to_existing_view',
                    private_metadata: JSON.stringify({ eventId }),
                    title: { type: 'plain_text', text: 'Add Roster' },
                    submit: { type: 'plain_text', text: 'Add' },
                    blocks: [
                        { type: 'input', block_id: 'roster_name_block', label: { type: 'plain_text', text: 'New Roster Name' }, element: { type: 'plain_text_input', action_id: 'roster_name_input' } },
                        { type: 'input', block_id: 'roster_capacity_block', label: { type: 'plain_text', text: 'Capacity' }, element: { type: 'number_input', is_decimal_allowed: false, action_id: 'roster_capacity_input' } }
                    ]
                }
            });
        } catch (error) {
            logger.error('Error in /add-roster command:', error);
            await respond({ response_type: 'ephemeral', text: "My apologies, I encountered an error preparing the form." });
        }
    });

    app.command('/remove-roster', async ({ command, ack, respond, client, logger }) => {
        await ack();
        const [eventId, ...rosterNameParts] = command.text.trim().split(' ');
        const rosterName = rosterNameParts.join(' ');

        if (!eventId || !rosterName) {
            await respond({ response_type: 'ephemeral', text: "Usage: `/remove-roster [Event ID] [Full Roster Name]`" });
            return;
        }

        try {
            const event = await db.findSessionById(eventId.toUpperCase());
            if (!event) {
                await respond({ response_type: 'ephemeral', text: `I could not find an event with the ID \`${eventId.toUpperCase()}\`.` });
                return;
            }

            const channelId = event.channelIdForScheduled || event.postedMessages[0]?.channelId;
            const isAdmin = await db.isUserChannelAdmin(channelId, command.user_id);
            if (!isAdmin) {
                await ack();
                await respond({ response_type: 'ephemeral', text: "My apologies, but only the channel administrator may perform this duty." });
                return;
            }

            if (event.rosters.length <= 1) {
                await respond({ response_type: 'ephemeral', text: `I cannot remove the last remaining roster from *${event.title}*.` });
                return;
            }

            const rosterIndex = event.rosters.findIndex(r => r.name.toLowerCase() === rosterName.toLowerCase());
            if (rosterIndex === -1) {
                await respond({ response_type: 'ephemeral', text: `I could not find a roster named "${rosterName}" for this event.` });
                return;
            }

            if (event.rosters[rosterIndex].players.length > 0) {
                await respond({ response_type: 'ephemeral', text: `I cannot remove the roster "${rosterName}" as it is currently occupied.` });
                return;
            }

            const removedRoster = event.rosters.splice(rosterIndex, 1)[0];
            event.maxCapacity -= removedRoster.capacity;

            await db.setSessionState(event);
            const channelConfig = await db.getChannelConfig(event.postedMessages[0].channelId);
            await updateAllEventMessages(event, channelConfig, client, logger, CONFIG.SLACK_BOT_TOKEN);

            await respond({ response_type: 'ephemeral', text: `As you wish. I have removed the roster *${removedRoster.name}* from the event *${event.title}*.` });

        } catch (error) {
            logger.error('Error in /remove-roster command:', error);
            await respond({ response_type: 'ephemeral', text: 'My apologies, a complication arose while removing the roster.' });
        }
    });

    app.command('/help-reginald', async ({ ack, respond }) => {
        await ack();
        await respond({
            response_type: 'ephemeral',
            text: "A guide to Sir Reginald's duties.",
            blocks: [
                { type: 'header', text: { type: 'plain_text', text: "Sir Reginald's Compendium of Duties", emoji: true } },
                { type: 'divider' },
                { type: 'section', text: { type: 'mrkdwn', text: "*1. Getting Started: Channel Configuration*\nTo enlist my services in a new channel, simply invite me. I will present a button to configure my duties, which must be completed before I can manage events." } },
                { type: 'divider' },
                { type: 'section', text: { type: 'mrkdwn', text: "*2. For Administrators: Managing Event Types*\nUse the `/create-profile` command to define new types of events I can manage." } },
                { type: 'divider' },
                { type: 'section', text: { type: 'mrkdwn', text: "*3. Arranging & Listing Engagements*\n• `/create-event`: Opens a form to create a new event.\n• `/leave-event`: Opens a menu to leave an event you have joined.\n• `/list-events`: Shows a polished list of all upcoming events.\n• `/next-event`: Quickly shows the very next scheduled event.\n• `/my-events`: Displays a private list of all upcoming events you have joined." } },
                { type: 'divider' },
                { type: 'section', text: { type: 'mrkdwn', text: "*4. Managing Active Events*\n• `/add-roster [Event ID]`: Opens a form to add a new roster/tier to an event.\n• `/remove-roster [Event ID] [Roster Name]`: Removes an empty roster from an event.\n• `/delete-event [Event ID]`: Cancels an event and deletes its announcement (including scheduled ones)." } },
                { type: 'divider' },
                { type: 'section', text: { type: 'mrkdwn', text: "*5. For All Gentlefolk: Daily Use*\n• *Joining*: Click the 'Join Event' button on an announcement.\n• *Calendar & Emails*: Use the 'Add to Google Calendar' button or 'Copy Participant Emails' from the `...` menu on a message.\n• *Ask Me Anything*: Mention me (`@Sir Reginald Padelton IV`) or send me a Direct Message to ask about the 'next event' or your 'status'." } },
            ]
        });
    });
};



module.exports = registerCommandListeners;