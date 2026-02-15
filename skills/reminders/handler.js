import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Australia/Sydney timezone offset handling
const TIMEZONE = 'Australia/Sydney';

// Storage
const DATA_DIR = path.resolve(__dirname, 'data');
const REMINDERS_FILE = path.resolve(DATA_DIR, 'reminders.json');

// Background ticker state
let discordClient = null;
let reminderChannelId = null;
let tickerInterval = null;

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Load reminders from disk
function loadReminders() {
  ensureDataDir();
  if (!fs.existsSync(REMINDERS_FILE)) {
    return { pending: [], sent: [] };
  }
  try {
    const data = fs.readFileSync(REMINDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[Reminders] Failed to load reminders:', error);
    return { pending: [], sent: [] };
  }
}

// Save reminders to disk
async function saveReminders(reminders) {
  ensureDataDir();
  try {
    await fs.promises.writeFile(
      REMINDERS_FILE,
      JSON.stringify(reminders, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('[Reminders] Failed to save reminders:', error);
  }
}

// Generate short ID
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Get current time in Sydney timezone
function getNowInSydney() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

// Convert Date to ISO string with Sydney timezone context
function toSydneyISO(date) {
  // Store as ISO but we'll parse it back through Sydney timezone
  return date.toISOString();
}

// Parse natural language time expressions
function parseNaturalTime(timeStr) {
  const now = getNowInSydney();
  const input = timeStr.toLowerCase().trim();

  // "in X minutes/hours/days/weeks"
  const inPattern = /^in (\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)$/;
  const inMatch = input.match(inPattern);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const result = new Date(now);

    if (unit.startsWith('min')) {
      result.setMinutes(result.getMinutes() + amount);
    } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
      result.setHours(result.getHours() + amount);
    } else if (unit.startsWith('day')) {
      result.setDate(result.getDate() + amount);
    } else if (unit.startsWith('week')) {
      result.setDate(result.getDate() + (amount * 7));
    }

    return result;
  }

  // "tomorrow at Xpm/Xam" or "tomorrow at X:XXpm/am" or just "tomorrow"
  const tomorrowPattern = /^tomorrow(?:\s+at\s+(.+))?$/;
  const tomorrowMatch = input.match(tomorrowPattern);
  if (tomorrowMatch) {
    const result = new Date(now);
    result.setDate(result.getDate() + 1);

    if (tomorrowMatch[1]) {
      const time = parseTime(tomorrowMatch[1]);
      if (time) {
        result.setHours(time.hours, time.minutes, 0, 0);
      } else {
        result.setHours(9, 0, 0, 0); // Default to 9am
      }
    } else {
      result.setHours(9, 0, 0, 0); // Default to 9am
    }

    return result;
  }

  // "tonight" - default to 8pm today
  if (input === 'tonight') {
    const result = new Date(now);
    result.setHours(20, 0, 0, 0);
    if (result <= now) {
      result.setDate(result.getDate() + 1); // If 8pm has passed, next day
    }
    return result;
  }

  // "this afternoon" - default to 2pm today
  if (input === 'this afternoon' || input === 'afternoon') {
    const result = new Date(now);
    result.setHours(14, 0, 0, 0);
    if (result <= now) {
      result.setDate(result.getDate() + 1); // If 2pm has passed, next day
    }
    return result;
  }

  // "this morning" - default to 9am today or tomorrow
  if (input === 'this morning' || input === 'morning') {
    const result = new Date(now);
    result.setHours(9, 0, 0, 0);
    if (result <= now) {
      result.setDate(result.getDate() + 1);
    }
    return result;
  }

  // Day of week patterns: "monday at 3pm", "next friday at 10am", "friday"
  const dayOfWeekPattern = /^(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(.+))?$/;
  const dowMatch = input.match(dayOfWeekPattern);
  if (dowMatch) {
    const isNext = !!dowMatch[1];
    const dayName = dowMatch[2];
    const timeStr = dowMatch[3];

    const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayName);
    const currentDay = now.getDay();

    let daysToAdd = targetDay - currentDay;
    if (daysToAdd < 0 || (daysToAdd === 0 && !isNext)) {
      daysToAdd += 7;
    }
    if (isNext && daysToAdd === 0) {
      daysToAdd = 7;
    }

    const result = new Date(now);
    result.setDate(result.getDate() + daysToAdd);

    if (timeStr) {
      const time = parseTime(timeStr);
      if (time) {
        result.setHours(time.hours, time.minutes, 0, 0);
      } else {
        result.setHours(9, 0, 0, 0);
      }
    } else {
      result.setHours(9, 0, 0, 0);
    }

    return result;
  }

  // "at Xpm/Xam today" or just "at Xpm" (assumes today, or tomorrow if time has passed)
  const atPattern = /^(?:at\s+)?(.+?)(?:\s+today)?$/;
  const atMatch = input.match(atPattern);
  if (atMatch) {
    const time = parseTime(atMatch[1]);
    if (time) {
      const result = new Date(now);
      result.setHours(time.hours, time.minutes, 0, 0);

      // If the time has passed today, schedule for tomorrow
      if (result <= now) {
        result.setDate(result.getDate() + 1);
      }

      return result;
    }
  }

  return null;
}

