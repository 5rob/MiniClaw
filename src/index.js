// src/index.js
// Entry point — wires everything together
// v1.13 — Start periodic re-indexing on boot
import 'dotenv/config';
import { initCalendar } from './calendar.js';
import { startDiscord } from './discord.js';
import { initMemoryIndex, indexMemoryFiles, startPeriodicReindex } from './memory-index.js';

console.log('\n=== MiniClaw Starting ===');
console.log(`Time: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);

// Validate critical environment variables
const requiredEnvVars = ['ANTHROPIC_API_KEY', 'DISCORD_TOKEN', 'DISCORD_OWNER_ID'];
const missing = requiredEnvVars.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.error('\n❌ ERROR: Missing required environment variables:');
  missing.forEach(v => console.error(`   - ${v}`));
  console.error('\nPlease add these to your .env file (see .env.example)\n');
  process.exit(1);
}

// Initialize Google Calendar (optional, warns if not configured)
try {
  initCalendar();
} catch (err) {
  console.error('[Calendar] Initialization failed:', err.message);
}

// Initialize memory search index (SQLite + FTS5 + optional vectors)
try {
  initMemoryIndex();
  console.log('[MemoryIndex] Initialized');

  // Index memory files asynchronously (don't block startup)
  // v1.13: Start periodic re-indexing after initial pass
  indexMemoryFiles()
    .then(() => {
      console.log('[MemoryIndex] Initial indexing complete');
      startPeriodicReindex(300_000); // 5 minutes, matches OpenClaw QMD default
    })
    .catch(err => {
      console.warn('[MemoryIndex] Initial indexing failed (non-fatal):', err.message);
      console.warn('[MemoryIndex] Hybrid search will fall back to keyword-only');
      startPeriodicReindex(300_000); // Still start periodic even if initial fails
    });
} catch (err) {
  console.error('[MemoryIndex] Initialization failed (non-fatal):', err.message);
  console.warn('[MemoryIndex] Memory search will use simple keyword fallback');
}

// Start Discord bot
console.log('[Discord] Connecting...');
startDiscord();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n=== MiniClaw Shutting Down ===');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n=== MiniClaw Shutting Down ===');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('\n[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n[FATAL] Unhandled promise rejection:', reason);
  process.exit(1);
});

console.log('=== MiniClaw Ready ===\n');