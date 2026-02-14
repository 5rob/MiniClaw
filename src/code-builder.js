// src/code-builder.js
// Replaces skill-builder.js — handles both project management AND Claude Code builds
// v2.0 — Merged skill_builder actions + Claude Code delegation
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const SKILLS_DIR = path.resolve('skills');
const STAGING_DIR = path.join(PROJECT_ROOT, 'staging');
const STAGING_SKILLS_DIR = path.join(STAGING_DIR, 'skills');
const BUILD_LOG_DIR = path.join(STAGING_DIR, 'logs', 'builds');
const IS_STAGING = process.env.BOT_ROLE === 'staging';

fs.mkdirSync(SKILLS_DIR, { recursive: true });

// Track active builds so we don't stack them
let activeBuild = null;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function timestamp() {
  return new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' });
}

function isoTimestamp() {
  return new Date().toISOString();
}

// ============================================================
// PROJECT MANAGEMENT ACTIONS (migrated from skill-builder.js)
// ============================================================

function listProjects() {
  if (!fs.existsSync(SKILLS_DIR)) return { projects: [] };

  const projects = fs.readdirSync(SKILLS_DIR)
    .filter(d => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory())
    .map(name => {
      const progressPath = path.join(SKILLS_DIR, name, 'PROGRESS.md');
      const hasHandler = fs.existsSync(path.join(SKILLS_DIR, name, 'handler.js'));
      const progress = fs.existsSync(progressPath)
        ? fs.readFileSync(progressPath, 'utf-8')
        : '(no progress file)';

      return {
        name,
        hasHandler,
        latestProgress: progress.slice(-500)
      };
    });

  return { projects };
}

function readProject(input) {
  const { skillName } = input;
  if (!skillName) throw new Error('skillName required');

  const skillDir = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  const files = {};
  for (const file of ['SKILL.md', 'handler.js', 'PROGRESS.md']) {
    const p = path.join(skillDir, file);
    files[file] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  }

  // List data files
  const dataDir = path.join(skillDir, 'data');
  files.dataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

  return files;
}

