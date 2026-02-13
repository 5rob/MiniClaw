// skills/process-manager/handler.js
// Manages staging bot process and self-restart signaling
// v1.4 — Added persistent log files + read_logs action
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');
const RESTART_SIGNAL = path.join(PROJECT_ROOT, '.restart-signal');
const STAGING_LOG_MAX = 200; // Keep last N lines in memory
const IS_STAGING = process.env.BOT_ROLE === 'staging';

// Log file paths
const STAGING_LOG_DIR = path.join(STAGING_DIR, 'logs');
const STAGING_LOG_FILE = path.join(STAGING_LOG_DIR, 'staging.log');
const LIVE_LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const LIVE_LOG_FILE = path.join(LIVE_LOG_DIR, 'live.log');
const MAX_LOG_SIZE = 512 * 1024; // 512KB — rotate when exceeded

let stagingProcess = null;
let stagingLog = [];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function rotateLogIfNeeded(logFile) {
  try {
    if (!fs.existsSync(logFile)) return;
    const stats = fs.statSync(logFile);
    if (stats.size > MAX_LOG_SIZE) {
      // Keep the last half of the file
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n');
      const keepFrom = Math.floor(lines.length / 2);
      fs.writeFileSync(logFile, lines.slice(keepFrom).join('\n'));
    }
  } catch (err) {
    // Rotation failure is non-critical
    console.error(`[ProcessManager] Log rotation error: ${err.message}`);
  }
}

function appendToLogFile(logFile, line) {
  try {
    const logDir = path.dirname(logFile);
    ensureDir(logDir);
    rotateLogIfNeeded(logFile);
    fs.appendFileSync(logFile, line + '\n');
  } catch (err) {
    // File logging failure shouldn't break anything
    console.error(`[ProcessManager] Failed to write log: ${err.message}`);
  }
}

function addLog(source, data) {
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    const entry = `[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] [${source}] ${line}`;
    stagingLog.push(entry);
    // Write to persistent log file
    appendToLogFile(STAGING_LOG_FILE, entry);
    // Also echo to live bot's console for visibility
    if (source === 'stderr') {
      console.error(`[StagingBot] ${line}`);
    } else {
      console.log(`[StagingBot] ${line}`);
    }
  }
  // Trim in-memory log
  if (stagingLog.length > STAGING_LOG_MAX) {
    stagingLog = stagingLog.slice(-STAGING_LOG_MAX);
  }
}

// Parse a .env file and return key-value pairs
function parseDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

function startStaging() {
  if (stagingProcess && !stagingProcess.killed) {
    return { success: false, error: 'Staging bot is already running. Stop it first or use restart.' };
  }

  // Check staging directory exists
  if (!fs.existsSync(STAGING_DIR)) {
    return { success: false, error: 'Staging directory not found at: ' + STAGING_DIR };
  }

  // Check staging has its own .env
  const stagingEnvPath = path.join(STAGING_DIR, '.env');
  if (!fs.existsSync(stagingEnvPath)) {
    return { success: false, error: 'Staging .env not found. The test bot needs its own Discord token.' };
  }

  stagingLog = [];

  // Ensure log directory exists
  ensureDir(STAGING_LOG_DIR);

  // Add a session separator to the log file
  appendToLogFile(STAGING_LOG_FILE, `\n${'='.repeat(60)}\n[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] === Staging bot starting ===\n${'='.repeat(60)}`);

  try {
    const stagingEnvOverrides = parseDotEnv(stagingEnvPath);
    const stagingEnv = { ...process.env, FORCE_COLOR: '0', ...stagingEnvOverrides };

    stagingProcess = spawn('node', ['src/index.js'], {
      cwd: STAGING_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: stagingEnv,
      detached: false
    });

    stagingProcess.stdout.on('data', (data) => addLog('stdout', data));
    stagingProcess.stderr.on('data', (data) => addLog('stderr', data));

    stagingProcess.on('error', (err) => {
      addLog('error', `Process error: ${err.message}`);
      stagingProcess = null;
    });

    stagingProcess.on('exit', (code, signal) => {
      addLog('system', `Process exited with code ${code}, signal ${signal}`);
      stagingProcess = null;
    });

    return {
      success: true,
      message: `Staging bot started (PID: ${stagingProcess.pid})`,
      pid: stagingProcess.pid
    };
  } catch (err) {
    return { success: false, error: `Failed to start staging bot: ${err.message}` };
  }
}

