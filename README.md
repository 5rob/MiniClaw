# MiniClaw

A personal AI assistant inspired by OpenClaw's architecture — running on your always-on PC, chatting via Discord, managing your Google Calendar, and growing its own skills over time.

## Features

- 🤖 **Discord Bot** — Chat with Claude via Discord (owner-only security)
- 🧠 **OpenClaw-Style Memory** — Markdown files as source of truth with hybrid BM25 + vector search
- 📅 **Google Calendar Integration** — View, create, update, and delete events
- 🔄 **Context Compaction** — Pre-compaction memory flush prevents data loss in long sessions
- 🎭 **Personality System** — `SOUL.md` and `IDENTITY.md` files that evolve over time
- 🛠️ **Skill Builder** — Meta-tool that lets the AI create its own tools collaboratively
- 🔍 **Hybrid Memory Search** — SQLite FTS5 (BM25) + optional vector embeddings via Voyage AI

## Architecture

```
MiniClaw uses Markdown files as the source of truth for memory:
- MEMORY.md — Curated long-term facts and preferences
- memory/daily/ — Running daily logs (append-only)
- SQLite index for fast hybrid search (BM25 + vector)
- Skills are isolated project folders with their own code and data
```

## Prerequisites

### Required

- **Node.js 20+** — [Download here](https://nodejs.org)
- **Python 3 + Visual Studio Build Tools** (for better-sqlite3 native compilation on Windows)
  - Install with: `npm install --global windows-build-tools` (run as administrator)
  - OR have Python 3 and VS Build Tools already installed

### API Keys Needed

1. **Anthropic API Key** — [Get one here](https://console.anthropic.com/)
2. **Discord Bot Token** — See Discord setup below
3. **Google Calendar Credentials** — See Google setup below
4. **Voyage AI API Key** (optional) — [Get one here](https://www.voyageai.com) for vector embeddings

## Installation

### 1. Clone and Install Dependencies

```bash
cd C:\Users\Rob\Desktop\MiniClaw
npm install
```

> **Note**: `better-sqlite3` requires native compilation. If the install fails with build errors, you need to install Windows build tools first:
>
> ```bash
> npm install --global windows-build-tools
> ```
>
> Run this in an **administrator** terminal, then try `npm install` again.

### 2. Set Up Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
copy .env.example .env
```

Edit `.env` with your API keys (see setup guides below).

## Discord Bot Setup

### Step 1: Create Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **"New Application"** — name it "MiniClaw" (or whatever you want)
3. Go to the **Bot** tab → Click **"Reset Token"** → Copy the token
4. Paste the token as `DISCORD_TOKEN` in your `.env` file

### Step 2: Configure Bot Permissions

1. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent** (required to read messages)
   - ✅ **Server Members Intent** (optional but useful)
2. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`
3. Copy the generated URL and open it in your browser to invite the bot to your server

### Step 3: Get Your Discord User ID

1. In Discord, go to **Settings → Advanced → Developer Mode** (turn it on)
2. Right-click your username anywhere → **Copy User ID**
3. Paste it as `DISCORD_OWNER_ID` in your `.env`

> **Security**: The bot will ONLY respond to messages from this user ID. Everyone else is ignored.

### Step 4: Create a Private Server

1. Create a new Discord server (just for you and the bot)
2. Invite the bot using the OAuth2 URL from Step 2

## Google Calendar Setup

### Step 1: Create Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Click the project dropdown → **"New Project"**
3. Name: "MiniClaw Calendar" → Click **Create**
4. Make sure the new project is selected

### Step 2: Enable Calendar API

1. Go to **APIs & Services → Library**
2. Search for "Google Calendar API" → Click it → Click **"Enable"**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **"External"** user type → Click **Create**
3. Fill in:
   - App name: MiniClaw
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue** through Scopes (skip for now)
5. On **Test users** page, click **"Add Users"** → add your Gmail address
6. Click **Save and Continue**

> **Note**: The app stays in "Testing" mode (unpublished). This is fine for personal use.

### Step 4: Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **"Create Credentials" → "OAuth client ID"**
3. Application type: **"Web application"**
4. Name: "MiniClaw"
5. Under **Authorized redirect URIs**, add: `http://localhost:3000/oauth2callback`
6. Click **Create**
7. Copy **Client ID** and **Client Secret** → paste into your `.env`

### Step 5: Run Authorization Flow

```bash
npm run auth
```

1. Open the URL it prints in your browser
2. Sign in with your Google account
3. Click **Continue** when you see "This app isn't verified" (it's your own app)
4. Grant calendar access
5. You'll see "Success!" — `google-tokens.json` is now saved

> **Important**: Add `google-tokens.json` to `.gitignore` (already done)

## Running MiniClaw

```bash
npm start
```

You should see:

```
=== MiniClaw Starting ===
[Calendar] Initialized with saved tokens
[MemoryIndex] SQLite hybrid search initialized
[Discord] Logged in as MiniClaw#1234
=== MiniClaw Ready ===
```

## First Conversation

Once the bot is running, try these in your Discord server:

### Basic Chat
```
hello, who are you?
```

### Memory System
```
remember that my main Godot project uses chunk-based terrain with biome rings
```
```
what do you know about my Godot project?
```

### Calendar
```
what's on my calendar this week?
```
```
add a dentist appointment next Tuesday at 2pm for 1 hour
```

### Skill Building
```
let's build a shopping list manager
```
```
add milk, bread, and eggs to my shopping list
```

### Model Switching
```
!model claude-haiku-4-5-20251001
```
```
what model are you using now?
```
```
!model claude-sonnet-4-5-20250929
```

### Personality
```
update your identity file — pick a name and emoji you like
```

## Available Commands

| Command | Description |
|---------|-------------|
| `!model` | Show current model |
| `!model <model-id>` | Switch to a different model |
| `!ping` | Check bot latency |
| `!reindex` | Rebuild memory search index |
| `!clear` | Clear conversation history for this channel |
| `!help` | Show help message |

### Available Models

- `claude-sonnet-4-5-20250929` — Sonnet 4.5 (balanced, default)
- `claude-haiku-4-5-20251001` — Haiku 4.5 (fast & cheap)
- `claude-opus-4-5-20250929` — Opus 4.5 (most capable)

## How It Works

### Memory System

MiniClaw uses a two-layer memory system inspired by OpenClaw:

1. **MEMORY.md** — Curated long-term facts, preferences, decisions
2. **Daily Logs** (`memory/daily/YYYY-MM-DD.md`) — Running notes, append-only

**Hybrid Search** combines:
- **BM25 (keyword)** via SQLite FTS5 — finds exact terms
- **Vector search** via Voyage AI embeddings — finds semantic matches
- **Reciprocal Rank Fusion (RRF)** — merges results from both methods

**Graceful degradation**: If Voyage AI is unavailable (no API key or error), falls back to keyword-only search.

### Context Compaction

Long conversations trigger automatic context management:

1. **Soft threshold** (~176K tokens) — Silent memory flush
   - Claude writes important context to disk before compaction
   - User sees nothing (transparent checkpoint)

2. **Hard threshold** (~180K tokens) — Compaction
   - Older messages summarized by fallback model (cheaper)
   - Summary + recent messages = new conversation history
   - Memory index re-indexed

This means compaction becomes a *checkpoint*, not data loss.

### Skill Building

The `skill_builder` tool lets you collaboratively build new tools with the AI:

1. AI creates project scaffold in `skills/<name>/`
2. Writes `SKILL.md` (instructions), `handler.js` (code), `PROGRESS.md` (dev log)
3. Skill auto-loads on next restart
4. Can iterate on skills across sessions (read/update project files)

Each skill is an isolated folder with:
- `SKILL.md` — Instructions for when/how to use this skill
- `handler.js` — Executable logic (exports `toolDefinition` + `execute`)
- `PROGRESS.md` — Development notes (tracked across sessions)
- `data/` — Persistent data for this skill (e.g., JSON files)

## Configuration

Edit `config.json` to adjust:

- **Model settings** — Primary/fallback models, token limits
- **Memory settings** — Days of logs to load, search result count
- **Compaction settings** — Token thresholds, memory flush behavior
- **Embedding settings** — Vector model, chunk size/overlap

## Troubleshooting

### "better-sqlite3" install fails

You need Windows build tools:

```bash
npm install --global windows-build-tools
```

Run as **administrator**, then retry `npm install`.

### "Calendar not initialized"

Run the authorization flow:

```bash
npm run auth
```

Make sure you complete the browser flow and see "Success!"

### "Vector search failed, using keyword-only"

This is expected if you don't have a `VOYAGE_API_KEY`. The system gracefully degrades to keyword-only BM25 search, which works fine for personal use.

To enable vector search, get a free API key from [voyageai.com](https://www.voyageai.com) and add it to `.env`.

### Bot doesn't respond to messages

1. Check that `DISCORD_OWNER_ID` in `.env` matches your Discord user ID
2. Make sure **Message Content Intent** is enabled in Discord Developer Portal
3. Check the console for error messages

### "Module not found" errors

Make sure you have `"type": "module"` in `package.json` (should be there by default).

## Security Notes

✅ **What's secure:**
- Bot only responds to your Discord user ID (owner-only)
- API keys in `.env` (never committed)
- Google tokens stored locally (never committed)

⚠️ **What you should do:**
- Keep your Discord server private (don't invite others)
- Set an Anthropic spending limit in your dashboard
- Review custom skill code before running it (has full file system access)
- Never commit `.env` or `google-tokens.json` to git

## Growing Your Assistant

### Personality Evolution

Your AI's personality lives in `SOUL.md` and `IDENTITY.md`. During your first conversation, ask it to fill in its identity. Over time, you can ask it to update these files — it will always tell you when it does.

### Going Fully Offline

The vector search currently uses Voyage AI's cloud API. To go fully offline, swap in local embeddings using `@xenova/transformers`:

```bash
npm install @xenova/transformers
```

This would run a GGUF model locally (~1GB download on first use). Ask the AI: "let's upgrade memory embeddings to use local transformers."

### Ideas for First Skills

- **Shopping list manager** — Add/remove/view items
- **Daily briefing** — Morning summary sent via Discord
- **Reminder system** — Set reminders, check on timer
- **Project notes** — Per-project context files
- **URL bookmarks** — Save and categorize links
- **Expense tracker** — Log purchases, weekly summaries

## Project Structure

```
MiniClaw/
├── .env                          # API keys (never commit)
├── config.json                   # Model, memory, compaction settings
├── package.json
├── SOUL.md                       # Personality, boundaries, tone
├── IDENTITY.md                   # Name, creature type, vibe, emoji
├── src/
│   ├── index.js                  # Entry point
│   ├── claude.js                 # Anthropic API client + tool loop
│   ├── discord.js                # Discord bot
│   ├── memory.js                 # Markdown memory (read/write/search)
│   ├── memory-index.js           # Hybrid BM25 + vector search
│   ├── compaction.js             # Context compaction + memory flush
│   ├── calendar.js               # Google Calendar OAuth2 + API
│   ├── tools.js                  # Tool registry (built-in + custom)
│   └── skill-builder.js          # Meta-tool for creating skills
├── memory/
│   ├── MEMORY.md                 # Curated long-term memory
│   └── daily/                    # Daily logs (one per day)
├── data/
│   └── memory-index.sqlite       # SQLite DB for hybrid search
├── skills/                       # Custom skill projects
│   └── shopping-list/            # Example skill
│       ├── SKILL.md
│       ├── handler.js
│       ├── PROGRESS.md
│       └── data/
├── google-tokens.json            # OAuth2 tokens (auto-generated)
└── auth-server.js                # One-time OAuth2 setup script
```

## License

MIT

---

**Built with inspiration from [OpenClaw](https://github.com/chand1012/OpenClaw)**

Start simple, build skills as you need them, and it'll grow into exactly the assistant you want.
