# code-builder

The unified skill management and building system. Handles both project management and delegating builds to Claude Code CLI.

## Project Management Actions
These run immediately — no Claude Code needed:
- **list_projects** — Show all installed skills with status
- **read_project** — Read a skill's handler.js, SKILL.md, PROGRESS.md
- **read_file** — Read any file in a skill folder
- **write_data_file** — Write to a skill's data/ directory
- **update_handler** — Directly overwrite handler.js (for quick fixes)
- **update_skill_md** — Update documentation
- **update_progress** — Append to the dev log

## Build Actions
These delegate to Claude Code for high-quality, iterative results:
- **generate_prompt** — Create a detailed build spec (always present to Rob for review first)
- **build** — Spawn Claude Code in staging/skills/
- **build_status** — Check if a build is running
- **cancel_build** — Kill a running build
- **list_builds** — Show build history
- **read_build_log** — Read build output
- **rebuild** — Re-run with existing prompt
- **update_prompt** — Modify the build spec before rebuilding

## Typical Flow
```
Rob: "Build me a weather skill"
→ generate_prompt (create spec, show to Rob)
Rob: "Looks good, build it"
→ build (spawns Claude Code in staging/skills/weather/)
→ Claude Code builds, iterates, validates
→ "Done! Want to test in staging?"
→ process_manager restart → test → promote to live
```

## Safety
- Builds only run in `staging/skills/` — never touches live
- Only the live bot can trigger builds (staging is blocked)
- One build at a time, all logged to `staging/logs/builds/`
- Claude Code is sandboxed to safe tools (Read, Write, Edit, limited Bash)
- Rob approves before each build starts