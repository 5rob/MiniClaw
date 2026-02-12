// src/memory.js
// OpenClaw-style Markdown memory: MEMORY.md (curated) + daily logs (transient)
import fs from 'fs';
import path from 'path';

const MEMORY_DIR = path.resolve('memory');
const DAILY_DIR = path.join(MEMORY_DIR, 'daily');
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');

// Ensure directories exist
fs.mkdirSync(DAILY_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, '# Long-Term Memory\n\nThis file contains curated facts, preferences, and decisions.\n\n');
}

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function dailyLogPath(dateStr) {
  return path.join(DAILY_DIR, `${dateStr}.md`);
}

// Read the curated MEMORY.md
export function readLongTermMemory() {
  try {
    return fs.readFileSync(MEMORY_FILE, 'utf-8');
  } catch (err) {
    console.error('[Memory] Error reading MEMORY.md:', err.message);
    return '# Long-Term Memory\n\n(Error reading memory file)\n';
  }
}

// Write/overwrite the curated MEMORY.md
export function writeLongTermMemory(content) {
  try {
    fs.writeFileSync(MEMORY_FILE, content);
    console.log('[Memory] Updated MEMORY.md');
  } catch (err) {
    console.error('[Memory] Error writing MEMORY.md:', err.message);
    throw err;
  }
}

// Append to today's daily log
export function appendDailyLog(entry) {
  try {
    const logPath = dailyLogPath(todayString());
    const timestamp = new Date().toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Australia/Sydney'
    });
    const line = `\n**${timestamp}** — ${entry}\n`;

    // Create header if this is a new daily log
    if (!fs.existsSync(logPath)) {
      const dateHeader = `# Daily Log — ${todayString()}\n\n`;
      fs.writeFileSync(logPath, dateHeader);
    }

    fs.appendFileSync(logPath, line);
  } catch (err) {
    console.error('[Memory] Error appending to daily log:', err.message);
    throw err;
  }
}

// Load recent daily logs (today + yesterday by default)
export function loadRecentDailyLogs(daysBack = 2) {
  const logs = [];

  try {
    for (let i = 0; i < daysBack; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const logPath = dailyLogPath(dateStr);

      if (fs.existsSync(logPath)) {
        logs.push({
          date: dateStr,
          content: fs.readFileSync(logPath, 'utf-8')
        });
      }
    }
  } catch (err) {
    console.error('[Memory] Error loading recent logs:', err.message);
  }

  return logs;
}

// Simple keyword search across all memory files (fallback when hybrid search unavailable)
export function searchMemory(query) {
  const results = [];
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 1);

  try {
    // Search MEMORY.md
    const longTerm = readLongTermMemory();
    if (keywords.some(kw => longTerm.toLowerCase().includes(kw))) {
      results.push({ source: 'MEMORY.md', content: longTerm });
    }

    // Search daily logs (last 30 days)
    if (fs.existsSync(DAILY_DIR)) {
      const dailyFiles = fs.readdirSync(DAILY_DIR)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of dailyFiles.slice(0, 30)) {
        const content = fs.readFileSync(path.join(DAILY_DIR, file), 'utf-8');
        if (keywords.some(kw => content.toLowerCase().includes(kw))) {
          results.push({ source: `daily/${file}`, content });
        }
      }
    }
  } catch (err) {
    console.error('[Memory] Error searching memory:', err.message);
  }

  return results;
}
