// PROMOTE FUNCTION — Add this to handler.js
// Insert after the signalSelfRestart function and before the toolDefinition export

// Protected paths that should NEVER be overwritten during promotion
const PROTECTED_PATHS = [
  '.env',           // Different tokens for live vs staging
  'memory',         // Symlinked, shared already
  'SOUL.md',        // Symlinked, shared already
  'IDENTITY.md',    // Symlinked, shared already
  'logs',           // Each instance has its own logs
  'node_modules',   // Dependencies managed separately
  'package-lock.json',
  'staging',        // Don't copy staging into itself
  'watchdog.js',    // Watchdog lives outside the bot
  '.restart-signal' // Runtime signal file
];

// Directories to promote from staging to live
const PROMOTABLE_DIRS = ['src', 'skills'];

// Files in root to promote (config, package.json, etc.)
const PROMOTABLE_ROOT_FILES = ['config.json', 'package.json'];

function promoteToLive(input) {
  if (IS_STAGING) {
    return {
      success: false,
      error: "I'm the staging instance — promotion must be triggered from the live bot."
    };
  }

  const version = input.version || `v${Date.now()}`;
  const reason = input.reason || `Promoting staging to live as ${version}`;
  const results = { version, steps: [] };

  // Step 1: Create backup of current live
  const backupPath = path.join(BACKUP_DIR, version);
  try {
    ensureDir(backupPath);
    for (const dir of PROMOTABLE_DIRS) {
      const liveDir = path.join(PROJECT_ROOT, dir);
      const backupDir = path.join(backupPath, dir);
      if (fs.existsSync(liveDir)) {
        fs.cpSync(liveDir, backupDir, { recursive: true });
      }
    }
    for (const file of PROMOTABLE_ROOT_FILES) {
      const liveFile = path.join(PROJECT_ROOT, file);
      const backupFile = path.join(backupPath, file);
      if (fs.existsSync(liveFile)) {
        fs.copyFileSync(liveFile, backupFile);
      }
    }
    results.steps.push({ step: 'backup', success: true, path: backupPath });
  } catch (err) {
    return {
      success: false,
      error: `Backup failed: ${err.message}. Promotion aborted — live is untouched.`,
      steps: results.steps
    };
  }

  // Step 2: Stop staging bot if it's running (avoid file locks)
  if (stagingProcess && !stagingProcess.killed) {
    const stopResult = stopStaging();
    results.steps.push({ step: 'stop_staging', ...stopResult });
  }

  // Step 3: Copy staging files to live
  try {
    for (const dir of PROMOTABLE_DIRS) {
      const stagingDir = path.join(STAGING_DIR, dir);
      const liveDir = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(stagingDir)) {
        // Remove current live version of this dir
        if (fs.existsSync(liveDir)) {
          fs.rmSync(liveDir, { recursive: true, force: true });
        }
        // Copy staging version in
        fs.cpSync(stagingDir, liveDir, { recursive: true });
      }
    }
    for (const file of PROMOTABLE_ROOT_FILES) {
      const stagingFile = path.join(STAGING_DIR, file);
      const liveFile = path.join(PROJECT_ROOT, file);
      if (fs.existsSync(stagingFile)) {
        fs.copyFileSync(stagingFile, liveFile);
      }
    }
    results.steps.push({ step: 'copy_to_live', success: true });
  } catch (err) {
    results.steps.push({ step: 'copy_to_live', success: false, error: err.message });
    return {
      success: false,
      error: `Copy failed: ${err.message}. Live may be in inconsistent state! Backup at: ${backupPath}`,
      steps: results.steps
    };
  }

  // Step 4: Signal self-restart
  const restartResult = signalSelfRestart(reason);
  results.steps.push({ step: 'signal_restart', ...restartResult });

  return {
    success: true,
    message: `Promotion complete! ${version} backed up, staging copied to live, restart signal sent. The watchdog will restart me momentarily.`,
    ...results
  };
}

// ALSO UPDATE the BACKUP_DIR constant at the top of the file:
// const BACKUP_DIR = path.join(PROJECT_ROOT, 'staging', 'backups');

// ALSO ADD 'promote' to the tool definition:
// In the action enum: ['start', 'stop', 'restart', 'status', 'read_logs', 'self_restart', 'promote']
// Add these input properties:
//   version: { type: 'string', description: 'Version label for the backup (e.g. "v1.4"). Defaults to timestamp.' }

// ALSO ADD to the execute switch:
//   case 'promote':
//     return promoteToLive(input);

// ALSO ADD 'promote' to the staging blocked list:
//   const stagingBlocked = ['start', 'stop', 'restart', 'status', 'promote'];
