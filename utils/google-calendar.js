// utils/google-calendar.js
// Handles all interactions with the Google Calendar API.

const { google } = require('googleapis');
const { addHours } = require('date-fns');
const CONFIG = require('../config');
const db = require('../db');

// Create a new OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  CONFIG.GOOGLE_CLIENT_ID,
  CONFIG.GOOGLE_CLIENT_SECRET,
  CONFIG.GOOGLE_REDIRECT_URI
);

/**
 * Generates the authentication URL for the user to click.
 * @param {string} slackUserId The Slack user's ID, to be passed in the state.
 * @returns {string} The full authentication URL.
 */
function getAuthUrl(slackUserId) {
  const scopes = ['https://www.googleapis.com/auth/calendar.events'];
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline', // Request a refresh token
    prompt: 'consent', // Force consent screen to get a refresh token every time
    scope: scopes,
    state: slackUserId, // Pass the Slack user ID through the flow
  });
}

/**
 * Handles the OAuth2 callback from Google.
 * @param {string} code The authorization code from Google.
 * @returns {Promise<object>} The tokens from Google.
 */
async function handleOAuthCallback(code) {
  const { tokens } = await oAuth2Client.getToken(code);
  return tokens;
}

/**
 * Creates a Google Calendar event.
 * @param {string} slackUserId The ID of the user creating the event.
 * @param {object} event The event object from our database.
 * @returns {Promise<object>} The created calendar event data.
 */
async function createCalendarEvent(slackUserId, event) {
  const tokenData = await db.getUserTokens(slackUserId);
  if (!tokenData) {
    throw new Error('User not authenticated with Google.');
  }

  oAuth2Client.setCredentials(tokenData.tokens);
  
  // Refresh the token if it's expired
  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      // A new refresh token is sometimes issued. Store it.
      tokenData.tokens.refresh_token = tokens.refresh_token;
    }
    tokenData.tokens.access_token = tokens.access_token;
    db.setUserTokens(slackUserId, tokenData.tokens);
  });

  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

  const startTime = new Date(event.bookingFullDate);
  const endTime = addHours(startTime, 1.5); // Assume 1.5 hour duration

  const allAttendees = [
    ...event.rosters.flatMap(r => r.players),
    ...event.standby,
  ];
  const attendees = allAttendees
    .map(p => p.email)
    .filter(email => email)
    .map(email => ({ email }));

  const calendarEvent = {
    summary: event.title,
    location: event.location,
    description: event.description || `An engagement arranged by Sir Reginald.`,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'UTC',
    },
    attendees: attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: calendarEvent,
  });

  return response.data;
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  createCalendarEvent,
};
