# process-manager

Manages child processes — primarily the staging/test bot, but also handles self-restart signaling for live upgrades.

## Capabilities
- **start** — Launch the staging bot as a child process
- **stop** — Kill the staging bot process
- **restart** — Stop then start the staging bot
- **status** — Check if staging bot is running + recent in-memory logs
- **read_logs** — Read persistent log files (staging or live) from disk
- **self_restart** — Signal the watchdog to restart the live bot (for upgrades)

## Log System (v1.4)
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

## Architecture
- Staging bot is spawned via `child_process.spawn('node', ['src/index.js'], { cwd: 'staging/' })`
- Self-restart writes `.restart-signal` file to project root, then the watchdog detects it
- Watchdog backs up current live, promotes staging, and restarts
- Watchdog pipes live bot output to `logs/live.log` AND terminal (tee pattern)
