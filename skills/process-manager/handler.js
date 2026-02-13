// skills/process-manager/handler.js
// Manages staging bot process and self-restart signaling
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');
const RESTART_SIGNAL = path.join(PROJECT_ROOT, '.restart-signal');
const STAGING_LOG_MAX = 50; // Keep last N lines of staging output
const IS_STAGING = process.env.BOT_ROLE === 'staging';

let stagingProcess = null;
let stagingLog = [];

function addLog(source, data) {
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    const entry = `[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] [${source}] ${line}`;
    stagingLog.push(entry);
    // Also echo to live bot's console for visibility
    if (source === 'stderr') {
      console.error(`[StagingBot] ${line}`);
    } else {
      console.log(`[StagingBot] ${line}`);
    }
  }
  // Trim log
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

  try {
    // Build a clean environment for the staging bot.
    // We must read the staging .env and let those values OVERRIDE the inherited
    // parent env, because dotenv won't overwrite env vars that already exist.
    // Without this, the staging bot inherits the live bot's DISCORD_TOKEN
    // and logs in as the wrong bot.
    const stagingEnvOverrides = parseDotEnv(stagingEnvPath);
    const stagingEnv = { ...process.env, FORCE_COLOR: '0', ...stagingEnvOverrides };

    stagingProcess = spawn('node', ['src/index.js'], {
      cwd: STAGING_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: stagingEnv,
      // Don't detach — we want to manage lifecycle directly
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
    // On Windows, we need to kill the process tree
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
  // Small delay to let the process fully die
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

function signalSelfRestart(reason = 'Manual restart requested') {
  // Write a signal file that the watchdog will pick up
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
  description: 'Manage the staging/test bot process and signal self-restarts. Actions: start (launch staging bot), stop (kill staging bot), restart (stop+start staging bot), status (check if running + recent logs), self_restart (signal watchdog to restart live bot).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'restart', 'status', 'self_restart'],
        description: 'What to do with the process'
      },
      reason: {
        type: 'string',
        description: 'Reason for self_restart (optional, for logging)'
      }
    },
    required: ['action']
  }
};

// Main execute function
export async function execute(input) {
  // Staging bot should NOT be able to manage staging processes — that's the live bot's job.
  // Without this guard, the staging bot tries to spawn into staging/staging/ which doesn't exist.
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
    case 'self_restart':
      return signalSelfRestart(input.reason || 'Manual restart');
    default:
      return { success: false, error: `Unknown action: ${input.action}` };
  }
}