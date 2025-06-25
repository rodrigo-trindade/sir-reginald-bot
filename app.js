// app.js
// Initializes the Slack Bolt app and the Express receiver.

const { App, LogLevel, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const CONFIG = require('./config');

// --- Initialize ExpressReceiver ---
const receiver = new ExpressReceiver({
  signingSecret: CONFIG.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
});

// --- Add JSON body parser middleware ---
receiver.app.use(express.json());

// --- NEW: Global Middleware for Enhanced Debugging ---
// This will log the body of EVERY single request coming to the receiver.
receiver.app.use((req, res, next) => {
    if (req.body) {
        console.log('--- INCOMING REQUEST ---');
        console.log('Path:', req.path);
        
        // This provides a clean summary of the event type for easy diagnosis.
        const eventSummary = {
            type: req.body.type,
            subtype: req.body.event?.subtype,
            callback_id: req.body.view?.callback_id,
            action_id: req.body.actions?.[0]?.action_id,
        };
        console.log('Event Summary:', eventSummary);
        
        // For 'message_posted' events, log the critical scheduled_message_id
        if (req.body.event?.subtype === 'message_posted') {
            console.log('CRITICAL_LOG: Received message_posted event. Scheduled Message ID:', req.body.event.previous_message?.scheduled_message_id);
        }
        
        console.log('----------------------');
    }
    next();
});

// --- Initialize Slack Bolt App ---
const app = new App({
  token: CONFIG.SLACK_BOT_TOKEN,
  receiver: receiver,
  logLevel: LogLevel.INFO,
});

module.exports = { app, receiver };
