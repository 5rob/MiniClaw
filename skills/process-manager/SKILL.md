# process-manager

Manages child processes — primarily the staging/test bot (Test Bud), but also handles self-restart signaling for live upgrades, promotion from staging to live, and reverting staging to match live.

## Capabilities
- **start** — Launch the staging bot as a child process (Test Bud has its own memory, soul, and identity)
- **stop** — Kill the staging bot process
- **restart** — Stop then start the staging bot
- **status** — Check if staging bot is running + recent in-memory logs
- **read_logs** — Read persistent log files (staging or live) from disk
- **self_restart** — Signal the watchdog to restart the live bot (for upgrades)
- **promote** — Deploy staging code to live with backup and restart
- **revert** — Reset staging to match live (clean slate for new builds)

## Staging Architecture (v1.10)
- **Separate Identity**: Test Bud has its own `SOUL.md`, `IDENTITY.md`, and `memory/` directory
- **No Shared Memory**: Staging and live memory are completely independent
- **Same Code, Different Personality**: Both instances run the same `claude.js` — differentiation comes from the personality/memory files in each instance's directory

## Promotion Rules
When promoting staging to live, the following are copied: `src/`, `skills/`, `config.json`, `package.json`, `watchdog.js`, and any other new files/directories.

The following are **NEVER** promoted or reverted (each instance keeps its own):
- `.env` — Different Discord tokens, API keys, WAKE_CHANNEL_ID
- `SOUL.md` / `IDENTITY.md` — Live has its own personality
- `memory/` — Each instance has completely separate memory
- `logs/` — Each instance has its own logs
- `node_modules/` / `package-lock.json` — Dependencies managed separately
- `backups/` / `staging/` — Meta directories

## Revert (v1.11+)
- Copies all promotable paths from live → staging
- Same exclusion rules as promotion (instance-specific files stay untouched)
- Stops the staging bot first if running
- Use `dryRun: true` to preview what would be copied
- Use after a failed experiment to get a clean starting point

## Versioning
- Version auto-increments from the last backup: v1.9 → v1.10 → v1.11 (not v2.0)
- You can also specify a version manually: `promote` with `version: "v1.10"`
- Use `dryRun: true` to preview what would be promoted

## Log System (v1.4+)
- Staging bot output → `staging/logs/staging.log`
- Live bot output → `logs/live.log`
- Logs persist across restarts (unlike in-memory buffer)
- Auto-rotation at 512KB — keeps the tail half when exceeded
- `read_logs` accepts `target` ('staging' or 'live') and `lines` (default 50)

## Safety
- Staging bot errors are isolated — they won't crash the live bot
- Staging stdout/stderr is captured to both memory and disk
- Self-restart writes a signal file that the watchdog picks up
- Watchdog handles rollback if the new version crashes on startup
- Staging bot cannot manage processes (BOT_ROLE guard)
- Promotion creates a timestamped backup before overwriting anything

## Architecture
- Staging bot is spawned via `child_process.spawn('node', ['src/index.js'], { cwd: 'staging/' })`
- Since cwd is `staging/`, all `path.resolve()` calls naturally find staging's own files
- Self-restart writes `.restart-signal` file to project root, then the watchdog detects it
- Watchdog pipes live bot output to `logs/live.log` AND terminal (tee pattern)
