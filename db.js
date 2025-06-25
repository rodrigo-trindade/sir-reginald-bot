// db.js
// Handles all interactions with the MongoDB database.

const { MongoClient } = require('mongodb');
const { MONGODB_URI, DB_NAME, EVENT_COLLECTION, CHANNEL_CONFIG_COLLECTION, PROFILE_COLLECTION, USER_TOKENS_COLLECTION } = require('./config');

const client = new MongoClient(MONGODB_URI);
let eventCollection;
let channelConfigCollection;
let profileCollection;
let userTokensCollection;

async function connectDB() {
  try {
    console.log('Connecting to the MongoDB archives...');
    await client.connect();
    console.log('The connection to the archives is sound.');
    const db = client.db(DB_NAME);
    
    eventCollection = db.collection(EVENT_COLLECTION);
    channelConfigCollection = db.collection(CHANNEL_CONFIG_COLLECTION);
    profileCollection = db.collection(PROFILE_COLLECTION);
    userTokensCollection = db.collection(USER_TOKENS_COLLECTION);
    
    await eventCollection.createIndex({ "postedMessages.messageTs": 1 });
    await eventCollection.createIndex({ bookingFullDate: 1 });
    await eventCollection.createIndex({ scheduledMessageId: 1 });
  } catch (error) {
    console.error("💥 A grievous error occurred while connecting to the database.", error);
    await client.close();
    process.exit(1);
  }
}

const upsert = (collection, doc) => {
    const { _id, ...dataToSet } = doc;
    return collection.updateOne({ _id: _id }, { $set: dataToSet }, { upsert: true });
};

// --- New function to check for admin privileges ---
async function isUserChannelAdmin(channelId, userId) {
    const config = await channelConfigCollection.findOne({ _id: channelId });
    // The user is an admin if they are the one who configured the channel.
    return config && config.configuredBy === userId;
}

async function setUserTokens(slackUserId, tokens) { return userTokensCollection.updateOne({ _id: slackUserId }, { $set: { tokens, updatedAt: new Date() } }, { upsert: true }); }
async function getUserTokens(slackUserId) { return userTokensCollection.findOne({ _id: slackUserId }); }

async function setEventProfile(profileData) { return upsert(profileCollection, profileData); }
async function getEventProfile(profileName) { return profileCollection.findOne({ _id: profileName }); }
async function getAllEventProfiles() { return profileCollection.find().sort({ _id: 1 }).toArray(); }

async function getChannelConfig(channelId) { return channelConfigCollection.findOne({ _id: channelId }); }
async function setChannelConfig(config) { return upsert(channelConfigCollection, config); }

async function findSessionByMessageTs(messageTs) { return eventCollection.findOne({ "postedMessages.messageTs": messageTs }); }
async function findSessionById(eventId) { return eventCollection.findOne({ _id: eventId }); }
async function findSessionByScheduledId(scheduledMessageId) { return eventCollection.findOne({ scheduledMessageId }); }
async function findNextSession() { const today = new Date(); today.setUTCHours(0, 0, 0, 0); return eventCollection.find({ bookingFullDate: { $gte: today.toISOString() } }).sort({ bookingFullDate: 1 }).limit(1).next(); }
async function findAllUpcomingSessions() { const today = new Date(); today.setUTCHours(0, 0, 0, 0); return eventCollection.find({ bookingFullDate: { $gte: today.toISOString() } }).sort({ bookingFullDate: 1 }).toArray(); }
async function setSessionState(sessionData) { return upsert(eventCollection, sessionData); }
async function deleteSessionState(bookingId) { const result = await eventCollection.deleteOne({ _id: bookingId }); return result.deletedCount > 0; }
async function findEventsByUser(userId) { const today = new Date(); today.setUTCHours(0, 0, 0, 0); return eventCollection.find({ bookingFullDate: { $gte: today.toISOString() }, $or: [ { "rosters.players.id": userId }, { "standby.id": userId } ] }).sort({ bookingFullDate: 1 }).toArray(); }
// --- New function for the internal scheduler ---
async function findPendingScheduledEvents() {
  const nowTimestamp = Math.floor(Date.now() / 1000);
  return eventCollection.find({
      status: 'SCHEDULED',
      postAt: { $lte: nowTimestamp }
  }).toArray();
}
module.exports = {
  connectDB,
  isUserChannelAdmin,
  setUserTokens,
  getUserTokens,
  setEventProfile,
  getEventProfile,
  getAllEventProfiles,
  getChannelConfig,
  setChannelConfig,
  findSessionByMessageTs,
  findSessionById,
  findPendingScheduledEvents,
  findSessionByScheduledId,
  findNextSession,
  findAllUpcomingSessions,
  setSessionState,
  deleteSessionState,
  findEventsByUser,
};
