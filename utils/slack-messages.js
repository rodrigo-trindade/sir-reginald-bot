// utils/slack-messages.js
// Contains functions for formatting and updating Slack messages.

const CONFIG = require('../config');

function formatEventMessage(session, channelConfig, customIntro = null) {
  const { _id: eventId, title, bookingDate, bookingTime, location, rosters, standby, description, venueCode } = session;
  
  const displayEmoji = channelConfig?.displayEmoji || CONFIG.DEFAULT_DISPLAY_EMOJI;
  
  const standbyMentions = standby.map(player => `<@${player.id}>` + (player.plusOneCount > 0 ? ` (+${player.plusOneCount})` : '')).join('\n- ') || '_Presently vacant_';
  
  const rosterBlocks = rosters.map(roster => {
    const playerMentions = roster.players.map(player => `<@${player.id}>` + (player.plusOneCount > 0 ? ` (+${player.plusOneCount})` : '')).join('\n- ') || '_Awaiting participants_';
    const currentRosterSize = roster.players.reduce((total, player) => {
        const guests = Number(player.plusOneCount) || 0;
        return total + 1 + guests;
    }, 0);

    return { type: 'section', text: { type: 'mrkdwn', text: `*The Roster for ${roster.name}* (${currentRosterSize}/${roster.capacity})\n- ${playerMentions}` } };
  });
  
  const currentTotalPlayers = session.rosters.reduce((acc, roster) => {
      const rosterSize = roster.players.reduce((pAcc, p) => pAcc + 1 + (Number(p.plusOneCount) || 0), 0);
      return acc + rosterSize;
  }, 0);
  const maxCapacity = session.rosters.reduce((acc, roster) => acc + roster.capacity, 0);

  let introText = customIntro || `A summons, esteemed gentlefolk! :${displayEmoji}:\n\nArrangements have been made for the event of *${title}* upon *${bookingDate}*.`;
  if (description) introText += `\n\n_${description}_`;
  
  let mainDetails = `*The Particulars:*\n• :clock530: *Hour of Engagement:* ${bookingTime}\n• :round_pushpin: *Location:* ${location}\n• :busts_in_silhouette: *Total Capacity:* ${currentTotalPlayers} of ${maxCapacity} positions filled`;
  if (venueCode) mainDetails += `\n• :key: *Entry Cipher:* ${venueCode}`;

  const actionsBlock = {
      type: 'actions',
      elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Join Event', emoji: true }, style: 'primary', action_id: 'join_event_button', value: eventId },
          { type: 'button', text: { type: 'plain_text', text: 'Add to Google Calendar', emoji: true }, action_id: 'add_to_gcal_button', value: eventId }
      ]
  };
  
  // --- FIX: Embed the event ID in a non-visible block_id ---
  // This is a robust way to pass data without cluttering the UI.
  const idDividerBlock = {
      type: 'divider',
      block_id: `event_id::${eventId}`
  };

  return [
    { type: 'section', text: { type: 'mrkdwn', text: introText } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: mainDetails } },
    { type: 'section', text: { type: 'mrkdwn', text: "Use the 'Join Event' button to sign up. To leave, use the `/leave-event` command." } },
    actionsBlock,
    { type: 'divider' },
    ...rosterBlocks,
    { type: 'section', text: { type: 'mrkdwn', text: `*The Reserve Contingent* :hourglass_flowing_sand: (${standby.length}):\n- ${standbyMentions}` } },
    idDividerBlock // Use the divider with the embedded ID
  ];
}

async function updateAllEventMessages(session, channelConfig, client, logger, botToken) {
    if (!session || !session.postedMessages || !session.postedMessages.length === 0) {
        logger.warn('Slack: Cannot update messages, session data is invalid or has no messages.', session);
        return;
    }
    const blocks = formatEventMessage(session, channelConfig);
    const updatePromises = session.postedMessages.map(msg =>
        client.chat.update({
            token: botToken, channel: msg.channelId, ts: msg.messageTs, blocks: blocks,
            text: `The roster for the event "${session.title}" on ${session.bookingDate} has been amended.`,
        }).catch(err => logger.error(`Failed to update message ${msg.messageTs} in channel ${msg.channelId}`, err))
    );
    await Promise.all(updatePromises);
}

module.exports = {
    formatEventMessage,
    updateAllEventMessages,
};