function readFile(input) {
  const { skillName, fileName } = input;
  if (!skillName || !fileName) throw new Error('skillName and fileName required');

  const filePath = path.join(SKILLS_DIR, skillName, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${fileName}`);
  }

  return { content: fs.readFileSync(filePath, 'utf-8') };
}

function writeDataFile(input) {
  const { skillName, fileName, content } = input;
  if (!skillName || !fileName || content === undefined) {
    throw new Error('skillName, fileName, and content required');
  }

  const filePath = path.join(SKILLS_DIR, skillName, 'data', fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);

  return { success: true, message: `Data file written: ${fileName}` };
}

function updateHandler(input) {
  const { skillName, content } = input;
  if (!skillName || !content) throw new Error('skillName and content required');

  const handlerPath = path.join(SKILLS_DIR, skillName, 'handler.js');
  if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  fs.writeFileSync(handlerPath, content);
  return { success: true, message: `handler.js updated for "${skillName}"` };
}

function updateSkillMd(input) {
  const { skillName, content } = input;
  if (!skillName || !content) throw new Error('skillName and content required');

  const skillMdPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  fs.writeFileSync(skillMdPath, content);
  return { success: true, message: `SKILL.md updated for "${skillName}"` };
}

function updateProgress(input) {
  const { skillName, content } = input;
  if (!skillName || !content) throw new Error('skillName and content required');

  const progressPath = path.join(SKILLS_DIR, skillName, 'PROGRESS.md');
  if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
    throw new Error(`Skill "${skillName}" not found`);
  }

  const now = isoTimestamp();
  fs.appendFileSync(progressPath, `\n## ${now}\n${content}\n`);
  return { success: true, message: `Progress updated for "${skillName}"` };
}


// ============================================================
// CLAUDE CODE BUILD ACTIONS (new)
// ============================================================

// --- Action: generate_prompt ---
// Creates a detailed build prompt and CLAUDE.md for Claude Code to follow.
function generatePrompt(input) {
  const { skillName, description, requirements, examplePhrases, dataNeeds, existingCode } = input;

  if (!skillName) return { success: false, error: 'skillName is required' };
  if (!description) return { success: false, error: 'description is required — what should this skill do?' };

  const skillDir = path.join(STAGING_SKILLS_DIR, skillName);
  const toolName = skillName.replace(/-/g, '_');

  ensureDir(skillDir);
  ensureDir(BUILD_LOG_DIR);

  // Build the prompt that Claude Code will receive
  const buildPrompt = `# Build Request: ${skillName}

## Overview
${description}

## Skill Architecture
This is a MiniClaw Discord bot skill. Each skill is a self-contained folder with:
- \`handler.js\` — The main module. MUST export:
  - \`toolDefinition\` — An Anthropic tool_use schema object ({ name, description, input_schema })
  - \`execute(input)\` — An async function that receives the tool input and returns a result object
- \`SKILL.md\` — Documentation: what the skill does, when to use it, example trigger phrases
- \`PROGRESS.md\` — Development log (append-only, timestamped entries)
- \`data/\` — Optional persistent data directory for JSON/text files

## Technical Requirements
- ES modules (import/export, no require())
- Node.js 20+ (no browser APIs)
- The skill runs inside a Discord bot on Windows — no network calls unless explicitly needed
- \`process.cwd()\` returns the MiniClaw project root
- The handler is loaded via dynamic import: \`import('file:///path/to/handler.js')\`
- All file operations should use \`path.resolve()\` for Windows compatibility
- Return objects from execute() — they get JSON-serialized and sent back to Claude API as tool results
- Errors should be returned as \`{ success: false, error: 'message' }\`, not thrown (unless truly fatal)

## Tool Definition Pattern
\`\`\`javascript
export const toolDefinition = {
  name: '${toolName}',
  description: 'Clear description of what this tool does and when to use it',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['action1', 'action2'],
        description: 'What operation to perform'
      }
      // ... more properties
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action } = input;
  switch (action) {
    case 'action1':
      return { success: true, data: '...' };
    default:
      return { success: false, error: \`Unknown action: \${action}\` };
  }
}
\`\`\`

${requirements ? `## Specific Requirements\n${requirements}\n` : ''}
${examplePhrases ? `## Example Trigger Phrases\nThese are the kinds of things the user might say that should activate this tool:\n${examplePhrases.map(p => `- "${p}"`).join('\n')}\n` : ''}
${dataNeeds ? `## Data Storage Notes\n${dataNeeds}\n` : ''}
${existingCode ? `## Existing Code to Build On\n\`\`\`javascript\n${existingCode}\n\`\`\`\n` : ''}

## What to Build
1. Create \`handler.js\` with the full working implementation
2. Create \`SKILL.md\` with clear documentation
3. Create \`PROGRESS.md\` with an initial entry
4. Create the \`data/\` directory if the skill needs persistent storage
5. Make sure the code actually works — no placeholder TODOs

## Important
- The tool name in toolDefinition.name MUST be: \`${toolName}\`
- The skill folder is: \`skills/${skillName}/\`
- Write COMPLETE, WORKING code. Not stubs. Not placeholders. Real, functional code.
- Test your logic mentally — walk through the execute() function with sample inputs.
`;

  // Write CLAUDE.md so Claude Code has project context
  const claudeMd = `# MiniClaw Skill Builder Context

You are building a skill for MiniClaw, a Discord bot that uses the Anthropic API with tool_use.

## Project Structure
- This skill goes in: \`skills/${skillName}/\`
- Working directory: \`${skillDir}\`
- You should create: handler.js, SKILL.md, PROGRESS.md, and optionally data/

## Key Conventions
- ES modules only (import/export)
- handler.js must export \`toolDefinition\` and \`execute(input)\`
- Return objects from execute(), don't use console.log for output
- Use path.resolve() for all file paths (Windows compatibility)
- Errors: return { success: false, error: 'msg' } instead of throwing

## Do NOT
- Modify any files outside of \`skills/${skillName}/\`
- Install npm packages (use only Node.js built-ins + what's already installed)
- Create test files or configuration outside the skill folder
- Use require() — this project uses ES modules
`;

  fs.writeFileSync(path.join(skillDir, 'CLAUDE.md'), claudeMd);
  fs.writeFileSync(path.join(skillDir, '.build-prompt.md'), buildPrompt);

  return {
    success: true,
    message: `Build prompt generated for "${skillName}". Review it and use action "build" to kick off Claude Code, or adjust with "update_prompt" first.`,
    skillName,
    skillDir,
    promptPreview: buildPrompt.slice(0, 1500) + '\n\n... (truncated, full prompt saved to .build-prompt.md)',
    nextStep: `To start the build, use code_builder with action "build" and skillName "${skillName}"`
  };
}

// --- Action: build ---
function build(input) {
  return new Promise((resolve) => {
    const { skillName, maxTurns } = input;

    if (!skillName) {
      return resolve({ success: false, error: 'skillName is required' });
    }

    if (IS_STAGING) {
      return resolve({ success: false, error: 'Build actions are only available from the live bot.' });
    }

    if (activeBuild) {
      return resolve({
        success: false,
        error: `A build is already in progress: "${activeBuild.skillName}" (PID: ${activeBuild.pid}). Use action "build_status" to check progress.`
      });
    }

    const skillDir = path.join(STAGING_SKILLS_DIR, skillName);
    const promptPath = path.join(skillDir, '.build-prompt.md');

    if (!fs.existsSync(promptPath)) {
      return resolve({
        success: false,
        error: `No build prompt found for "${skillName}". Run action "generate_prompt" first.`
      });
    }

    const buildPrompt = fs.readFileSync(promptPath, 'utf-8');
    const logFile = path.join(BUILD_LOG_DIR, `${skillName}-${Date.now()}.log`);
    ensureDir(BUILD_LOG_DIR);

    const turns = maxTurns || 30;

    const args = [
      '-p',
      '--output-format', 'json',
      '--max-turns', turns.toString(),
      '--allowedTools', 'Read,Write,Edit,Bash(node *),Bash(ls *),Bash(cat *),Bash(mkdir *),Bash(echo *),Bash(test *)',
    ];

    let stdout = '';
    let stderr = '';
    const buildLog = [];
    const startTime = Date.now();

    try {
      const proc = spawn('claude', args, {
        cwd: skillDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        shell: true
      });

      activeBuild = {
        skillName,
        pid: proc.pid,
        startTime,
        logFile,
        process: proc
      };

      const addLog = (source, data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          const entry = `[${timestamp()}] [${source}] ${line}`;
          buildLog.push(entry);
          fs.appendFileSync(logFile, entry + '\n');
        }
      };

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        addLog('stdout', data);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        addLog('stderr', data);
      });

      proc.on('error', (err) => {
        addLog('error', `Process error: ${err.message}`);
        activeBuild = null;
        resolve({
          success: false,
          error: `Claude Code failed to start: ${err.message}`,
          hint: 'Make sure Claude Code is installed and on PATH. Run "claude --version" to check.'
        });
      });

      proc.on('exit', (code, signal) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        addLog('system', `Process exited with code ${code}, signal ${signal} (${elapsed}s)`);
        activeBuild = null;

        // Try to parse JSON output
        let result = null;
        let costInfo = null;
        try {
          const jsonStr = stdout.trim();
          if (jsonStr) {
            result = JSON.parse(jsonStr);
            if (result.total_cost_usd) {
              costInfo = `$${result.total_cost_usd.toFixed(4)}`;
            }
          }
        } catch (parseErr) {
          addLog('parse', `Could not parse JSON output: ${parseErr.message}`);
        }

        // Update PROGRESS.md
        const progressPath = path.join(skillDir, 'PROGRESS.md');
        const progressEntry = `\n## ${isoTimestamp()} — Claude Code Build\n- Exit code: ${code}\n- Duration: ${elapsed}s\n${costInfo ? `- Cost: ${costInfo}\n` : ''}- Log: ${logFile}\n- Status: ${code === 0 ? 'SUCCESS' : 'FAILED'}\n`;

        try {
          if (fs.existsSync(progressPath)) {
            fs.appendFileSync(progressPath, progressEntry);
          } else {
            fs.writeFileSync(progressPath, `# ${skillName} — Development Progress\n${progressEntry}`);
          }
        } catch (e) { /* non-fatal */ }

        // Validate the result
        const handlerExists = fs.existsSync(path.join(skillDir, 'handler.js'));
        const skillMdExists = fs.existsSync(path.join(skillDir, 'SKILL.md'));

        let handlerValid = false;
        if (handlerExists) {
          try {
            const handlerContent = fs.readFileSync(path.join(skillDir, 'handler.js'), 'utf-8');
            handlerValid = handlerContent.includes('toolDefinition') && handlerContent.includes('execute');
          } catch (e) { /* can't read */ }
        }

        resolve({
          success: code === 0 && handlerExists && handlerValid,
          exitCode: code,
          duration: `${elapsed}s`,
          cost: costInfo,
          skillName,
          files: {
            handlerJs: handlerExists ? (handlerValid ? 'valid' : 'exists but missing exports') : 'NOT CREATED',
            skillMd: skillMdExists ? 'created' : 'NOT CREATED'
          },
          logFile,
          logTail: buildLog.slice(-15).map(l => l.replace(/\[.*?\]\s*/, '')).join('\n'),
          nextSteps: code === 0 && handlerValid
            ? `Skill built successfully! You can:\n1. Use process_manager to restart staging and test it\n2. Review the code with code_builder read_project action\n3. When happy, promote staging to live`
            : `Build may have issues. Check the log or use read_project to review.`,
          claudeCodeResult: result?.result || null
        });
      });

      // Feed prompt via stdin
      proc.stdin.write(buildPrompt);
      proc.stdin.end();

    } catch (err) {
      activeBuild = null;
      resolve({ success: false, error: `Failed to spawn Claude Code: ${err.message}` });
    }
  });
}

