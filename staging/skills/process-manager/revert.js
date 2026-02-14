// revert.js — Reset staging to match live
// Part of process-manager v1.12
// Copies promotable paths from live → staging, giving a clean slate.
// Respects the same NEVER_COPY exclusions — each instance keeps its own
// .env, SOUL.md, IDENTITY.md, memory/, logs/, etc.
// Preserves skill data/ folders in staging (instance-specific content).
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

// Folder names that should be preserved inside skill directories
const SKILL_PROTECTED_FOLDERS = new Set([
  'data',
]);

function shouldSkip(name) {
  return NEVER_COPY.has(name);
}

/**
 * Smart copy for skills/ directory during revert.
 * Merges at the skill level, preserving data/ folders in staging.
 */
function copySkillsDir(srcSkills, destSkills) {
  fs.mkdirSync(destSkills, { recursive: true });

  const srcSkillNames = new Set(fs.readdirSync(srcSkills));
  const destSkillNames = fs.existsSync(destSkills)
    ? new Set(fs.readdirSync(destSkills))
    : new Set();

  // Remove skills from dest that don't exist in src
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
      fs.copyFileSync(srcSkill, destSkill);
      continue;
    }

    fs.mkdirSync(destSkill, { recursive: true });
    const entries = fs.readdirSync(srcSkill, { withFileTypes: true });

    // Track src entries for cleanup
    const srcEntryNames = new Set(entries.map(e => e.name));

    // Remove dest entries not in src (except protected folders)
    if (fs.existsSync(destSkill)) {
      const destEntries = fs.readdirSync(destSkill, { withFileTypes: true });
      for (const destEntry of destEntries) {
        if (SKILL_PROTECTED_FOLDERS.has(destEntry.name)) continue;
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
          // Protected — preserve staging's version
          continue;
        }
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        fs.cpSync(srcPath, destPath, { recursive: true });
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

/**
 * Copy live root-level entries into staging, skipping protected paths.
 * Uses smart merging for skills/ to preserve data folders.
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
      // Special handling for skills/ — smart merge
      if (entry.name === 'skills') {
        copySkillsDir(srcPath, destPath);
        copied.push(entry.name);
        continue;
      }

      // Other directories: replace entirely
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
      message: 'Dry run — no changes made. Staging would be reset to match live. Skill data/ folders preserved.',
      wouldCopy: liveEntries,
      wouldSkip,
      neverCopy: [...NEVER_COPY],
      protectedSkillFolders: [...SKILL_PROTECTED_FOLDERS]
    };
  }

  // Do the copy
  try {
    const { copied, skipped } = copyLiveToStaging(PROJECT_ROOT, STAGING_DIR);

    return {
      success: true,
      message: `Staging reverted to match live. ${copied.length} paths copied, ${skipped.length} skipped (instance-specific). Skill data/ folders preserved.`,
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
