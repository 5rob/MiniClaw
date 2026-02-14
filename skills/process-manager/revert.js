// revert.js — Reset staging to match live
// Part of process-manager v1.11
// Copies promotable paths from live → staging, giving a clean slate.
// Respects the same NEVER_PROMOTE exclusions — each instance keeps its own
// .env, SOUL.md, IDENTITY.md, memory/, logs/, etc.
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');

// Same exclusion list as promote.js — these are instance-specific
const NEVER_COPY = new Set([
  '.env',
  'SOUL.md',
  'IDENTITY.md',
  'memory',
  'logs',
  'node_modules',
  'package-lock.json',
  'backups',
  'staging',
  '.restart-signal',
  '.upgrade-context',
  '.git',
]);

function shouldSkip(name) {
  return NEVER_COPY.has(name);
}

/**
 * Copy live root-level entries into staging, skipping protected paths.
 * For directories: removes the existing staging version and replaces entirely.
 */
function copyLiveToStaging(liveRoot, stagingRoot) {
  fs.mkdirSync(stagingRoot, { recursive: true });
  const entries = fs.readdirSync(liveRoot, { withFileTypes: true });

  const copied = [];
  const skipped = [];

  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      skipped.push(entry.name);
      continue;
    }

    const srcPath = path.join(liveRoot, entry.name);
    const destPath = path.join(stagingRoot, entry.name);

    if (entry.isDirectory()) {
      // Remove existing staging version and replace entirely
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }

    copied.push(entry.name);
  }

  return { copied, skipped };
}

export function revert(input = {}) {
  const dryRun = input.dryRun || false;

  // Validate staging exists
  if (!fs.existsSync(STAGING_DIR)) {
    return { success: false, error: 'Staging directory not found.' };
  }

  // Scan what would be copied from live
  const liveEntries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true })
    .filter(e => !shouldSkip(e.name))
    .map(e => e.name);

  if (liveEntries.length === 0) {
    return { success: false, error: 'Nothing to copy from live — unexpected.' };
  }

  if (dryRun) {
    const wouldSkip = fs.readdirSync(PROJECT_ROOT)
      .filter(name => shouldSkip(name));

    return {
      success: true,
      dryRun: true,
      message: 'Dry run — no changes made. Staging would be reset to match live.',
      wouldCopy: liveEntries,
      wouldSkip,
      neverCopy: [...NEVER_COPY]
    };
  }

  // Do the copy
  try {
    const { copied, skipped } = copyLiveToStaging(PROJECT_ROOT, STAGING_DIR);

    return {
      success: true,
      message: `Staging reverted to match live. ${copied.length} paths copied, ${skipped.length} skipped (instance-specific).`,
      copied,
      skipped
    };
  } catch (err) {
    return {
      success: false,
      error: `Revert failed: ${err.message}`
    };
  }
}
