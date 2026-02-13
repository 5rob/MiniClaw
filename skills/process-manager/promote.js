// promote.js — Auto-promotion from staging to live
// Part of process-manager v1.5, updated v1.8 (upgrade context)
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');
const BACKUPS_DIR = path.join(PROJECT_ROOT, 'backups');
const RESTART_SIGNAL = path.join(PROJECT_ROOT, '.restart-signal');
const UPGRADE_CONTEXT = path.join(PROJECT_ROOT, '.upgrade-context');

// Files/folders to promote from staging to live
const PROMOTE_PATHS = ['src', 'skills'];

// Files/folders to NEVER overwrite during promotion
const SKIP_PATTERNS = ['.env', 'node_modules', 'logs', 'backups', 'memory', 'SOUL.md', 'IDENTITY.md'];

function shouldSkip(name) {
  return SKIP_PATTERNS.some(pattern => name === pattern || name.startsWith(pattern));
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function promote(input = {}) {
  const dryRun = input.dryRun || false;
  const skipRestart = input.skipRestart || false;
  const version = input.version || 'unknown';

  // Validate staging exists
  if (!fs.existsSync(STAGING_DIR)) {
    return { success: false, error: 'Staging directory not found.' };
  }

  // Check what files would be promoted
  const changes = [];
  for (const promotePath of PROMOTE_PATHS) {
    const stagingPath = path.join(STAGING_DIR, promotePath);
    if (fs.existsSync(stagingPath)) {
      changes.push(promotePath);
    }
  }

  // Also check for config.json
  const stagingConfig = path.join(STAGING_DIR, 'config.json');
  if (fs.existsSync(stagingConfig)) {
    changes.push('config.json');
  }

  if (changes.length === 0) {
    return { success: false, error: 'Nothing to promote — no matching paths found in staging.' };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      message: 'Dry run — no changes made.',
      wouldPromote: changes,
      wouldSkip: SKIP_PATTERNS
    };
  }

  // Step 1: Create backup of current live files
  const backupName = `v-${version}-${getTimestamp()}`;
  const backupDir = path.join(BACKUPS_DIR, backupName);

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    for (const promotePath of PROMOTE_PATHS) {
      const livePath = path.join(PROJECT_ROOT, promotePath);
      const backupPath = path.join(backupDir, promotePath);
      if (fs.existsSync(livePath)) {
        copyDirRecursive(livePath, backupPath);
      }
    }

    // Backup config.json too
    const liveConfig = path.join(PROJECT_ROOT, 'config.json');
    if (fs.existsSync(liveConfig)) {
      fs.copyFileSync(liveConfig, path.join(backupDir, 'config.json'));
    }
  } catch (err) {
    return { success: false, error: `Backup failed: ${err.message}`, backupDir };
  }

  // Step 2: Copy staging files to live
  const promoted = [];
  try {
    for (const promotePath of PROMOTE_PATHS) {
      const stagingPath = path.join(STAGING_DIR, promotePath);
      const livePath = path.join(PROJECT_ROOT, promotePath);
      if (fs.existsSync(stagingPath)) {
        copyDirRecursive(stagingPath, livePath);
        promoted.push(promotePath);
      }
    }

    // Promote config.json if it exists in staging
    if (fs.existsSync(stagingConfig)) {
      fs.copyFileSync(stagingConfig, path.join(PROJECT_ROOT, 'config.json'));
      promoted.push('config.json');
    }
  } catch (err) {
    return {
      success: false,
      error: `Promotion failed mid-copy: ${err.message}. Backup available at ${backupDir}`,
      promoted,
      backupDir
    };
  }

  // Step 3: Write upgrade context file (for context-aware wake-up message)
  try {
    const upgradeContext = {
      version,
      promoted,
      timestamp: new Date().toISOString(),
      backupDir
    };
    fs.writeFileSync(UPGRADE_CONTEXT, JSON.stringify(upgradeContext, null, 2));
  } catch (err) {
    // Non-fatal — wake-up just won't have upgrade context
    console.error('[Promote] Failed to write upgrade context:', err.message);
  }

  // Step 4: Signal restart (unless skipped)
  let restartResult = null;
  if (!skipRestart) {
    try {
      const signal = {
        timestamp: new Date().toISOString(),
        reason: `Promotion to ${version}`,
        requestedBy: 'process-manager-promote',
        backupDir
      };
      fs.writeFileSync(RESTART_SIGNAL, JSON.stringify(signal, null, 2));
      restartResult = 'Restart signal written. Watchdog will restart the live bot.';
    } catch (err) {
      restartResult = `Warning: Promotion succeeded but restart signal failed: ${err.message}. Manual restart needed.`;
    }
  }

  return {
    success: true,
    message: `Promotion complete! ${promoted.length} paths updated.`,
    promoted,
    backupDir,
    backupName,
    restart: restartResult || 'Skipped (skipRestart=true). You\'ll need to restart manually.',
    version
  };
}
