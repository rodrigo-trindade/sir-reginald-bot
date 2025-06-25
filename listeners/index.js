// listeners/index.js
// A central file to import and register all event listeners.

const registerCommandListeners = require('./commands');
const { registerEventHandlers } = require('./events'); // <-- FIX: Destructure the import here
const registerViewListeners = require('./views');
const registerActionListeners = require('./actions');
const registerShortcutListeners = require('./shortcuts'); // New

module.exports = function registerListeners(app) {
    registerCommandListeners(app);
    registerEventHandlers(app);
    registerViewListeners(app);
    registerActionListeners(app);
    registerShortcutListeners(app);
};
