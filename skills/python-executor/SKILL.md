# python-executor

Executes Python scripts on the host machine and returns structured output — stdout, stderr, exit code, and execution time.

## When to use

- Test a script before presenting it to Rob
- Debug a syntax or runtime error immediately after writing code
- Verify performance improvements by running benchmarks
- Run diagnostic or utility scripts (file ops, model loading, etc.)
- Execute ML inference scripts and capture output

## Actions

| Action | Description |
|--------|-------------|
| `run` | Execute a Python script |
| `history` | View recent execution log |
| `clear_history` | Wipe the execution log |
| `detect_python` | Check which Python executable is available |

## Parameters for `run`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script_path` | string | yes | Path to the `.py` file (absolute or relative to MiniClaw root) |
| `args` | string[] | no | CLI arguments passed to the script |
| `cwd` | string | no | Working directory (defaults to script's folder) |
| `env` | object | no | Extra environment variables merged with current env |
| `timeout_seconds` | number | no | Max runtime (default 60, max 300) |

## Return value (`run`)

```json
{
  "success": true,
  "scriptPath": "C:\\path\\to\\script.py",
  "python": "python",
  "exitCode": 0,
  "timedOut": false,
  "executionTime": 1234,
  "stdout": "...",
  "stderr": "",
  "truncated": false
}
```

`truncated: true` means output exceeded 1 MB and was cut off.

## Example trigger phrases

- "Run the voice loop test script"
- "Execute test_voice_design.py and show me the output"
- "Test the ASR script in voice-test-scripts folder"
- "Run this Python file and tell me if it works"
- "Execute the optimization script with 120 second timeout"
- "Test my code in the staging directory"
- "Check what Python is installed"
- "Show me the last 10 script runs"

## Limits

- Default timeout: 60 seconds
- Max timeout: 300 seconds
- Output cap: 1 MB per stream (stdout / stderr)
- History: last 500 executions stored in `data/execution-history.json`
