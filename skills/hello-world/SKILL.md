# hello-world Skill

A minimal hello-world skill that demonstrates the basic MiniClaw skill structure. Returns a friendly greeting with system information.

## What it does

- Returns a personalized or generic greeting
- Includes current timestamp, Node.js version, and skill name

## Actions

### `greet`
Returns a greeting message.

**Parameters:**
- `name` (optional, string) — Personalizes the greeting. If omitted, returns "Hello, World!"

**Returns:**
```json
{
  "success": true,
  "message": "Hello, World!",
  "timestamp": "2026-04-07T00:00:00.000Z",
  "node_version": "v20.x.x",
  "skill": "hello-world"
}
```

## Example Trigger Phrases
- "hello world"
- "test the hello world skill"
- "say hello"
- "greet me"
- "hello world with name John"
