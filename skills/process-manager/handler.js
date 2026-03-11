// skills/process-manager/handler.js
// Manages staging bot process, self-restart signaling, promotion, and revert
// v1.13 — Fixed restart issue after live bot restarts (can now kill orphaned staging processes)
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { promote } from './promote.js';
import { revert } from './revert.js';

const execAsync = promisify(exec);

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
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n');
      const keepFrom = Math.floor(lines.length / 2);
      fs.writeFileSync(logFile, lines.slice(keepFrom).join('\n'));
    }
  } catch (err) {
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
    console.error(`[ProcessManager] Failed to write log: ${err.message}`);
  }
}

function addLog(source, data) {
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    const entry = `[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] [${source}] ${line}`;
    stagingLog.push(entry);
    appendToLogFile(STAGING_LOG_FILE, entry);
    if (source === 'stderr') {
      console.error(`[StagingBot] ${line}`);
    } else {
      console.log(`[StagingBot] ${line}`);
    }
  }
  if (stagingLog.length > STAGING_LOG_MAX) {
    stagingLog = stagingLog.slice(-STAGING_LOG_MAX);
  }
}

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

// Find any staging bot processes that might be running (even if we didn't spawn them)
async function findStagingPid() {
  try {
    if (process.platform === 'win32') {
      // Windows: use wmic to find node processes
      const { stdout } = await execAsync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv', { timeout: 5000 });
      const lines = stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.includes('staging') && line.includes('src\\index.js')) {
          const parts = line.split(',');
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid)) return pid;
        }
      }
    } else {
      // Unix: use ps to find node processes
      const { stdout } = await execAsync('ps aux | grep "node.*staging.*src/index.js" | grep -v grep', { timeout: 5000 });
      const match = stdout.trim().split(/\s+/);
      if (match.length > 1) {
        const pid = parseInt(match[1], 10);
        if (!isNaN(pid)) return pid;
      }
    }
  } catch (err) {
    // Command failed (probably no process found) — that's fine
  }
  return null;
}

async function killStagingProcess(pid) {
  try {
    if (process.platform === 'win32') {
      await execAsync(`taskkill /pid ${pid} /f /t`, { timeout: 5000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch (err) {
    console.error(`[ProcessManager] Failed to kill PID ${pid}: ${err.message}`);
    return false;
  }
}

function startStaging() {
  if (stagingProcess && !stagingProcess.killed) {
    return { success: false, error: 'Staging bot is already running. Stop it first or use restart.' };
  }

  if (!fs.existsSync(STAGING_DIR)) {
    return { success: false, error: 'Staging directory not found at: ' + STAGING_DIR };
  }

  const stagingEnvPath = path.join(STAGING_DIR, '.env');
  if (!fs.existsSync(stagingEnvPath)) {
    return { success: false, error: 'Staging .env not found. The test bot needs its own Discord token.' };
  }

  // Ensure staging has its own memory directory
  const stagingMemory = path.join(STAGING_DIR, 'memory');
  if (!fs.existsSync(stagingMemory)) {
    ensureDir(stagingMemory);
    // Create a starter long-term memory file if none exists
    const ltmFile = path.join(stagingMemory, 'long-term.md');
    if (!fs.existsSync(ltmFile)) {
      fs.writeFileSync(ltmFile, '# Test Bud — Long-Term Memory\n\n(New memory space — Test Bud\'s own memories start here)\n');
    }
  }

  stagingLog = [];
  ensureDir(STAGING_LOG_DIR);
  appendToLogFile(STAGING_LOG_FILE, `\n${'='.repeat(60)}\n[${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })}] === Staging bot starting ===\n${'='.repeat(60)}`);

  try {
    // Parse staging .env and override inherited env vars
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
      message: `Staging bot started (PID: ${stagingProcess.pid}). Test Bud has its own memory, soul, and identity.`,
      pid: stagingProcess.pid
    };
  } catch (err) {
    return { success: false, error: `Failed to start staging bot: ${err.message}` };
  }
}

async function stopStaging() {
  // First check if we have a tracked process
  if (stagingProcess && !stagingProcess.killed) {
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

  // If we don't have a tracked process, try to find it
  const pid = await findStagingPid();
  if (!pid) {
    return { success: false, error: 'Staging bot is not running (no process found).' };
  }

  // Found an orphaned staging process — kill it
  const killed = await killStagingProcess(pid);
  if (killed) {
    return { success: true, message: `Orphaned staging bot stopped (was PID: ${pid})` };
  } else {
    return { success: false, error: `Found staging process (PID: ${pid}) but failed to kill it.` };
  }
}

async function restartStaging() {
  const stopResult = await stopStaging();
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

async function getStatus() {
  const trackedRunning = stagingProcess && !stagingProcess.killed;
  const orphanedPid = trackedRunning ? null : await findStagingPid();
  
  return {
    running: trackedRunning || !!orphanedPid,
    pid: trackedRunning ? stagingProcess.pid : orphanedPid,
    tracked: trackedRunning,
    orphaned: !!orphanedPid,
    recentLog: stagingLog.slice(-20),
    logLines: stagingLog.length
  };
}

function readLogs(input) {
  const target = input.target || 'staging';
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
  description: 'Manage the staging/test bot process and signal self-restarts. Actions: start (launch staging bot), stop (kill staging bot), restart (stop+start staging bot), status (check if running + recent logs), read_logs (read persistent log files for staging or live bot), self_restart (signal watchdog to restart live bot), promote (deploy staging to live with backup and restart), revert (reset staging to match live — clean slate for new builds). Staging bot (Test Bud) has its own separate memory, soul, and identity.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'restart', 'status', 'read_logs', 'self_restart', 'promote', 'revert'],
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
      },
      version: {
        type: 'string',
        description: 'For promote: version label (e.g. "v1.10"). If omitted, auto-increments from last backup.'
      },
      dryRun: {
        type: 'boolean',
        description: 'For promote/revert: if true, show what would happen without making changes'
      },
      skipRestart: {
        type: 'boolean',
        description: 'For promote: if true, copy files but don\'t signal restart'
      }
    },
    required: ['action']
  }
};

// Main execute function
export async function execute(input) {
  if (IS_STAGING) {
    const stagingBlocked = ['start', 'stop', 'restart', 'status', 'promote', 'revert'];
    if (stagingBlocked.includes(input.action)) {
      return {
        success: false,
        error: "I'm the staging instance (Test Bud) — process management, promotion, and revert are handled by the live bot."
      };
    }
  }

  switch (input.action) {
    case 'start':
      return startStaging();
    case 'stop':
      return await stopStaging();
    case 'restart':
      return await restartStaging();
    case 'status':
      return await getStatus();
    case 'read_logs':
      return readLogs(input);
    case 'self_restart':
      return signalSelfRestart(input.reason || 'Manual restart');
    case 'promote': {
      // Stop staging bot first if it's running
      const statusResult = await getStatus();
      if (statusResult.running) {
        const stopResult = await stopStaging();
        if (!stopResult.success) {
          return { success: false, error: `Failed to stop staging bot before promotion: ${stopResult.error}` };
        }
        // Give it a moment to clean up
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return promote(input);
    }
    case 'revert': {
      // Stop staging bot first if it's running
      const statusResult = await getStatus();
      if (statusResult.running) {
        const stopResult = await stopStaging();
        if (!stopResult.success) {
          return { success: false, error: `Failed to stop staging bot before revert: ${stopResult.error}` };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return revert(input);
    }
    default:
      return { success: false, error: `Unknown action: ${input.action}` };
  }
}
