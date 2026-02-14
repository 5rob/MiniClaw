# git-push

Automates git operations for the MiniClaw project — check status, view diffs, and push to GitHub.

## Purpose
Instead of Rob manually opening GitHub Desktop, I can push live code changes directly. Only works from the live bot (staging is blocked from pushing experimental code).

## Actions
- **status** — Show what files have changed (git status)
- **diff** — Detailed summary of changes (staged, unstaged, untracked)
- **push** — Stage all changes, commit with auto-generated message, and push to GitHub

## Commit Messages
- Auto-generated based on what changed: areas affected (core, skills, config, etc.) and change counts
- Can be overridden with a custom `message` parameter

## Safety
- **Staging blocked** — Test Bud cannot push experimental code
- **Relies on .gitignore** — sensitive files (.env, memory/, etc.) are already excluded
- **Auth** — Uses PAT token configured in git remote URL

## Usage Examples
- "Push to GitHub" → runs push with auto-generated commit message
- "Git status" → shows what's changed
- "Push with message 'v1.11 — git push skill'" → custom commit message
