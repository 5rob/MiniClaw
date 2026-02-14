// skills/git-push/handler.js
// Automates git add, commit, and push from the live project root
// v1.11 — Initial build
import { execSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const IS_STAGING = process.env.BOT_ROLE === 'staging';

function runGit(command) {
  return execSync(command, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30000
  }).trim();
}

function getStatus() {
  try {
    const status = runGit('git status --porcelain');
    if (!status) {
      return { success: true, clean: true, message: 'Working tree is clean. Nothing to commit or push.' };
    }

    const lines = status.split('\n').filter(l => l.trim());
    const changes = lines.map(line => {
      const code = line.substring(0, 2);
      const file = line.substring(3);
      return { status: code.trim(), file };
    });

    return {
      success: true,
      clean: false,
      changeCount: changes.length,
      changes
    };
  } catch (err) {
    return { success: false, error: `Failed to get git status: ${err.message}` };
  }
}

function getDiff() {
  try {
    // Show staged + unstaged changes (summary only to keep it concise)
    const diffStat = runGit('git diff --stat');
    const diffStaged = runGit('git diff --cached --stat');
    const untracked = runGit('git ls-files --others --exclude-standard');

    return {
      success: true,
      unstaged: diffStat || '(none)',
      staged: diffStaged || '(none)',
      untracked: untracked ? untracked.split('\n').filter(l => l.trim()) : []
    };
  } catch (err) {
    return { success: false, error: `Failed to get diff: ${err.message}` };
  }
}

function push(input) {
  try {
    // Step 1: Check if there are changes
    const statusRaw = runGit('git status --porcelain');
    if (!statusRaw && !input.forcePush) {
      // Check if there are unpushed commits
      try {
        const unpushed = runGit('git log origin/main..HEAD --oneline');
        if (unpushed) {
          // There are local commits not yet pushed
          const pushOutput = runGit('git push');
          return {
            success: true,
            message: 'Pushed existing unpushed commits to remote.',
            pushOutput: pushOutput || '(pushed successfully)',
            unpushedCommits: unpushed
          };
        }
      } catch (e) {
        // origin/main might not exist yet, that's ok
      }
      return { success: true, message: 'Nothing to commit or push. Working tree is clean and up to date.' };
    }

    // Step 2: Stage all changes
    runGit('git add -A');

    // Step 3: Generate or use provided commit message
    const commitMessage = input.message || generateCommitMessage();

    // Step 4: Commit
    let commitOutput;
    try {
      commitOutput = runGit(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
    } catch (err) {
      // If nothing to commit after staging (e.g., only .gitignored files changed)
      if (err.message.includes('nothing to commit')) {
        return { success: true, message: 'Nothing to commit after staging. All changes may be gitignored.' };
      }
      throw err;
    }

    // Step 5: Push
    const pushOutput = runGit('git push');

    return {
      success: true,
      message: `Committed and pushed successfully.`,
      commitMessage,
      commitOutput,
      pushOutput: pushOutput || '(pushed successfully)'
    };
  } catch (err) {
    return { success: false, error: `Git push failed: ${err.message}` };
  }
}

function generateCommitMessage() {
  try {
    // Get a summary of what changed
    const status = runGit('git status --porcelain');
    const lines = status.split('\n').filter(l => l.trim());

    const added = lines.filter(l => l.startsWith('?') || l.startsWith('A')).length;
    const modified = lines.filter(l => l.startsWith('M') || l.startsWith(' M')).length;
    const deleted = lines.filter(l => l.startsWith('D') || l.startsWith(' D')).length;

    // Check which areas changed
    const paths = lines.map(l => l.substring(3));
    const areas = new Set();

    for (const p of paths) {
      if (p.startsWith('src/')) areas.add('core');
      else if (p.startsWith('skills/')) {
        const skillName = p.split('/')[1];
        areas.add(`skill:${skillName}`);
      }
      else if (p === 'watchdog.js') areas.add('watchdog');
      else if (p === 'package.json') areas.add('deps');
      else if (p === '.gitignore') areas.add('config');
      else if (p === 'config.json') areas.add('config');
      else if (p.startsWith('SOUL') || p.startsWith('IDENTITY')) areas.add('identity');
      else areas.add('other');
    }

    const parts = [];
    if (areas.size > 0) parts.push([...areas].join(', '));

    const changeParts = [];
    if (added > 0) changeParts.push(`${added} added`);
    if (modified > 0) changeParts.push(`${modified} modified`);
    if (deleted > 0) changeParts.push(`${deleted} deleted`);

    const areaStr = parts.length > 0 ? `[${parts[0]}] ` : '';
    const changeStr = changeParts.length > 0 ? changeParts.join(', ') : 'updates';

    return `${areaStr}${changeStr}`;
  } catch (err) {
    return 'Update from MiniClaw bot';
  }
}

// Tool definition
export const toolDefinition = {
  name: 'git_push',
  description: 'Push the live MiniClaw project to GitHub. Actions: status (see what changed), diff (detailed change summary), push (add, commit, push). Auto-generates commit messages based on what changed, or you can provide a custom message.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'diff', 'push'],
        description: 'What to do: status (check changes), diff (detailed changes), push (commit and push everything)'
      },
      message: {
        type: 'string',
        description: 'For push: custom commit message. If omitted, auto-generates based on changes.'
      }
    },
    required: ['action']
  }
};

// Main execute function
export async function execute(input) {
  if (IS_STAGING) {
    return {
      success: false,
      error: "I'm the staging instance (Test Bud) — git push only works from the live bot to avoid pushing experimental code."
    };
  }

  switch (input.action) {
    case 'status':
      return getStatus();
    case 'diff':
      return getDiff();
    case 'push':
      return push(input);
    default:
      return { success: false, error: `Unknown action: ${input.action}` };
  }
}