function stopStaging() {
  if (!stagingProcess || stagingProcess.killed) {
    return { success: false, error: 'Staging bot is not running.' };
  }

  const pid = stagingProcess.pid;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pid.toString(), '/f', '/t'], { stdio: 'ignore' });
    } else {
      stagingProcess.kill('SIGTERM');
    }
    stagingProcess = null;
    return { success: true, message: `Staging bot stopped (was PID: ${pid})` };
  } catch (err) {
    return { success: false, error: `Failed to stop staging bot: ${err.message}` };
  }
}

function restartStaging() {
  const stopResult = stopStaging();
  return new Promise((resolve) => {
    setTimeout(() => {
      const startResult = startStaging();
      resolve({
        success: startResult.success,
        stopped: stopResult.success || stopResult.error,
        started: startResult.success ? startResult.message : startResult.error,
        pid: startResult.pid || null
      });
    }, 2000);
  });
}

function getStatus() {
  const running = stagingProcess && !stagingProcess.killed;
  return {
    running,
    pid: running ? stagingProcess.pid : null,
    recentLog: stagingLog.slice(-20),
    logLines: stagingLog.length
  };
}

function readLogs(input) {
  const target = input.target || 'staging'; // 'staging' or 'live'
  const lines = input.lines || 50;

  const logFile = target === 'live' ? LIVE_LOG_FILE : STAGING_LOG_FILE;

  if (!fs.existsSync(logFile)) {
    return {
      success: false,
      error: `No log file found at ${logFile}. The ${target} bot may not have run yet.`
    };
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    const tail = allLines.slice(-lines);

    return {
      success: true,
      target,
      logFile,
      totalLines: allLines.length,
      returnedLines: tail.length,
      logs: tail.join('\n')
    };
  } catch (err) {
    return { success: false, error: `Failed to read logs: ${err.message}` };
  }
}

function signalSelfRestart(reason = 'Manual restart requested') {
  const signal = {
    timestamp: new Date().toISOString(),
    reason,
    requestedBy: 'process-manager'
  };

  try {
    fs.writeFileSync(RESTART_SIGNAL, JSON.stringify(signal, null, 2));
    return {
      success: true,
      message: 'Restart signal written. The watchdog will pick it up and restart the live bot.',
      signalFile: RESTART_SIGNAL
    };
  } catch (err) {
    return { success: false, error: `Failed to write restart signal: ${err.message}` };
  }
}

// Tool definition for Anthropic tool_use
export const toolDefinition = {
  name: 'process_manager',
  description: 'Manage the staging/test bot process and signal self-restarts. Actions: start (launch staging bot), stop (kill staging bot), restart (stop+start staging bot), status (check if running + recent logs), read_logs (read persistent log files for staging or live bot), self_restart (signal watchdog to restart live bot).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'restart', 'status', 'read_logs', 'self_restart'],
        description: 'What to do with the process'
      },
      reason: {
        type: 'string',
        description: 'Reason for self_restart (optional, for logging)'
      },
      target: {
        type: 'string',
        enum: ['staging', 'live'],
        description: 'For read_logs: which log to read (default: staging)'
      },
      lines: {
        type: 'number',
        description: 'For read_logs: how many lines from the tail to return (default: 50)'
      }
    },
    required: ['action']
  }
};

// Main execute function
export async function execute(input) {
  if (IS_STAGING) {
    const stagingBlocked = ['start', 'stop', 'restart', 'status'];
    if (stagingBlocked.includes(input.action)) {
      return {
        success: false,
        error: "I'm the staging instance — process management is handled by the live bot. Ask in the main channel if you need to restart me."
      };
    }
  }

  switch (input.action) {
    case 'start':
      return startStaging();
    case 'stop':
      return stopStaging();
    case 'restart':
      return await restartStaging();
    case 'status':
      return getStatus();
    case 'read_logs':
      return readLogs(input);
    case 'self_restart':
      return signalSelfRestart(input.reason || 'Manual restart');
    default:
      return { success: false, error: `Unknown action: ${input.action}` };
  }
}
