import { spawn } from 'child_process';
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
const HISTORY_FILE = path.resolve(DATA_DIR, 'execution-history.json');

const DEFAULT_TIMEOUT = 60_000;       // 60 seconds
const MAX_TIMEOUT = 300_000;          // 300 seconds
const OUTPUT_SIZE_LIMIT = 1_048_576;  // 1 MB

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ─── Python executable detection ─────────────────────────────────────────────

let cachedPython = null;

async function detectPython() {
  if (cachedPython) return cachedPython;
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(cmd, ['--version'], { timeout: 5000, stdio: 'pipe' });
        p.on('close', code => code === 0 ? resolve() : reject());
        p.on('error', reject);
      });
      cachedPython = cmd;
      return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

// ─── History helpers ──────────────────────────────────────────────────────────

function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function appendHistory(entry) {
  try {
    const history = loadHistory();
    history.push(entry);
    // Keep last 500 entries
    if (history.length > 500) history.splice(0, history.length - 500);
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    // Non-fatal — don't fail execution over history write
  }
}

// ─── Core execution ───────────────────────────────────────────────────────────

async function runScript({ scriptPath, args = [], cwd, env = {}, timeoutMs }) {
  const python = await detectPython();
  if (!python) {
    return { success: false, error: 'Python executable not found. Install Python and ensure it is on PATH.' };
  }

  const resolved = path.resolve(scriptPath);
  if (!existsSync(resolved)) {
    return { success: false, error: `Script not found: ${resolved}` };
  }
  if (!statSync(resolved).isFile()) {
    return { success: false, error: `Path is not a file: ${resolved}` };
  }

  const workingDir = cwd
    ? path.resolve(cwd)
    : path.dirname(resolved);

  if (!existsSync(workingDir)) {
    return { success: false, error: `Working directory not found: ${workingDir}` };
  }

  const mergedEnv = { ...process.env, ...env };
  const startTime = Date.now();

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const child = spawn(python, [resolved, ...args.map(String)], {
      cwd: workingDir,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onData = (stream, chunk) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        stdout += text;
        if (stdout.length > OUTPUT_SIZE_LIMIT) {
          stdout = stdout.slice(0, OUTPUT_SIZE_LIMIT);
          truncated = true;
        }
      } else {
        stderr += text;
        if (stderr.length > OUTPUT_SIZE_LIMIT) {
          stderr = stderr.slice(0, OUTPUT_SIZE_LIMIT);
          truncated = true;
        }
      }
    };

    child.stdout.on('data', chunk => onData('stdout', chunk));
    child.stderr.on('data', chunk => onData('stderr', chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000);
    }, timeoutMs);

    child.on('close', exitCode => {
      clearTimeout(timer);
      const executionTime = Date.now() - startTime;

      const result = {
        success: true,
        scriptPath: resolved,
        python,
        exitCode: exitCode ?? -1,
        timedOut,
        executionTime,
        stdout,
        stderr,
        truncated,
      };

      appendHistory({
        timestamp: new Date().toISOString(),
        scriptPath: resolved,
        args,
        cwd: workingDir,
        exitCode: result.exitCode,
        timedOut,
        executionTime,
        success: !timedOut && exitCode === 0,
      });

      resolve(result);
    });

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ success: false, error: `Failed to spawn process: ${err.message}` });
    });
  });
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const toolDefinition = {
  name: 'python_executor',
  description: 'Execute a Python script on the host machine and capture its output (stdout, stderr, exit code, execution time). Use this to test scripts before presenting them, debug syntax errors, verify optimizations, or run diagnostic utilities.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['run', 'history', 'clear_history', 'detect_python'],
        description: 'Operation to perform. "run": execute a script. "history": view past executions. "clear_history": wipe execution log. "detect_python": check which Python executable is available.',
      },
      script_path: {
        type: 'string',
        description: 'Absolute or relative path to the Python script to execute. Required for action="run".',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional command-line arguments to pass to the script.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the script. Defaults to the script\'s own directory.',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional environment variables to merge with the current environment.',
      },
      timeout_seconds: {
        type: 'number',
        description: `Timeout in seconds (default: ${DEFAULT_TIMEOUT / 1000}, max: ${MAX_TIMEOUT / 1000}).`,
      },
      history_limit: {
        type: 'number',
        description: 'Number of history entries to return for action="history" (default: 20).',
      },
    },
    required: ['action'],
  },
};

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function execute(input) {
  const { action } = input;

  switch (action) {
    case 'run': {
      const { script_path, args = [], cwd, env = {}, timeout_seconds } = input;
      if (!script_path) return { success: false, error: 'script_path is required for action="run"' };

      let timeoutMs = DEFAULT_TIMEOUT;
      if (timeout_seconds !== undefined) {
        const requested = Math.round(timeout_seconds * 1000);
        timeoutMs = Math.min(Math.max(requested, 1000), MAX_TIMEOUT);
      }

      return runScript({ scriptPath: script_path, args, cwd, env, timeoutMs });
    }

    case 'history': {
      const limit = input.history_limit ?? 20;
      const history = loadHistory();
      const slice = history.slice(-Math.min(limit, 500)).reverse();
      return { success: true, count: slice.length, total: history.length, entries: slice };
    }

    case 'clear_history': {
      try {
        writeFileSync(HISTORY_FILE, '[]', 'utf8');
        return { success: true, message: 'Execution history cleared.' };
      } catch (e) {
        return { success: false, error: `Failed to clear history: ${e.message}` };
      }
    }

    case 'detect_python': {
      cachedPython = null; // force re-detection
      const python = await detectPython();
      if (!python) return { success: false, error: 'No Python executable found on PATH.' };
      return { success: true, executable: python };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
