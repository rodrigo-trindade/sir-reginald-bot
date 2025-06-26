# Sir Reginald - A Distinguished Slack Butler for Events

![Sir Reginald](https://i.postimg.cc/xdYdZSMT/sir-reginald-gemini.jpg) <!-- Replace with an actual image URL if you have one -->

Does the management of your social calendar prove to be a tiresome affair? Is the orchestration of a simple Padel match or football viewing a logistical bother? Fret not. I am Sir Reginald, and it is my singular duty to banish the chaos from your event planning.

Sir Reginald is a sophisticated, configurable Slack bot built with NodeJS that allows users to create, manage, and join any type of event, from sporting contests to social soirees, all within the convenience of Slack.

---

## Table of Contents

- [Features](#features)
- [Setup & Installation](#setup--installation)
  - [Prerequisites](#prerequisites)
  - [Slack App Configuration](#1-slack-app-configuration)
  - [Google Cloud Project Setup](#2-google-cloud-project-setup)
  - [Local Installation](#3-local-installation)
- [Usage Guide](#usage-guide)
  - [Initial Setup](#initial-setup)
  - [Slash Commands](#slash-commands)
  - [Message Shortcuts](#message-shortcuts)
  - [Conversational Use](#conversational-use)
- [Deployment & Automation](#deployment--automation)
  - [GitHub Actions](#github-actions)

---

## Features

- **Dynamic Event Profiles:** Create and manage different types of events (e.g., "Padel Match", "Football Viewing", "Board Game Night").
- **Channel-Specific Configuration:** Customize Sir Reginald's behavior for each channel, setting a default event type, reaction emoji, and more.
- **Multi-Tiered Rosters:** Create events with multiple rosters or seating tiers, each with its own capacity and guest policy (e.g., "Skybox: 16", "Court 1: 4").
- **Guest Support (+1/+2):** Allow participants to bring guests, with capacity correctly tracked.
- **Scheduled Announcements:** Create an event now and schedule the announcement to be posted at a future time.
- **Google Calendar Integration:** Users can authenticate their Google account and add events to their primary calendar with one click.
- **Admin-Only Controls:** Secure sensitive actions like deleting events or copying participant data to administrators.
- **Conversational Interface:** Ask Sir Reginald for information about events, your status, or spots left by mentioning him or sending a DM.

---

## Setup & Installation

### Prerequisites

- [Node.js](httpss://nodejs.org/) (v16 or higher)
- [MongoDB](httpss://www.mongodb.com/) account (a free Atlas cluster is sufficient)
- A [Slack Workspace](httpss://slack.com/) where you have permission to install apps.
- A [Google Cloud](httpss://console.cloud.google.com/) account.
- [ngrok](httpss://ngrok.com/) for local development to expose your local server to the internet.

### 1. Slack App Configuration

Before running the code, you must create and configure a Slack App.

1.  **Create the App:** Go to the [Slack API page](httpss://api.slack.com/apps) and click "Create New App" > "From scratch". Give it a name (e.g., "Sir Reginald") and select your workspace.

2.  **Add Scopes (Permissions):**
    - Navigate to **"OAuth & Permissions"**.
    - Scroll to **"Bot Token Scopes"** and add the following scopes:
      - `app_mentions:read`
      - `channels:history`
      - `chat:write`
      - `commands`
      - `groups:history`
      - `im:history`
      - `users:read`
      - `users:read.email`

3.  **Install the App:**
    - At the top of the **"OAuth & Permissions"** page, click "Install to Workspace" and authorize it.
    - Copy the **"Bot User OAuth Token"** (`xoxb-...`). You will need this for your `.env` file.

4.  **Enable Interactivity & Shortcuts:**
    - Navigate to **"Interactivity & Shortcuts"**.
    - Toggle it **On**.
    - For the **"Request URL"**, you will need a public URL. While developing locally, start ngrok (`ngrok http 3000`) and use the HTTPS URL it provides. The final URL should be `https://your-ngrok-url.ngrok-free.app/slack/events`.
    - **Create Message Shortcuts:**
      - Click "Create New Shortcut" > "On a message" and create the following:
        1.  **Name:** `Copy Participant Emails`, **Callback ID:** `copy_emails`
        2.  **Name:** `Copy Event ID`, **Callback ID:** `copy_event_id`
        3.  **Name:** `Share Event`, **Callback ID:** `share_event_shortcut`
    - Save your changes.

5.  **Enable Event Subscriptions:**
    - Navigate to **"Event Subscriptions"**.
    - Toggle it **On**.
    - Enter the same **"Request URL"** you used for interactivity. It should show a "Verified" checkmark.
    - Scroll to **"Subscribe to bot events"** and add the following events:
      - `app_mention`
      - `member_joined_channel`
      - `message.channels`
      - `message.groups`
      - `message.im`
    - Save your changes.

6.  **Get Signing Secret:**
    - Navigate to **"Basic Information"**.
    - Scroll to **"App Credentials"** and copy the **"Signing Secret"**. You will need this.

### 2. Google Cloud Project Setup

1.  **Create Project & Enable API:**
    - In the [Google Cloud Console](httpss://console.cloud.google.com/), create a new project.
    - Go to "APIs & Services" > "Library" and enable the **"Google Calendar API"**.

2.  **Configure OAuth Consent Screen:**
    - Go to "APIs & Services" > "OAuth consent screen".
    - Choose **External** and fill in the required app details.
    - **Scopes:** Add the `https://www.googleapis.com/auth/calendar.events` scope.
    - **Test Users:** Add the Google accounts of anyone who will be testing the integration.
    - **Publish App:** Once you are ready for anyone to use it, return to this screen and click **"Publish App"**.

3.  **Create Credentials:**
    - Go to "APIs & Services" > "Credentials".
    - Click "+ Create Credentials" > "OAuth client ID".
    - **Application type:** "Web application".
    - **Authorized redirect URIs:** Add your public URL + `/google/oauth/callback`. (e.g., `https://your-ngrok-url.ngrok-free.app/google/oauth/callback`).
    - Copy the **"Client ID"** and **"Client Secret"**.

### 3. Local Installation

1.  **Clone the Repository:**
    ```bash
    git clone <your-repo-url>
    cd <repo-name>
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Create `.env` File:**
    - Rename `.env.example` to `.env`.
    - Fill in all the required values you copied from the steps above:
      ```
      SLACK_BOT_TOKEN="..."
      SLACK_SIGNING_SECRET="..."
      MONGODB_URI="..."
      GOOGLE_CLIENT_ID="..."
      GOOGLE_CLIENT_SECRET="..."
      GOOGLE_REDIRECT_URI="..."
      CRON_SECRET_TOKEN="..." # A long, random string for securing task endpoints
      ```

4.  **Run the Bot:**
    ```bash
    npm start
    ```

---

## Usage Guide

### Initial Setup

1.  **Invite Sir Reginald:** In any channel where you want to manage events, type `/invite @Sir Reginald` to add him.
2.  **Configure the Channel:** Sir Reginald will post a message with a "Configure" button. An administrator must click this to set the channel's default event type, reaction emoji, etc. **The bot will not respond to commands in an unconfigured channel.**
3.  **Create Event Profiles:** As an administrator, use the `/create-profile` command to define the types of events you want to run (e.g., "Padel Match", "Football Viewing").

### Slash Commands

- `/help-reginald`: Displays a comprehensive help message.
- `/create-event`: Opens a multi-step form to create and schedule a new event.
- `/list-events`: Shows a polished list of all upcoming events.
- `/next-event`: Quickly shows the very next scheduled event.
- `/my-events`: Displays a private list of all upcoming events you have joined.
- `/leave-event`: Opens a menu to leave an event you have joined.
- `/whos-in`: Opens a menu to see the roster for any upcoming event.
- `/add-roster [Event ID]`: Adds a new roster/tier to an existing event.
- `/remove-roster [Event ID] [Roster Name]`: Removes an empty roster from an event.
- `/gcal-login`: Provides a link to authenticate your Google account.
- `/create-profile` (Admin): Opens a form to define a new event type.
- `/delete-event [Event ID]` (Admin): Cancels an event and deletes its announcements.

### Message Shortcuts

Access these from the `...` menu on any event message:

- **Share Event** (Admin): Shares the event announcement in another channel.
- **Copy Participant Emails** (Admin): Shows you a comma-separated list of attendee emails.
- **Copy Event ID** (Admin): Shows you the unique ID for the event.

### Conversational Use

Mention `@Sir Reginald` or send him a Direct Message to ask about:

- `"next event"`
- `"my events"`
- `"all events"`
- `"my status"`
- `"spots left"`

---

## Deployment & Automation

### GitHub Actions

The repository includes a GitHub Action workflow in `.github/workflows/post_events.yml` that runs every 4 hours. Its purpose is to call an endpoint on the bot to post any scheduled event announcements that are due.

For this to work in your deployed environment, you must configure the following secrets in your GitHub repository's settings (**Settings > Secrets and variables > Actions**):

- `APP_URL`: The full, public URL of your deployed application (e.g., `https://your-app-name.onrender.com`).
- `CRON_SECRET`: The same long, random string you set for `CRON_SECRET_TOKEN` in your `.env` file.
