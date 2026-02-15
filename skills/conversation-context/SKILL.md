# Conversation Context Feature

## Overview
This is a core modification to MiniClaw that adds conversation context tracking across model switches and wake messages. It maintains a rolling buffer of recent conversation exchanges to provide continuity when:
- Switching between models (Haiku → Sonnet → Opus)
- Responding to wake messages after a restart
- Maintaining conversational flow in extended interactions

## What It Does
- **Rolling Buffer:** Keeps the last 5 messages per channel (user + assistant messages)
- **Auto-Cleanup:** Clears buffers automatically after 30 minutes of inactivity
- **Context Injection:** Injects recent conversation into every message as context
- **Per-Channel:** Each Discord channel maintains its own independent buffer
- **Wake Message Integration:** Wake messages include conversation context if available

## Implementation Details

### Files Modified
1. **src/discord.js** — Added conversation buffer management:
   - `conversationBuffers` Map for per-channel message storage
   - `addToConversationBuffer()` — Add messages with automatic trimming
   - `getConversationBuffer()` — Retrieve buffer with staleness checking
   - Buffer updates on every user message and assistant response
   - Wake message generation now includes conversation context

2. **src/claude.js** — Added context injection:
   - `chat()` function now accepts optional `conversationContext` parameter
   - Context is injected before the user's message in a clear format
   - Context format: `--- Recent Conversation Context --- ... --- End Context ---`

### Configuration
- **Buffer Size:** 5 messages (configurable via `BUFFER_SIZE` constant)
- **Timeout:** 30 minutes (configurable via `BUFFER_TIMEOUT_MS` constant)
- **Message Truncation:** Each buffered message is truncated to 500 characters max

### Token Management
The buffer is designed to be lightweight:
- Only 5 messages kept
- Messages truncated to 500 chars
- Estimated token cost: ~150-250 tokens per message (depending on content)
- Total overhead: ~750-1250 tokens for full buffer

## Usage
This feature works automatically — no commands needed. It operates transparently:

1. **Normal Conversation:**
   - User sends a message → added to buffer
   - Bot responds → response added to buffer
   - Next message includes context of last 5 messages

2. **Model Switching:**
   - Switch from `!haiku` to `!sonnet` mid-conversation
   - Sonnet sees what Haiku said in the buffer
   - Conversational continuity maintained

3. **Wake Messages:**
   - Bot restarts and sends wake message
   - If Rob replies, Haiku sees the wake message in context
   - No more "who are you?" confusion

## Example Behavior

**Before (no context):**
```
Rob: Let's build a new feature
[Bot switches to Opus and builds]
[Bot restarts]
Bot: I'm back online.
Rob: Great! How did the build go?
Bot: I'm not sure what you're referring to...
```

**After (with context):**
```
Rob: Let's build a new feature
[Bot switches to Opus and builds]
[Bot restarts]
Bot: Back online. Build log loaded.
Rob: Great! How did the build go?
Bot: The build completed successfully — all tests passed. [references buffered context]
```

## When to Use
This feature is always active. You don't need to do anything special. Just have natural conversations, and the bot will maintain context across:
- Model switches (!haiku, !sonnet, !opus commands)
- Wake messages after restarts
- Extended conversations

## Startup Seeding (v1.14.1)
As of v1.14.1, the conversation buffer is now **seeded from daily logs on startup**:
- When the bot starts, it reads today's daily log file
- Parses the last 5 message exchanges (user + assistant pairs)
- Pre-populates the conversation buffer for the wake channel
- This ensures the wake message has context even on cold start

This means wake messages can now reference recent conversation history even across restarts!

## Limitations
- Buffer only keeps 5 messages (by design, to minimize token costs)
- Messages older than 30 minutes are auto-cleared
- Context is per-channel (DMs and server channels are separate)
- Seeding only works if today's daily log exists and has parseable entries

## Trigger Phrases
N/A — This is a passive feature, not a tool. It operates automatically on all messages.
