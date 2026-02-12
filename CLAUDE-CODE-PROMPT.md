# MiniClaw — Claude Code Build Prompt

## The Prompt

Paste this into Claude Code along with the `MiniClaw-Setup-Guide.md` file:

---

```
I want you to build a personal AI assistant called MiniClaw. I've attached a detailed setup guide (MiniClaw-Setup-Guide.md) that covers the full architecture, all source files, and how everything connects.

## What to build

A Node.js application that:
- Connects to Discord as a bot and responds only to my user ID
- Uses the Anthropic API with tool use (function calling) for all AI interactions
- Manages Google Calendar via OAuth2
- Has OpenClaw-style persistent memory: Markdown files as source of truth, with hybrid BM25 + vector search via SQLite (FTS5 + embeddings)
- Has context compaction with pre-compaction memory flush when approaching token limits
- Has a personality system using SOUL.md and IDENTITY.md files
- Has a modular skill builder system where the AI can create its own tools as project folders
- Uses ES modules ("type": "module" in package.json)

## Build order

Please build in this order, testing each piece works before moving on:

1. **Project scaffold** — package.json, .env.example, config.json, SOUL.md, IDENTITY.md, directory structure, .gitignore
2. **src/memory.js** — Basic Markdown memory (read/write MEMORY.md, daily logs, keyword search)
3. **src/memory-index.js** — SQLite hybrid search (FTS5 + optional vector embeddings via Voyage AI). Must gracefully degrade to keyword-only if no VOYAGE_API_KEY.
4. **src/compaction.js** — Context compaction with pre-compaction memory flush
5. **src/calendar.js** — Google Calendar integration (OAuth2 with token persistence and auto-refresh)
6. **auth-server.js** — One-time OAuth2 authorization flow script
7. **src/tools.js** — Tool registry that loads built-in tools + dynamically discovers custom skills from skills/ directory
8. **src/skill-builder.js** — The meta-tool for creating/managing skill projects
9. **src/claude.js** — Anthropic API client with tool use loop, system prompt builder (loads SOUL.md, IDENTITY.md, memory, skills), conversation history per channel, and compaction integration
10. **src/discord.js** — Discord bot with owner-only security, typing indicators, message splitting, and special commands (!model, !ping, !reindex)
11. **src/index.js** — Entry point that wires everything together

## Important implementation notes

- The guide was written iteratively and may have minor inconsistencies between sections. Use it as an **architectural reference** — follow the design patterns and data flows, but use your own judgment on exact implementation details. If something doesn't make sense, fix it.
- `better-sqlite3` requires native compilation. On Windows, this needs Python 3 and Visual Studio Build Tools (or `windows-build-tools`). If installation fails, add a note in the README about prerequisites.
- The vector search (Voyage AI embeddings) is OPTIONAL. The system MUST work perfectly with keyword-only BM25 search when VOYAGE_API_KEY is not set. Don't make embeddings a hard requirement.
- For the tool use loop in claude.js: keep looping until Claude returns a response with no tool_use blocks. Each iteration sends tool results back and gets a new response.
- The compaction system should track token estimates using a rough ~4 chars/token heuristic (not an exact tokenizer).
- Custom skills are loaded via dynamic import from skills/<name>/handler.js. Each handler.js must export `toolDefinition` (Anthropic tool schema) and `execute(input)` function.
- The skill builder's `create` action should generate working boilerplate that a developer (or the AI itself) can immediately iterate on.
- All calendar operations should use Australia/Sydney timezone.
- Discord messages have a 2000 character limit — split long responses at newline or space boundaries.
- The conversation history is in-memory (resets on restart). That's fine — the memory system on disk is what provides persistence.

## What NOT to build

- Don't install or reference OpenClaw or any ClawHub skills
- Don't create a web UI
- Don't add Docker/sandboxing
- Don't add WhatsApp/Telegram/other channels
- Don't add cron jobs or heartbeats (those can be skills later)

## Manual steps I'll do myself

These require browser interaction, so just leave clear placeholder comments and instructions:
- Creating the Discord application and bot token
- Creating the Google Cloud project and OAuth2 credentials
- Getting my Discord user ID
- Running the one-time Google OAuth2 authorization flow

## After building

- Create a README.md with setup instructions, prerequisites, and a quick-start guide
- Include a "First Conversation" section in the README suggesting what to say to the bot to test each feature (memory, calendar, skill building)
- List any npm packages that need special installation steps (like better-sqlite3 native build)
```

---

## Additional Notes for Claude Code

### Things that will likely need fixing from the guide

The guide was built iteratively and these areas may need Claude Code's judgment:

1. **tools.js imports** — The guide shows `memory-index.js` being dynamically imported inside the `executeBuiltIn` switch case for `memory_search`. Claude Code should decide whether to import it at the top of the file or keep the dynamic import (dynamic is more resilient to init-order issues).

2. **Skill builder registration** — The guide says to add `skillBuilder.toolDefinition` to `builtInTools` and a case to `executeBuiltIn`, but the skill builder is also written as if it could be loaded from the skills/ directory. Claude Code should wire it as a built-in since it's a core feature.

3. **Conversation history with tool results** — The `_flushed` property is set on the array object directly (not a clean pattern). Claude Code might want to use a Map or wrapper object for per-channel state instead.

4. **memory-index.js vector search** — The guide does a full-table scan for vector similarity (loads all embeddings into memory for cosine comparison). This is fine for personal use with <10K chunks but Claude Code could note this as a future optimisation point. OpenClaw uses sqlite-vec for accelerated vector search.

5. **Error handling** — The guide is light on error handling. Claude Code should add try/catch around all tool executions, API calls, and file operations. The bot should never crash from a single bad message.

### Windows-specific considerations

Since this runs on Rob's always-on Windows PC:

- `better-sqlite3` needs: `npm install --global windows-build-tools` (run as admin) OR have Python 3 + Visual Studio Build Tools already installed
- File paths should use `path.resolve()` everywhere (already in the guide)
- The bot should be runnable via `npm start` and ideally set up as a Windows service later (PM2 or node-windows)
- Line endings: make sure .gitattributes handles CRLF properly

### Testing suggestions for the README

```
# Test basic chat
"hello, who are you?"

# Test memory
"remember that my main Godot project uses chunk-based terrain with biome rings"
"what do you know about my Godot project?"

# Test calendar
"what's on my calendar this week?"
"add a dentist appointment next Tuesday at 2pm for 1 hour"

# Test skill building
"let's build a shopping list manager"
"add milk, bread, and eggs to my shopping list"

# Test model switching
!model claude-haiku-4-5-20251001
"what model are you using now?"
!model claude-sonnet-4-5-20250929

# Test personality
"update your identity file — pick a name and emoji you like"
```
