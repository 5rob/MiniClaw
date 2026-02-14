// promote.js — Auto-promotion from staging to live
// Part of process-manager v1.12
// Copies everything from staging/ to live EXCEPT protected paths.
// Preserves skill data/ folders (user content that lives only in each instance).
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');
const BACKUPS_DIR = path.join(PROJECT_ROOT, 'backups');
const RESTART_SIGNAL = path.join(PROJECT_ROOT, '.restart-signal');
const UPGRADE_CONTEXT = path.join(PROJECT_ROOT, '.upgrade-context');

// Paths that should NEVER be copied from staging to live during promotion.
// These are either environment-specific or identity-specific files that each
// instance must maintain independently.
const NEVER_PROMOTE = new Set([
  '.env',             // Different Discord tokens, API keys, WAKE_CHANNEL_ID per instance
  'SOUL.md',          // Live has its own personality — staging is "Test Bud"
  'IDENTITY.md',      // Live has its own identity
  'memory',           // Each instance has completely separate memory
  'data',             // Memory index database (sqlite) — locked at runtime
  'temp',             // Transient files (generated images, etc)
  'logs',             // Each instance has its own logs
  'node_modules',     // Dependencies managed separately (might differ)
  'package-lock.json',// Tied to node_modules
  'backups',          // Live manages its own backups
  'staging',          // Obviously don't copy staging into itself
  '.restart-signal',  // Runtime signal file
  '.upgrade-context', // Runtime upgrade context
  '.git',             // Version control (if present)
]);

// Folder names that should be preserved (not overwritten) inside skill directories.
// These contain user/instance-specific content, not code.
const SKILL_PROTECTED_FOLDERS = new Set([
  'data',             // Skill data files (e.g. file-reader/data/ with user's .txt files)
]);

function shouldSkip(name) {
  return NEVER_PROMOTE.has(name);
}

/**
 * Smart copy for the skills/ directory.
 * Instead of nuking and replacing, merges at the skill level:
 * - Code files (handler.js, SKILL.md, etc.) are overwritten
 * - Protected folders (data/) in the destination are preserved
 * - New skills from staging are copied entirely
 * - Skills deleted in staging are removed from live
 */