// --- Action: build_status ---
function buildStatus() {
  if (!activeBuild) {
    return { success: true, building: false, message: 'No build currently in progress.' };
  }

  const elapsed = ((Date.now() - activeBuild.startTime) / 1000).toFixed(1);
  let logTail = '';
  try {
    if (fs.existsSync(activeBuild.logFile)) {
      const content = fs.readFileSync(activeBuild.logFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      logTail = lines.slice(-10).join('\n');
    }
  } catch (e) {
    logTail = '(unable to read log)';
  }

  return {
    success: true,
    building: true,
    skillName: activeBuild.skillName,
    pid: activeBuild.pid,
    elapsed: `${elapsed}s`,
    logFile: activeBuild.logFile,
    logTail
  };
}

// --- Action: cancel_build ---
function cancelBuild() {
  if (!activeBuild) {
    return { success: false, error: 'No build currently in progress.' };
  }

  const { skillName, pid } = activeBuild;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', pid.toString(), '/f', '/t'], { stdio: 'ignore' });
    } else {
      activeBuild.process.kill('SIGTERM');
    }
    activeBuild = null;
    return { success: true, message: `Build for "${skillName}" cancelled (was PID: ${pid})` };
  } catch (err) {
    return { success: false, error: `Failed to cancel build: ${err.message}` };
  }
}

