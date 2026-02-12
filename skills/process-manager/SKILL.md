# process-manager

Manages child processes — primarily the staging/test bot, but also handles self-restart signaling for live upgrades.

## Capabilities
- **start** — Launch the staging bot as a child process
- **stop** — Kill the staging bot process
- **restart** — Stop then start the staging bot
- **status** — Check if staging bot is running
- **self-restart** — Signal the watchdog to restart the live bot (for upgrades)

## Safety
- Staging bot errors are isolated — they won't crash the live bot
- Staging stdout/stderr is captured and logged
- Self-restart writes a signal file that the watchdog picks up
- Watchdog handles rollback if the new version crashes on startup

## Architecture
- Staging bot is spawned via `child_process.spawn('node', ['src/index.js'], { cwd: 'staging/' })`
- Self-restart writes `.restart-signal` file to project root, then the watchdog detects it
- Watchdog backs up current live, promotes staging, and restarts
