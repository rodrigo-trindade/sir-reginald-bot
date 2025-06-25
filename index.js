// index.js
// The main entry point for the application.

require('dotenv').config();

const { app, receiver } = require('./app');
const { connectDB } = require('./db');
const registerListeners = require('./listeners');
const registerTaskRoutes = require('./routes/tasks');
const registerGoogleRoutes = require('./routes/google');

async function start() {
  try {
    await connectDB();
    registerListeners(app);
    registerTaskRoutes(receiver, app.client, app.logger);
    registerGoogleRoutes(receiver);

    const port = process.env.PORT || 3000;
    await app.start(port);
    console.log(`🧐 Sir Reginald Padelton IV is at your service, listening on port ${port}.`);
  } catch (error) {
    console.error('💥 A most grievous error has occurred during startup:', error);
    process.exit(1);
  }
}

start();