// --- Action: list_builds ---
function listBuilds() {
  ensureDir(BUILD_LOG_DIR);

  try {
    const logs = fs.readdirSync(BUILD_LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const stats = fs.statSync(path.join(BUILD_LOG_DIR, f));
        return {
          file: f,
          skillName: f.replace(/-\d+\.log$/, ''),
          date: stats.mtime.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }),
          size: `${(stats.size / 1024).toFixed(1)}KB`
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    return {
      success: true,
      builds: logs,
      activeBuild: activeBuild ? { skillName: activeBuild.skillName, pid: activeBuild.pid } : null
    };
  } catch (err) {
    return { success: false, error: `Failed to list builds: ${err.message}` };
  }
}

// --- Action: read_build_log ---
function readBuildLog(input) {
  const { skillName, lines } = input;
  const maxLines = lines || 50;

  ensureDir(BUILD_LOG_DIR);

  try {
    const logs = fs.readdirSync(BUILD_LOG_DIR)
      .filter(f => f.startsWith(skillName + '-') && f.endsWith('.log'))
      .sort()
      .reverse();

    if (logs.length === 0) {
      return { success: false, error: `No build logs found for "${skillName}"` };
    }

    const logPath = path.join(BUILD_LOG_DIR, logs[0]);
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    const tail = allLines.slice(-maxLines);

    return {
      success: true,
      logFile: logs[0],
      totalLines: allLines.length,
      returnedLines: tail.length,
      logs: tail.join('\n')
    };
  } catch (err) {
    return { success: false, error: `Failed to read build log: ${err.message}` };
  }
}

// --- Action: rebuild ---
function rebuild(input) {
  const { skillName } = input;
  const promptPath = path.join(STAGING_SKILLS_DIR, skillName, '.build-prompt.md');

  if (!fs.existsSync(promptPath)) {
    return { success: false, error: `No build prompt found for "${skillName}". Use generate_prompt first.` };
  }

  return build(input);
}

