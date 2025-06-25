// config.js
// Manages environment variables and application-wide constants.

const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, MONGODB_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, CRON_SECRET_TOKEN } = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET || !MONGODB_URI || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !CRON_SECRET_TOKEN) {
  const errorMessage = '💥 ERROR: Missing required environment variables. Ensure all Slack, Google, and CRON_SECRET_TOKEN variables are set.';
  console.error(errorMessage);
  throw new Error(errorMessage);
}

const CONFIG = {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  MONGODB_URI,
  DB_NAME: 'eventsBotDB',
  EVENT_COLLECTION: 'events',
  CHANNEL_CONFIG_COLLECTION: 'channelConfigs',
  PROFILE_COLLECTION: 'eventProfiles',
  USER_TOKENS_COLLECTION: 'userTokens',
  CRON_SECRET_TOKEN, // New secret for securing the task endpoint
  DEFAULT_TIME: '17:30',
  DEFAULT_REACTION_EMOJI: 'hand',
  DEFAULT_DISPLAY_EMOJI: 'scroll',
};

module.exports = CONFIG;