// Parse time strings like "3pm", "10am", "15:30", "2:30pm"
function parseTime(timeStr) {
  const input = timeStr.toLowerCase().trim();

  // "3pm", "10am"
  const simplePattern = /^(\d{1,2})\s*(am|pm)$/;
  const simpleMatch = input.match(simplePattern);
  if (simpleMatch) {
    let hours = parseInt(simpleMatch[1]);
    const meridiem = simpleMatch[2];

    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes: 0 };
  }

  // "2:30pm", "10:15am", "14:30"
  const colonPattern = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/;
  const colonMatch = input.match(colonPattern);
  if (colonMatch) {
    let hours = parseInt(colonMatch[1]);
    const minutes = parseInt(colonMatch[2]);
    const meridiem = colonMatch[3];

    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  return null;
}

// Format date for display
function formatDate(isoString) {
  const date = new Date(isoString);
  const sydney = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[sydney.getDay()];
  const month = months[sydney.getMonth()];
  const day = sydney.getDate();
  const hours = sydney.getHours();
  const minutes = sydney.getMinutes();

  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');

  return `${dayName} ${month} ${day} at ${displayHours}:${displayMinutes}${ampm}`;
}

// Background ticker - checks every 60 seconds
async function checkReminders() {
  try {
    const reminders = loadReminders();
    const now = getNowInSydney();
    let changed = false;

    // Check for due reminders
    for (const reminder of reminders.pending) {
      const dueDate = new Date(reminder.dueAt);
      const sydneyDue = new Date(dueDate.toLocaleString('en-US', { timeZone: TIMEZONE }));

      if (sydneyDue <= now) {
        // Fire the reminder
        await sendReminderToDiscord(reminder);

        // Move to sent
        reminder.status = 'sent';
        reminder.sentAt = toSydneyISO(now);
        reminders.sent.push(reminder);

        changed = true;
      }
    }

    // Remove sent reminders from pending
    if (changed) {
      reminders.pending = reminders.pending.filter(r => r.status === 'pending');
      await saveReminders(reminders);
    }

    // Clean old sent reminders (older than 30 days)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const originalSentCount = reminders.sent.length;
    reminders.sent = reminders.sent.filter(r => {
      const sentDate = new Date(r.sentAt);
      return sentDate > thirtyDaysAgo;
    });

    if (reminders.sent.length < originalSentCount) {
      await saveReminders(reminders);
    }
  } catch (error) {
    console.error('[Reminders] Error in checkReminders:', error);
  }
}

// Send reminder to Discord
async function sendReminderToDiscord(reminder) {
  if (!discordClient || !reminderChannelId) {
    console.error('[Reminders] Discord client or channel not configured');
    return;
  }

  try {
    const channel = await discordClient.channels.fetch(reminderChannelId);
    if (channel) {
      await channel.send(`⏰ **Reminder:** ${reminder.message}`);
    }
  } catch (error) {
    console.error('[Reminders] Failed to send reminder to Discord:', error);
  }
}

// Initialize the reminders system
export async function init(client) {
  discordClient = client;
  reminderChannelId = process.env.REMINDER_CHANNEL_ID || process.env.WAKE_CHANNEL_ID;

  console.log('[Reminders] Initializing with channel:', reminderChannelId);

  // Check for missed reminders
  const reminders = loadReminders();
  const now = getNowInSydney();
  let changed = false;

  for (const reminder of reminders.pending) {
    const dueDate = new Date(reminder.dueAt);
    const sydneyDue = new Date(dueDate.toLocaleString('en-US', { timeZone: TIMEZONE }));

    if (sydneyDue <= now) {
      console.log('[Reminders] Firing missed reminder:', reminder.message);
      await sendReminderToDiscord(reminder);

      reminder.status = 'sent';
      reminder.sentAt = toSydneyISO(now);
      reminders.sent.push(reminder);
      changed = true;
    }
  }

  if (changed) {
    reminders.pending = reminders.pending.filter(r => r.status === 'pending');
    await saveReminders(reminders);
  }

  // Start background ticker (every 60 seconds)
  if (tickerInterval) {
    clearInterval(tickerInterval);
  }
  tickerInterval = setInterval(checkReminders, 60000);

  console.log('[Reminders] Background ticker started');
}

// Tool definition
export const toolDefinition = {
  name: 'reminders',
  description: 'Set, manage, and deliver reminders for Rob. Supports natural language time expressions like "tomorrow at 2pm", "in 2 hours", "next Friday morning". Reminders are delivered proactively via Discord.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'cancel', 'snooze', 'history'],
        description: 'The action to perform: create (new reminder), list (show pending), cancel (remove reminder), snooze (delay reminder), history (show sent reminders)'
      },
      message: {
        type: 'string',
        description: 'The reminder message (required for create action)'
      },
      time: {
        type: 'string',
        description: 'Natural language time expression (required for create action). Examples: "tomorrow at 2pm", "in 2 hours", "next Friday at 10am", "tonight", "Monday at 3pm"'
      },
      id: {
        type: 'string',
        description: 'Reminder ID (for cancel or snooze actions)'
      },
      searchText: {
        type: 'string',
        description: 'Text to search for in reminder messages (alternative to id for cancel action)'
      },
      duration: {
        type: 'string',
        description: 'Snooze duration in natural language (optional for snooze action, defaults to "15 minutes"). Examples: "30 minutes", "1 hour", "2 hours"'
      }
    },
    required: ['action']
  }
};

