# file-manager

A skill that lets me manage files within the MiniClaw project — with safety guardrails to protect the live instance.

## Purpose
Enables me to read, write, copy, move, delete, and list files so I can prototype in the staging area and eventually promote changes to live.

## Safety Rules
- **Live source is read-only**: `src/`, `skills/`, `.env`, `SOUL.md`, `IDENTITY.md`, `memory/` cannot be written to, deleted, or modified
- **Staging is full access**: `staging/` is where all building happens
- **All operations are logged** to the daily log for auditing
- **Restricted to project directory**: Cannot access anything outside the MiniClaw root
- **Promote action**: Special operation to copy staging files to live (with explicit confirmation)

## Actions
- `read` — Read a file's contents
- `write` — Write/overwrite a file
- `copy` — Copy a file or folder
- `move` — Move or rename a file or folder
- `delete` — Delete a file or folder
- `list` — List directory contents
- `promote` — Copy from staging to live (deploy)

## Usage Examples
- "Write this code to staging/src/tools.js"
- "List what's in staging/skills/"
- "Copy staging/src/claude.js to src/claude.js" (promote)
- "Delete staging/skills/broken-skill/"
