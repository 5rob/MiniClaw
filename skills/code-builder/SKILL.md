# code-builder

Delegates skill/tool building to Claude Code CLI for high-quality, iterative results.

## Purpose
Instead of the bot trying to one-shot write handler.js code through the API (which often produces incomplete or buggy results), this skill generates a detailed build prompt and hands it off to Claude Code, which can research, iterate, test, and fix its own code.

## How It Works

### Two-Phase Build Process
1. **Prompt Generation** — The bot (via API) creates a comprehensive build specification including:
   - What the skill should do
   - The MiniClaw handler.js pattern (toolDefinition + execute)
   - Technical constraints (ES modules, Windows compat, etc.)
   - Example trigger phrases
   - Data storage needs
   
2. **Claude Code Execution** — Spawns `claude -p` pointed at the staging skills directory. Claude Code:
   - Reads the build prompt and CLAUDE.md for context
   - Creates all the skill files (handler.js, SKILL.md, PROGRESS.md)
   - Can iterate on its own code, fix errors, and validate
   - Has access to read existing skills for pattern reference

### Confirmation Flow
The bot always generates the prompt first and presents it to Rob. Building only starts when explicitly requested. This gives Rob the chance to review, modify, or add requirements before spending API credits.

## Actions
- **generate_prompt** — Create the build spec (always do this first)
- **build** — Spawn Claude Code to execute the build
- **build_status** — Check if a build is running + recent log output
- **cancel_build** — Kill a running build
- **list_builds** — Show recent build history with timestamps and costs
- **read_build_log** — Read detailed logs from a build
- **rebuild** — Re-run a build using the existing prompt
- **update_prompt** — Add/modify instructions before rebuilding

## Example Conversation Flow
```
Rob: "Build me a skill that tracks my water intake"
Bot: [uses code_builder generate_prompt] "Here's the build spec I've prepared..."
Rob: "Looks good, also add a daily reset feature"
Bot: [uses code_builder update_prompt] "Updated. Ready to build?"
Rob: "Go for it"
Bot: [uses code_builder build] "Claude Code is building... ⏳"
Bot: [build completes] "Done! handler.js created, SKILL.md written. Cost: $0.04. Want me to start staging to test it?"
```

## Safety
- Builds only run in `staging/skills/` — never touches live code
- Only the live bot can trigger builds (staging bot is blocked)
- Only one build at a time
- All builds are logged to `staging/logs/builds/`
- Claude Code is sandboxed to safe tools (Read, Write, Edit, limited Bash)
- Rob must approve before build starts (unless using build_auto)

## Files Created Per Build
- `staging/skills/<name>/handler.js` — The actual skill code
- `staging/skills/<name>/SKILL.md` — Documentation
- `staging/skills/<name>/PROGRESS.md` — Build log
- `staging/skills/<name>/CLAUDE.md` — Context file for Claude Code (can be deleted after)
- `staging/skills/<name>/.build-prompt.md` — The full prompt used (for rebuilds)
- `staging/logs/builds/<name>-<timestamp>.log` — Full build output


# code-builder

The unified skill management and building system. Replaces the old `skill_builder` tool.

## What Changed
The old `skill_builder` tried to write code directly through the API — often producing incomplete or buggy results. The new `code_builder` splits the work:
- **Project management** (list, read, update) runs instantly via the bot
- **Building new skills** generates a detailed prompt and delegates to Claude Code CLI, which can research, iterate, and validate its own code

## Project Management Actions
These run immediately — no Claude Code needed:
- **list_projects** — Show all installed skills
- **read_project** — Read a skill's handler.js, SKILL.md, PROGRESS.md
- **read_file** — Read any file in a skill folder
- **write_data_file** — Write to a skill's data/ directory
- **update_handler** — Directly overwrite handler.js (for quick fixes)
- **update_skill_md** — Update documentation
- **update_progress** — Append to the dev log

## Build Actions
These delegate to Claude Code for high-quality results:
- **generate_prompt** — Create a build spec (always present to Rob first)
- **build** — Spawn Claude Code in staging/skills/
- **build_status** — Check if a build is running
- **cancel_build** — Kill a running build
- **list_builds** — Show build history
- **read_build_log** — Read build output
- **rebuild** — Re-run with existing prompt
- **update_prompt** — Modify the build spec

## Typical Flow
```
Rob: "Build me a weather skill"
→ generate_prompt (bot creates spec, shows to Rob)
Rob: "Looks good, build it"
→ build (spawns Claude Code in staging/skills/weather/)
→ Claude Code builds, iterates, validates
→ "Done! Want to test in staging?"
Rob: "Yes"
→ process_manager restart (staging bot picks up new skill)
Rob: "Works great, promote it"
→ process_manager promote
```