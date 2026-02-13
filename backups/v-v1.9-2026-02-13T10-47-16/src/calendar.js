// src/calendar.js
// Google Calendar integration with OAuth2, auto-refresh, and token persistence
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

let calendarClient = null;
let oauth2Client = null;

export function initCalendar() {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.warn('[Calendar] No Google OAuth2 credentials in .env. Calendar features disabled.');
      return;
    }

    oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const tokensPath = path.resolve('google-tokens.json');

    // Load saved tokens
    if (fs.existsSync(tokensPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      oauth2Client.setCredentials(tokens);

      // Auto-save refreshed tokens
      oauth2Client.on('tokens', (newTokens) => {
        try {
          const existing = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
          const merged = { ...existing, ...newTokens };
          fs.writeFileSync(tokensPath, JSON.stringify(merged, null, 2));
          console.log('[Calendar] Tokens refreshed and saved');
        } catch (err) {
          console.error('[Calendar] Error saving refreshed tokens:', err.message);
        }
      });

      calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
      console.log('[Calendar] Initialized with saved tokens');
    } else {
      console.warn('[Calendar] No google-tokens.json found. Run "npm run auth" first to authorize.');
    }
  } catch (err) {
    console.error('[Calendar] Initialization error:', err.message);
  }
}

export async function listEvents({ maxResults = 10, daysAhead = 7 } = {}) {
  if (!calendarClient) {
    throw new Error('Calendar not initialized. Run "npm run auth" to set up Google Calendar access.');
  }

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString();

    const res = await calendarClient.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return res.data.items.map(e => ({
      id: e.id,
      summary: e.summary,
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      location: e.location || null,
      description: e.description || null
    }));
  } catch (err) {
    console.error('[Calendar] Error listing events:', err.message);
    throw new Error(`Failed to list calendar events: ${err.message}`);
  }
}

export async function createEvent({ summary, startTime, endTime, description, location }) {
  if (!calendarClient) {
    throw new Error('Calendar not initialized. Run "npm run auth" to set up Google Calendar access.');
  }

  try {
    const event = {
      summary,
      location,
      description,
      start: { dateTime: startTime, timeZone: 'Australia/Sydney' },
      end: { dateTime: endTime, timeZone: 'Australia/Sydney' }
    };

    const res = await calendarClient.events.insert({
      calendarId: 'primary',
      requestBody: event
    });

    return {
      id: res.data.id,
      summary: res.data.summary,
      link: res.data.htmlLink
    };
  } catch (err) {
    console.error('[Calendar] Error creating event:', err.message);
    throw new Error(`Failed to create calendar event: ${err.message}`);
  }
}

export async function deleteEvent(eventId) {
  if (!calendarClient) {
    throw new Error('Calendar not initialized. Run "npm run auth" to set up Google Calendar access.');
  }

  try {
    await calendarClient.events.delete({
      calendarId: 'primary',
      eventId
    });

    return { deleted: true, eventId };
  } catch (err) {
    console.error('[Calendar] Error deleting event:', err.message);
    throw new Error(`Failed to delete calendar event: ${err.message}`);
  }
}

export async function updateEvent(eventId, updates) {
  if (!calendarClient) {
    throw new Error('Calendar not initialized. Run "npm run auth" to set up Google Calendar access.');
  }

  try {
    const res = await calendarClient.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: updates
    });

    return {
      id: res.data.id,
      summary: res.data.summary,
      link: res.data.htmlLink
    };
  } catch (err) {
    console.error('[Calendar] Error updating event:', err.message);
    throw new Error(`Failed to update calendar event: ${err.message}`);
  }
}