// Execute function
export async function execute(input) {
  const { action, message, time, id, searchText, duration } = input;

  switch (action) {
    case 'create': {
      if (!message || !time) {
        return { success: false, error: 'Both message and time are required for create action' };
      }

      const dueDate = parseNaturalTime(time);
      if (!dueDate) {
        return { success: false, error: `Could not parse time expression: "${time}". Try formats like "tomorrow at 2pm", "in 2 hours", "next Friday at 10am"` };
      }

      const now = getNowInSydney();
      if (dueDate <= now) {
        return { success: false, error: 'Reminder time must be in the future' };
      }

      const reminder = {
        id: generateId(),
        message,
        createdAt: toSydneyISO(now),
        dueAt: toSydneyISO(dueDate),
        status: 'pending'
      };

      const reminders = loadReminders();
      reminders.pending.push(reminder);
      await saveReminders(reminders);

      return {
        success: true,
        message: `Reminder set for ${formatDate(reminder.dueAt)}`,
        reminder: {
          id: reminder.id,
          message: reminder.message,
          dueAt: formatDate(reminder.dueAt)
        }
      };
    }

    case 'list': {
      const reminders = loadReminders();

      if (reminders.pending.length === 0) {
        return { success: true, message: 'No pending reminders', reminders: [] };
      }

      const formatted = reminders.pending.map(r => ({
        id: r.id,
        message: r.message,
        dueAt: formatDate(r.dueAt)
      }));

      return {
        success: true,
        count: reminders.pending.length,
        reminders: formatted
      };
    }

    case 'cancel': {
      if (!id && !searchText) {
        return { success: false, error: 'Either id or searchText is required for cancel action' };
      }

      const reminders = loadReminders();
      let cancelledReminder = null;

      if (id) {
        const index = reminders.pending.findIndex(r => r.id === id);
        if (index === -1) {
          return { success: false, error: `No reminder found with id: ${id}` };
        }
        cancelledReminder = reminders.pending[index];
        reminders.pending.splice(index, 1);
      } else {
        // Fuzzy search by text
        const matches = reminders.pending.filter(r =>
          r.message.toLowerCase().includes(searchText.toLowerCase())
        );

        if (matches.length === 0) {
          return { success: false, error: `No reminders found matching: "${searchText}"` };
        }

        if (matches.length > 1) {
          const formatted = matches.map(r => ({
            id: r.id,
            message: r.message,
            dueAt: formatDate(r.dueAt)
          }));
          return {
            success: false,
            error: 'Multiple reminders match that search. Please specify an id:',
            matches: formatted
          };
        }

        cancelledReminder = matches[0];
        const index = reminders.pending.findIndex(r => r.id === cancelledReminder.id);
        reminders.pending.splice(index, 1);
      }

      cancelledReminder.status = 'cancelled';
      await saveReminders(reminders);

      return {
        success: true,
        message: `Cancelled reminder: "${cancelledReminder.message}"`
      };
    }

    case 'snooze': {
      if (!id) {
        return { success: false, error: 'Reminder id is required for snooze action' };
      }

      const reminders = loadReminders();
      const reminder = reminders.pending.find(r => r.id === id);

      if (!reminder) {
        return { success: false, error: `No reminder found with id: ${id}` };
      }

      const snoozeDuration = duration || '15 minutes';
      const snoozeTime = parseNaturalTime(`in ${snoozeDuration}`);

      if (!snoozeTime) {
        return { success: false, error: `Could not parse snooze duration: "${snoozeDuration}"` };
      }

      reminder.dueAt = toSydneyISO(snoozeTime);
      await saveReminders(reminders);

      return {
        success: true,
        message: `Snoozed reminder until ${formatDate(reminder.dueAt)}`,
        reminder: {
          id: reminder.id,
          message: reminder.message,
          dueAt: formatDate(reminder.dueAt)
        }
      };
    }

    case 'history': {
      const reminders = loadReminders();

      if (reminders.sent.length === 0) {
        return { success: true, message: 'No sent reminders in history', reminders: [] };
      }

      // Sort by sentAt descending (most recent first)
      const sorted = [...reminders.sent].sort((a, b) => {
        return new Date(b.sentAt) - new Date(a.sentAt);
      });

      const formatted = sorted.map(r => ({
        message: r.message,
        sentAt: formatDate(r.sentAt),
        originallyDue: formatDate(r.dueAt)
      }));

      return {
        success: true,
        count: reminders.sent.length,
        reminders: formatted
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