function copySkillsDir(srcSkills, destSkills) {
  fs.mkdirSync(destSkills, { recursive: true });
  
  const srcSkillNames = new Set(fs.readdirSync(srcSkills));
  const destSkillNames = fs.existsSync(destSkills) 
    ? new Set(fs.readdirSync(destSkills)) 
    : new Set();
  
  // Remove skills from dest that don't exist in src (deleted skills)
  for (const skillName of destSkillNames) {
    if (!srcSkillNames.has(skillName)) {
      const destPath = path.join(destSkills, skillName);
      fs.rmSync(destPath, { recursive: true, force: true });
    }
  }
  
  // Copy/merge each skill from src to dest
  for (const skillName of srcSkillNames) {
    const srcSkill = path.join(srcSkills, skillName);
    const destSkill = path.join(destSkills, skillName);
    const srcStat = fs.statSync(srcSkill);
    
    if (!srcStat.isDirectory()) {
      // Top-level file in skills/ (unlikely but handle it)
      fs.copyFileSync(srcSkill, destSkill);
      continue;
    }
    
    // Merge this skill directory
    fs.mkdirSync(destSkill, { recursive: true });
    const entries = fs.readdirSync(srcSkill, { withFileTypes: true });
    
    // Track what src has so we can clean up removed files
    const srcEntryNames = new Set(entries.map(e => e.name));
    
    // Remove dest entries that don't exist in src (except protected folders)
    if (fs.existsSync(destSkill)) {
      const destEntries = fs.readdirSync(destSkill, { withFileTypes: true });
      for (const destEntry of destEntries) {
        if (SKILL_PROTECTED_FOLDERS.has(destEntry.name)) continue; // Never delete protected
        if (!srcEntryNames.has(destEntry.name)) {
          const removePath = path.join(destSkill, destEntry.name);
          fs.rmSync(removePath, { recursive: true, force: true });
        }
      }
    }
    
    for (const entry of entries) {
      const srcPath = path.join(srcSkill, entry.name);
      const destPath = path.join(destSkill, entry.name);
      
      if (entry.isDirectory()) {
        if (SKILL_PROTECTED_FOLDERS.has(entry.name)) {
          // Protected folder — skip entirely, preserve destination's version
          continue;
        }
        // Non-protected subdirectory — replace entirely
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        fs.cpSync(srcPath, destPath, { recursive: true });
      } else {
        // Regular file — overwrite
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

/**
 * Recursively copy a directory, skipping top-level NEVER_PROMOTE entries.
 * Uses smart merging for skills/ to preserve data folders.
 */
function copyDirContents(src, dest, isRoot = false) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Only apply skip rules at the staging root level
    if (isRoot && shouldSkip(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Special handling for skills/ — smart merge instead of nuke-and-replace
      if (isRoot && entry.name === 'skills') {
        copySkillsDir(srcPath, destPath);
        continue;
      }
      
      // For other directories: remove existing live version and replace entirely
      // This ensures deleted files in staging don't persist in live
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Parse a version string like "v1.9" and return the next version "v1.10".
 * Handles proper semantic-ish versioning (1.10 after 1.9, not 2.0).
 */
function getNextVersion(currentVersion) {
  const match = currentVersion.match(/^v?(\d+)\.(\d+)$/);
  if (!match) return currentVersion; // Can't parse, return as-is
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return `v${major}.${minor + 1}`;
}

/**
 * Detect the current version from the most recent backup name.
 */
function detectCurrentVersion() {
  if (!fs.existsSync(BACKUPS_DIR)) return 'v1.0';

  const backups = fs.readdirSync(BACKUPS_DIR)
    .filter(d => {
      try { return fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory(); } catch { return false; }
    })
    .filter(d => /^v-v?\d+\.\d+/.test(d))
    .sort((a, b) => {
      // Extract version numbers for proper sorting
      const aMatch = a.match(/v-v?(\d+)\.(\d+)/);
      const bMatch = b.match(/v-v?(\d+)\.(\d+)/);
      if (!aMatch || !bMatch) return a.localeCompare(b);
      const aMajor = parseInt(aMatch[1], 10), aMinor = parseInt(aMatch[2], 10);
      const bMajor = parseInt(bMatch[1], 10), bMinor = parseInt(bMatch[2], 10);
      return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor;
    });

  if (backups.length === 0) return 'v1.0';

  const latest = backups[backups.length - 1];
  const match = latest.match(/v-v?(\d+\.\d+)/);
  return match ? `v${match[1]}` : 'v1.0';
}

export function promote(input = {}) {
  const dryRun = input.dryRun || false;
  const skipRestart = input.skipRestart || false;

  // Auto-detect version if not provided, and auto-increment
  let version;
  if (input.version) {
    version = input.version;
  } else {
    const current = detectCurrentVersion();
    version = getNextVersion(current);
  }

  // Validate staging exists
  if (!fs.existsSync(STAGING_DIR)) {
    return { success: false, error: 'Staging directory not found.' };
  }

  // Scan what would be promoted (everything except NEVER_PROMOTE)
  const stagingEntries = fs.readdirSync(STAGING_DIR);
  const wouldPromote = stagingEntries.filter(name => !shouldSkip(name));
  const wouldSkip = stagingEntries.filter(name => shouldSkip(name));

  if (wouldPromote.length === 0) {
    return { success: false, error: 'Nothing to promote — staging directory is empty or only contains protected paths.' };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      message: 'Dry run — no changes made. Note: skills/*/data/ folders are preserved in live during promotion.',
      version,
      wouldPromote,
      wouldSkip,
      neverPromote: [...NEVER_PROMOTE],
      protectedSkillFolders: [...SKILL_PROTECTED_FOLDERS]
    };
  }

  // Step 1: Create backup of current live files
  const backupName = `v-${version}-${getTimestamp()}`;
  const backupDir = path.join(BACKUPS_DIR, backupName);

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    // Backup everything that would be overwritten
    for (const name of wouldPromote) {
      const livePath = path.join(PROJECT_ROOT, name);
      const backupPath = path.join(backupDir, name);

      if (!fs.existsSync(livePath)) continue;

      const stat = fs.statSync(livePath);
      if (stat.isDirectory()) {
        fs.cpSync(livePath, backupPath, { recursive: true });
      } else {
        fs.copyFileSync(livePath, backupPath);
      }
    }
  } catch (err) {
    return { success: false, error: `Backup failed: ${err.message}`, backupDir };
  }

  // Step 2: Copy staging files to live (skip protected paths, smart-merge skills/)
  const promoted = [];
  try {
    copyDirContents(STAGING_DIR, PROJECT_ROOT, true);
    promoted.push(...wouldPromote);
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
    message: `Promotion complete! ${promoted.length} paths updated from staging to live. Skill data/ folders preserved.`,
    version,
    promoted,
    skipped: wouldSkip,
    backupDir,
    backupName,
    restart: restartResult || 'Skipped (skipRestart=true). You\'ll need to restart manually.'
  };
}
