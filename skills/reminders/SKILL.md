# Reminders Skill

## What It Does
The reminders skill allows you to set, manage, and receive reminders via Discord. It parses natural language time expressions, stores reminders persistently, and proactively delivers them when they're due. The system runs a background ticker that checks for due reminders every 60 seconds and sends them to your configured Discord channel.

## When to Use It
Use this skill when Rob wants to:
- Set a reminder for a future time or date
- Check what reminders are pending
- Cancel or modify existing reminders
- Review recently sent reminders
- Get reminded about tasks, appointments, or follow-ups

The skill is ideal for time-sensitive tasks, follow-ups, or anything that needs to be remembered at a specific time.

## Example Trigger Phrases
- "Remind me to check on the deployment tomorrow at 9am"
- "Set a reminder for Friday at 3pm to call the dentist"
- "Remind me in 2 hours to take a break"
- "What reminders do I have?"
- "Show my pending reminders"
- "Cancel the dentist reminder"
- "Snooze that for 30 minutes"
- "Show reminder history"
- "What reminders have been sent?"

## Supported Time Expressions
The skill supports a wide range of natural language time formats:

### Relative Times
- "in X minutes" / "in X hours" / "in X days" / "in X weeks"
- Examples: "in 30 minutes", "in 2 hours", "in 3 days"

### Day References
- "tomorrow" (defaults to 9am)
- "tomorrow at 2pm"
- "tonight" (defaults to 8pm)
- "this afternoon" (defaults to 2pm)
- "this morning" (defaults to 9am)

### Day of Week
- "monday" / "tuesday" / etc (defaults to 9am)
- "friday at 3pm"
- "next monday at 10am"

### Specific Times
- "at 3pm" (today, or tomorrow if 3pm has passed)
- "at 10:30am"
- "2:45pm"

## Actions

### create
Creates a new reminder.

**Parameters:**
- `message` (required): The reminder message
- `time` (required): Natural language time expression

**Example:**
```
Action: create
Message: "Check on the deployment"
Time: "tomorrow at 9am"
```

### list
Lists all pending reminders with their scheduled times.

**Parameters:** None

**Example:**
```
Action: list
```

### cancel
Cancels a reminder by ID or by searching the message text.

**Parameters:**
- `id` (optional): The reminder ID
- `searchText` (optional): Text to search for in reminder messages

**Example:**
```
Action: cancel
SearchText: "dentist"
```

### snooze
Delays a reminder by a specified duration (defaults to 15 minutes).

**Parameters:**
- `id` (required): The reminder ID
- `duration` (optional): Snooze duration like "30 minutes" or "1 hour"

**Example:**
```
Action: snooze
ID: abc123
Duration: "30 minutes"
```

### history
Shows recently sent reminders (kept for 30 days).

**Parameters:** None

**Example:**
```
Action: history
```

## Data Storage
Reminders are stored in `data/reminders.json` with this structure:
```json
{
  "pending": [
    {
      "id": "abc123",
      "message": "Check deployment",
      "createdAt": "2026-02-14T10:00:00.000Z",
      "dueAt": "2026-02-15T09:00:00.000Z",
      "status": "pending"
    }
  ],
  "sent": [
    {
      "id": "xyz789",
      "message": "Previous reminder",
      "createdAt": "2026-02-13T10:00:00.000Z",
      "dueAt": "2026-02-14T09:00:00.000Z",
      "status": "sent",
      "sentAt": "2026-02-14T09:00:15.000Z"
    }
  ]
}
```

Sent reminders are automatically cleaned after 30 days.

## Timezone
All times are processed and stored in **Australia/Sydney timezone (AEDT/AEST)**. The system handles daylight saving time transitions automatically.

## Integration Requirements
This skill requires initialization at bot startup. In your `src/discord.js` or `src/index.js` file, you need to call the skill's `init` function:

```javascript
// Load the reminders skill
const remindersSkill = await import('file:///path/to/skills/reminders/handler.js');

// Initialize with Discord client (after client is ready)
await remindersSkill.init(client);
```

## Environment Variables
- `REMINDER_CHANNEL_ID`: Discord channel ID for sending reminders (optional)
- `WAKE_CHANNEL_ID`: Fallback channel ID if REMINDER_CHANNEL_ID is not set

## Background Ticker
The skill runs a background interval that:
- Checks every 60 seconds for due reminders
- Sends due reminders to Discord proactively
- Moves sent reminders from pending to sent history
- Cleans up sent reminders older than 30 days
- On startup, immediately fires any reminders that were missed while the bot was offline

## Error Handling
The background ticker is resilient to errors:
- Errors in one reminder won't crash the entire loop
- Failed Discord sends are logged but don't block other reminders
- File I/O errors are logged and won't crash the bot

## Discord Message Format
When a reminder fires, it's sent to Discord as:
```
⏰ **Reminder:** {your reminder message}
```

## Technical Details
- **Zero dependencies**: Uses only Node.js built-ins (no npm packages)
- **Custom time parser**: Handles natural language without external libraries
- **ES modules**: Uses import/export syntax
- **Windows compatible**: All file paths use `path.resolve()`
- **Persistent storage**: Survives bot restarts and promotions
- **Async writes**: File operations are async to avoid blocking
