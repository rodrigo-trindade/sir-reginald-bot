// utils/view-builder.js
// A helper utility to construct complex or frequently updated Slack views.

/**
 * Builds the "Roster Editor" modal view.
 * @param {object} eventData The event data collected so far.
 * @returns {object} A Slack view payload.
 */
function buildRosterEditorView(eventData) {
    const rosterBlocks = eventData.rosters.flatMap((roster, index) => [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${roster.name}* - Capacity: ${roster.capacity}`
            }
        },
    ]);

    if (rosterBlocks.length === 0) {
        rosterBlocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '_No rosters have been added yet._' }
        });
    }

    return {
        type: 'modal',
        callback_id: 'create_event_step2_view', // Final submission
        private_metadata: JSON.stringify(eventData),
        title: { type: 'plain_text', text: 'Roster Editor (2/2)' },
        submit: { type: 'plain_text', text: 'Proclaim It' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `You are creating the event: *${eventData.title}*.\nPlease add one or more rosters.` } },
            { type: 'divider' },
            ...rosterBlocks,
            { type: 'divider' },
            {
                type: 'actions',
                elements: [
                    {
                        type: 'button',
                        text: { type: 'plain_text', text: 'Add Roster/Tier', emoji: true },
                        style: 'primary',
                        action_id: 'add_roster_button'
                    }
                ]
            }
        ]
    };
}

module.exports = { buildRosterEditorView };
