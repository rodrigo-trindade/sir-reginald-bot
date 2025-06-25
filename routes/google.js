// routes/google.js
// Defines HTTP endpoints for the Google OAuth2 flow.

const { handleOAuthCallback } = require('../utils/google-calendar');
const db = require('../db');

const registerGoogleRoutes = (receiver) => {
    /**
     * This is the redirect URI that Google will call after a user authenticates.
     */
    receiver.app.get('/google/oauth/callback', async (req, res) => {
        try {
            const { code, state } = req.query;
            const slackUserId = state; // The Slack user ID we passed in the auth URL

            if (!code || !slackUserId) {
                return res.status(400).send("A 'code' and 'state' are required.");
            }

            const tokens = await handleOAuthCallback(code);
            await db.setUserTokens(slackUserId, tokens);
            
            res.send("Authentication successful! You may now close this window and return to Slack.");

        } catch (error) {
            console.error('Error in Google OAuth callback:', error);
            res.status(500).send("An error occurred during authentication.");
        }
    });
};

module.exports = registerGoogleRoutes;
