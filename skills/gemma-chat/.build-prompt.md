# Build Request: gemma-chat

## Overview
Integration skill for local Gemma 4 models via Ollama. Adds a !gemma command that switches to local inference instead of Claude API. Should coexist with existing model-switcher (opus/sonnet/haiku) — not replace it.

The skill should:
1. Provide a chat function that calls Ollama's OpenAI-compatible API at http://localhost:11434/v1/chat/completions
2. Support Gemma 4 model variants (e4b, 31b, etc.) with sensible defaults
3. Handle function calling / tool use (Gemma 4 supports this natively)
4. Return responses in the same format as Claude API for compatibility with existing message handlers
5. Include error handling for when Ollama isn't running
6. Add logging to track local vs cloud usage

Integration points:
- Should hook into src/discord.js message handler (check for !gemma command)
- Should work with existing tools system (file-manager, reminders, web-research, etc.)
- Should be callable from other parts of MiniClaw (like Claude Code integration later)

Technical requirements:
- Use native fetch (Node 18+)
- OpenAI-compatible chat completions format
- Support system/user/assistant message roles
- Support tools/function calling parameter
- Configurable model name (default: gemma4:e4b)
- Timeout protection (30s default)
- Graceful fallback if Ollama offline

## Skill Architecture
This is a MiniClaw Discord bot skill. Each skill is a self-contained folder with:
- `handler.js` — The main module. MUST export:
  - `toolDefinition` — An Anthropic tool_use schema object ({ name, description, input_schema })
  - `execute(input)` — An async function that receives the tool input and returns a result object
- `SKILL.md` — Documentation: what the skill does, when to use it, example trigger phrases
- `PROGRESS.md` — Development log (append-only, timestamped entries)
- `data/` — Optional persistent data directory for JSON/text files

## Technical Requirements
- ES modules (import/export, no require())
- Node.js 20+ (no browser APIs)
- The skill runs inside a Discord bot on Windows — no network calls unless explicitly needed
- `process.cwd()` returns the MiniClaw project root
- The handler is loaded via dynamic import: `import('file:///path/to/handler.js')`
- All file operations should use `path.resolve()` for Windows compatibility
- Return objects from execute() — they get JSON-serialized and sent back to Claude API as tool results
- Errors should be returned as `{ success: false, error: 'message' }`, not thrown (unless truly fatal)

## Tool Definition Pattern
```javascript
export const toolDefinition = {
  name: 'gemma_chat',
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
      return { success: false, error: `Unknown action: ${action}` };
  }
}
```

## Specific Requirements
- Must use Ollama's REST API (http://localhost:11434/v1/chat/completions)
- Should NOT replace existing model switcher
- Must support tool/function calling for agent workflows
- Should log usage stats (local vs cloud token counts)
- Error messages should guide user to install Ollama if not running
- Configuration via environment variables (OLLAMA_BASE_URL, OLLAMA_DEFAULT_MODEL)
## Example Trigger Phrases
These are the kinds of things the user might say that should activate this tool:
- "!gemma what's the weather like?"
- "!gemma write a Python function to parse JSON"
- "switch to gemma"
- "use local model"
## Data Storage Notes
Usage tracking log (track how many messages went to local vs cloud models, saved tokens/costs)

## What to Build
1. Create `handler.js` with the full working implementation
2. Create `SKILL.md` with clear documentation
3. Create `PROGRESS.md` with an initial entry
4. Create the `data/` directory if the skill needs persistent storage
5. Make sure the code actually works — no placeholder TODOs

## Important
- The tool name in toolDefinition.name MUST be: `gemma_chat`
- The skill folder is: `skills/gemma-chat/`
- Write COMPLETE, WORKING code. Not stubs. Not placeholders. Real, functional code.
- Test your logic mentally — walk through the execute() function with sample inputs.