// --- Action: update_prompt ---
function updatePrompt(input) {
  const { skillName, additionalInstructions } = input;

  if (!skillName || !additionalInstructions) {
    return { success: false, error: 'skillName and additionalInstructions are required' };
  }

  const promptPath = path.join(STAGING_SKILLS_DIR, skillName, '.build-prompt.md');

  if (!fs.existsSync(promptPath)) {
    return { success: false, error: `No build prompt found for "${skillName}". Use generate_prompt first.` };
  }

  const existing = fs.readFileSync(promptPath, 'utf-8');
  const updated = existing + `\n\n## Additional Instructions (${isoTimestamp()})\n${additionalInstructions}\n`;
  fs.writeFileSync(promptPath, updated);

  return {
    success: true,
    message: `Build prompt updated for "${skillName}". Use action "build" or "rebuild" to run with the updated instructions.`
  };
}


// ============================================================
// TOOL DEFINITION
// ============================================================

export const toolDefinition = {
  name: 'code_builder',
  description: `The unified skill/tool management system. Use this for ALL skill operations:

PROJECT MANAGEMENT (immediate, no Claude Code needed):
- "list_projects" — List all installed skills with their status
- "read_project" — Read a skill's files (handler.js, SKILL.md, PROGRESS.md)
- "read_file" — Read any file within a skill folder
- "write_data_file" — Write to a skill's data/ directory
- "update_handler" — Directly overwrite a skill's handler.js (for quick manual fixes)
- "update_skill_md" — Update a skill's SKILL.md documentation
- "update_progress" — Append to a skill's PROGRESS.md log

BUILDING NEW SKILLS (delegates to Claude Code for high-quality results):
- "generate_prompt" — Create a detailed build spec (always do this first, present to Rob for review)
- "build" — Spawn Claude Code to build the skill in staging/skills/
- "build_status" — Check progress of an active build
- "cancel_build" — Stop a running build
- "list_builds" — View recent build history
- "read_build_log" — Read detailed logs from a past build
- "rebuild" — Re-run a build with existing/updated prompt
- "update_prompt" — Add instructions to a build prompt before rebuilding

WORKFLOW: generate_prompt → (Rob reviews) → build → restart staging → test → promote to live`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list_projects', 'read_project', 'read_file', 'write_data_file',
          'update_handler', 'update_skill_md', 'update_progress',
          'generate_prompt', 'build', 'build_status', 'cancel_build',
          'list_builds', 'read_build_log', 'rebuild', 'update_prompt'
        ],
        description: 'What to do'
      },
      skillName: {
        type: 'string',
        description: 'Skill folder name (kebab-case, e.g. "weather-lookup")'
      },
      content: {
        type: 'string',
        description: 'File content for update_handler, update_skill_md, update_progress, write_data_file'
      },
      fileName: {
        type: 'string',
        description: 'For read_file/write_data_file: relative path within the skill folder'
      },
      description: {
        type: 'string',
        description: 'For generate_prompt: What the skill should do (be detailed!)'
      },
      requirements: {
        type: 'string',
        description: 'For generate_prompt: Specific technical requirements or constraints'
      },
      examplePhrases: {
        type: 'array',
        items: { type: 'string' },
        description: 'For generate_prompt: Example things the user might say to trigger this skill'
      },
      dataNeeds: {
        type: 'string',
        description: 'For generate_prompt: What persistent data the skill needs (if any)'
      },
      existingCode: {
        type: 'string',
        description: 'For generate_prompt: Existing code to build upon or reference'
      },
      additionalInstructions: {
        type: 'string',
        description: 'For update_prompt: Extra instructions to append to the build prompt'
      },
      maxTurns: {
        type: 'number',
        description: 'For build: Max Claude Code turns (default: 30)'
      },
      lines: {
        type: 'number',
        description: 'For read_build_log: Number of log lines to return (default: 50)'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action } = input;

  try {
    switch (action) {
      // Project management
      case 'list_projects':       return listProjects();
      case 'read_project':        return readProject(input);
      case 'read_file':           return readFile(input);
      case 'write_data_file':     return writeDataFile(input);
      case 'update_handler':      return updateHandler(input);
      case 'update_skill_md':     return updateSkillMd(input);
      case 'update_progress':     return updateProgress(input);

      // Claude Code builds
      case 'generate_prompt':     return generatePrompt(input);
      case 'build':               return await build(input);
      case 'build_status':        return buildStatus();
      case 'cancel_build':        return cancelBuild();
      case 'list_builds':         return listBuilds();
      case 'read_build_log':      return readBuildLog(input);
      case 'rebuild':             return await rebuild(input);
      case 'update_prompt':       return updatePrompt(input);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error('[CodeBuilder] Error:', err.message);
    return { success: false, error: err.message };
  }
}