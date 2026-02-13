// watchdog.js
// Sits outside the bot process. Launches it, watches for restart signals, handles rollback.
// Usage: node watchdog.js
// Place in project root and run INSTEAD of `npm start`
// v1.4 — Added persistent log file output (logs/live.log)

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = __dirname;
const SIGNAL_FILE = path.join(PROJECT_ROOT, '.restart-signal');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'staging', 'backups');
const POLL_INTERVAL = 3000; // Check for restart signal every 3 seconds
const CRASH_WINDOW = 30000; // If bot crashes within 30s of start, consider it a bad deploy
const MAX_CRASH_RETRIES = 2; // How many times to retry before rolling back

// Log file config
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'live.log');
const MAX_LOG_SIZE = 512 * 1024; // 512KB — rotate when exceeded

let botProcess = null;
let lastStartTime = null;
let crashCount = 0;
let isRestarting = false;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = content.split('\n');
      const keepFrom = Math.floor(lines.length / 2);
      fs.writeFileSync(LOG_FILE, lines.slice(keepFrom).join('\n'));
      log('Log file rotated (exceeded 512KB)');
    }
  } catch (err) {
    // Non-critical
  }
}

function appendToLog(line) {
  try {
    ensureDir(LOG_DIR);
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // File logging failure shouldn't crash the watchdog
  }
}

function log(msg) {
  const time = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' });
  const line = `[Watchdog ${time}] ${msg}`;
  console.log(line);
  appendToLog(line);
}

function startBot() {
  if (botProcess && !botProcess.killed) {
    log('Bot is already running');
    return;
  }

  log('Starting MiniClaw...');
  lastStartTime = Date.now();

  // Ensure log directory exists
  ensureDir(LOG_DIR);

  // Add session separator to log file
  appendToLog(`\n${'='.repeat(60)}\n[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] === Live bot starting ===\n${'='.repeat(60)}`);

  botProcess = spawn('node', ['src/index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr instead of inherit
    env: process.env
  });

  // Pipe bot output to both console AND log file
  botProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text); // Still show in terminal
    // Write each line to log file with timestamp
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        const time = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' });
        appendToLog(`[${time}] [stdout] ${line}`);
      }
    }
  });

  botProcess.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text); // Still show in terminal
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        const time = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' });
        appendToLog(`[${time}] [stderr] ${line}`);
      }
    }
  });

  botProcess.on('error', (err) => {
    log(`Process error: ${err.message}`);
    botProcess = null;
    handleCrash();
  });

  botProcess.on('exit', (code, signal) => {
    log(`Bot exited (code: ${code}, signal: ${signal})`);
    botProcess = null;

    // If we're doing a controlled restart, don't treat as crash
    if (isRestarting) {
      isRestarting = false;
      return;
    }

    // If it died unexpectedly, handle crash logic
    if (code !== 0) {
      handleCrash();
    }
  });

  log(`Bot started (PID: ${botProcess.pid})`);
}

function stopBot() {
  return new Promise((resolve) => {
    if (!botProcess || botProcess.killed) {
      resolve();
      return;
    }

    isRestarting = true;
    const pid = botProcess.pid;
    log(`Stopping bot (PID: ${pid})...`);

    botProcess.on('exit', () => {
      resolve();
    });

    // Windows needs taskkill for process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pid.toString(), '/f', '/t'], { stdio: 'ignore' });
    } else {
      botProcess.kill('SIGTERM');
    }

    // Force kill after 5 seconds
    setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        log('Force killing bot...');
        botProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);
  });
}

function handleCrash() {
  const timeSinceStart = Date.now() - (lastStartTime || 0);

  if (timeSinceStart < CRASH_WINDOW) {
    crashCount++;
    log(`Bot crashed quickly (${Math.round(timeSinceStart / 1000)}s). Crash count: ${crashCount}/${MAX_CRASH_RETRIES}`);

    if (crashCount >= MAX_CRASH_RETRIES) {
      log('Too many quick crashes. Attempting rollback...');
      attemptRollback();
      return;
    }
  } else {
    // Crash after running for a while — reset counter and just restart
    crashCount = 0;
  }

  log('Restarting in 3 seconds...');
  setTimeout(() => startBot(), 3000);
}

function attemptRollback() {
  // Find the most recent backup
  if (!fs.existsSync(BACKUP_DIR)) {
    log('No backup directory found. Cannot rollback. Stopping.');
    process.exit(1);
  }

  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
    .sort()
    .reverse();

  if (backups.length === 0) {
    log('No backups found. Cannot rollback. Stopping.');
    process.exit(1);
  }

  const latestBackup = backups[0];
  log(`Rolling back to backup: ${latestBackup}`);

  const backupPath = path.join(BACKUP_DIR, latestBackup);

  // Restore src/ from backup
  const backupSrc = path.join(backupPath, 'src');
  const liveSrc = path.join(PROJECT_ROOT, 'src');

  if (fs.existsSync(backupSrc)) {
    fs.rmSync(liveSrc, { recursive: true, force: true });
    fs.cpSync(backupSrc, liveSrc, { recursive: true });
    log(`Restored src/ from ${latestBackup}`);
  }

  // Restore skills/ from backup if present
  const backupSkills = path.join(backupPath, 'skills');
  const liveSkills = path.join(PROJECT_ROOT, 'skills');

  if (fs.existsSync(backupSkills)) {
    fs.rmSync(liveSkills, { recursive: true, force: true });
    fs.cpSync(backupSkills, liveSkills, { recursive: true });
    log(`Restored skills/ from ${latestBackup}`);
  }

  // Reset crash count and try again
  crashCount = 0;
  log('Rollback complete. Restarting with restored version...');
  setTimeout(() => startBot(), 2000);
}

// Poll for restart signal file
function watchForRestartSignal() {
  setInterval(async () => {
    if (!fs.existsSync(SIGNAL_FILE)) return;

    try {
      const signal = JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf-8'));
      log(`Restart signal received: ${signal.reason}`);

      // Remove signal file immediately
      fs.unlinkSync(SIGNAL_FILE);

      // Stop current bot
      await stopBot();

      // Reset crash count (this is an intentional restart)
      crashCount = 0;

      // Wait a moment then start
      log('Restarting in 2 seconds...');
      setTimeout(() => startBot(), 2000);

    } catch (err) {
      log(`Error processing restart signal: ${err.message}`);
      // Clean up bad signal file
      try { fs.unlinkSync(SIGNAL_FILE); } catch (e) {}
    }
  }, POLL_INTERVAL);
}

// Clean up on exit
process.on('SIGINT', async () => {
  log('Watchdog shutting down...');
  await stopBot();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('Watchdog shutting down...');
  await stopBot();
  process.exit(0);
});

// --- MAIN ---
log('=== MiniClaw Watchdog Starting ===');
log(`Project root: ${PROJECT_ROOT}`);
log(`Signal file: ${SIGNAL_FILE}`);
log(`Log file: ${LOG_FILE}`);
log(`Polling every ${POLL_INTERVAL / 1000}s for restart signals`);

// Clean up any stale signal file
if (fs.existsSync(SIGNAL_FILE)) {
  log('Cleaning up stale restart signal...');
  fs.unlinkSync(SIGNAL_FILE);
}

startBot();
watchForRestartSignal();

log('=== Watchdog Active ===');
