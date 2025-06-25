// utils/inquiry-handler.js
// Contains the logic for parsing and responding to user questions.

const chrono = require('chrono-node');
const { format: formatDate } = require('date-fns');
const db = require('../db');
const CONFIG = require('../config');

/**
 * Handles inquiries from users via DMs or app mentions.
 * @param {string} messageText The text of the user's message.
 * @param {string} userId The Slack ID of the user making the inquiry.
 * @returns {Promise<string>} The reply text to send to the user.
 */
async function handleInquiry(messageText, userId) {
    const lowerCaseText = messageText.toLowerCase();
    
    const parsedDateResult = chrono.parse(lowerCaseText);
    
    const nextMatchRegex = /(next event|next match|next game|upcoming)/i;
    const myStatusRegex = /(my status|am i in|am i playing)/i;
    const spotsLeftRegex = /(spots left|open spots|how many spots)/i;
    
    let replyText = "Your humble servant is at your disposal. You may inquire about the 'next event', ask about your 'status', or check how many 'spots are left'.";
    let session;
    let specificDateFound = false;
    let searchedDateString = "";

    if (parsedDateResult && parsedDateResult.length > 0) {
        const dateObj = parsedDateResult[0].start.date();
        searchedDateString = formatDate(dateObj, "EEEE, MMMM do");
        session = await db.findSessionByDateString(searchedDateString);
        specificDateFound = true;
    } else if (nextMatchRegex.test(lowerCaseText) || myStatusRegex.test(lowerCaseText) || spotsLeftRegex.test(lowerCaseText)) {
        session = await db.findNextSession();
    }

    if (!session) {
        if (specificDateFound) return `A noble query, but my archives show no scheduled contest for *${searchedDateString}*.`;
        return `My apologies, but I could not find an upcoming engagement to check against.`;
    }

    // From here, we know we have a session.
    const allPlayers = session.rosters.flatMap(r => r.players);
    const channelConfig = await db.getChannelConfig(session.postedMessages[0].channelId) || {};
    const reactionEmoji = channelConfig.reactionEmoji || CONFIG.DEFAULT_REACTION_EMOJI;

    if (myStatusRegex.test(lowerCaseText)) {
        const userRoster = session.rosters.find(r => r.players.some(p => p.id === userId));
        if (userRoster) {
            replyText = `Ah, a personal inquiry! Indeed, I have your name inscribed upon the roster for *${userRoster.name}* for the event *${session.title}* on *${session.bookingDate}*.`;
        } else if (session.standby.some(p => p.id === userId)) {
            replyText = `Fear not, for your name is securely held within the Reserve Contingent for *${session.title}*.`;
        } else {
            replyText = `A curious matter. It appears your name is not yet on any roster for *${session.title}*. Pray, use the :${reactionEmoji}: reaction on the proclamation should you wish to join.`;
        }
    } else if (spotsLeftRegex.test(lowerCaseText)) {
        const spotsLeft = session.maxCapacity - allPlayers.length;
        if (spotsLeft > 0) {
            replyText = `An astute question! For the event *${session.title}*, there remain *${spotsLeft}* positions awaiting worthy challengers.`;
        } else {
            replyText = `Alas, the rosters for *${session.title}* are at their full complement. However, you may still add your name to the Reserve Contingent.`;
        }
    } else { // Default case: user asked about the event in general
        const allRostersText = session.rosters.map(roster => {
            const playerMentions = roster.players.length > 0 ? roster.players.map(p => `<@${p.id}>`).join(', ') : '_None as of yet._';
            return `\n*${roster.name} (${roster.players.length}/${roster.capacity})*: ${playerMentions}`;
        }).join('');

        replyText = `The next scheduled engagement is *${session.title}* on *${session.bookingDate}* at *${session.bookingTime}*.`;
        replyText += `\n*Location:* ${session.location}`;
        replyText += allRostersText;

        if (session.standby.length > 0) {
            const standbyPlayers = session.standby.map(p => `<@${p.id}>`).join(', ');
            replyText += `\n*Awaiting the Call:* ${standbyPlayers}`;
        }
    }
  
    return replyText;
}

module.exports = {
    handleInquiry,
};
