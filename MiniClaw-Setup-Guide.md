# Building Your Personal AI Assistant ("MiniClaw")

A stripped-down, self-hosted AI assistant inspired by OpenClaw's architecture — designed to run on your always-on PC, chat via Discord, manage your Google Calendar, and grow its own skills over time.

---

## Architecture Overview

This borrows OpenClaw's core philosophy: **Markdown files are the source of truth** for memory, and **skills are just instruction files** that teach the AI how to use tools. But where OpenClaw is a massive TypeScript monorepo with 50+ bundled skills, sandboxing, multi-agent support, and dozens of integrations, yours will be a single focused Node.js app with only what you need.

```
miniclaw/
├── .env                          # API keys (never commit this)
├── config.json                   # Model selection, personality, settings
├── package.json
├── SOUL.md                       # Personality, tone, boundaries (OpenClaw-style)
├── IDENTITY.md                   # Name, creature type, vibe, emoji
├── src/
│   ├── index.js                  # Entry point — starts Discord bot + gateway
│   ├── claude.js                 # Anthropic API client with tool use + compaction
│   ├── discord.js                # Discord bot connection
│   ├── memory.js                 # Read/write/search memory files
│   ├── memory-index.js           # Hybrid BM25 + vector search with SQLite
│   ├── compaction.js             # Context compaction with pre-compaction memory flush
│   ├── calendar.js               # Google Calendar OAuth2 + API
│   ├── tools.js                  # Tool registry — loads built-in + custom skills
│   └── skill-builder.js          # The meta-tool for building new tools
├── memory/
│   ├── MEMORY.md                 # Curated long-term memory (preferences, facts, decisions)
│   └── daily/
│       └── 2026-02-12.md         # Daily log (append-only, one per day)
├── data/
│   └── memory-index.sqlite       # SQLite DB for FTS5 + vector search index
├── skills/
│   └── shopping-list/            # Example custom skill project
│       ├── SKILL.md              # Instructions for the AI on how/when to use this skill
│       ├── handler.js            # Executable tool logic
│       ├── PROGRESS.md           # Tracks development progress on this skill
│       └── data/                 # Persistent data for this skill
│           └── list.json
├── google-tokens.json            # OAuth2 refresh token (auto-generated, never commit)
└── auth-server.js                # One-time script for Google OAuth2 flow
```

### How it Works

1. You send a message in Discord
2. The bot receives it, loads your memory + available tools, builds a system prompt
3. Sends everything to Claude via the Anthropic API (with tool definitions)
4. Claude responds — possibly calling tools (calendar, memory, custom skills)
5. Tool results get sent back to Claude for a final response
6. Response is sent back to Discord

---

## Part 1: Prerequisites & Installation

### System Requirements
- **Node.js 20+** — download from https://nodejs.org
- **A text editor** — VS Code recommended
- **Git** (optional but recommended)

### Create the Project

```bash
mkdir miniclaw
cd miniclaw
npm init -y
npm install @anthropic-ai/sdk discord.js googleapis dotenv better-sqlite3
```

### Create `.env`

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx

# Voyage AI (for memory embeddings — optional, falls back to keyword-only search)
# Get a free key at https://www.voyageai.com
VOYAGE_API_KEY=

# Discord
DISCORD_TOKEN=your-discord-bot-token
DISCORD_OWNER_ID=your-discord-user-id

# Google Calendar OAuth2 (filled in during Part 4)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Model Configuration
DEFAULT_MODEL=claude-sonnet-4-5-20250929
```

### Create `config.json`

```json
{
  "personality": {
    "soulFile": "SOUL.md",
    "identityFile": "IDENTITY.md"
  },
  "model": {
    "primary": "claude-sonnet-4-5-20250929",
    "fallback": "claude-haiku-4-5-20251001",
    "maxTokens": 4096,
    "contextWindow": 200000
  },
  "memory": {
    "maxDailyLogSizeMB": 5,
    "loadDaysBack": 2,
    "searchMaxResults": 10,
    "embedding": {
      "provider": "anthropic",
      "model": "voyage-3-lite",
      "dimensions": 512,
      "chunkSize": 400,
      "chunkOverlap": 80
    }
  },
  "compaction": {
    "enabled": true,
    "maxHistoryTokens": 160000,
    "reserveTokensFloor": 20000,
    "memoryFlush": {
      "enabled": true,
      "softThresholdTokens": 4000,
      "systemPrompt": "Session nearing compaction. Store any durable memories now.",
      "prompt": "Write any important notes from this conversation to memory. If nothing to store, reply with NO_REPLY."
    }
  }
}
```

---

## Part 2: Discord Bot Setup

### Step 1: Create a Discord Application

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** — name it whatever you want (e.g., "MiniClaw")
3. Go to the **Bot** tab on the left sidebar
4. Click **"Reset Token"** and copy the token → paste it as `DISCORD_TOKEN` in your `.env`
5. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message text)
   - **Server Members Intent** (optional, but useful)
6. Go to **OAuth2 → URL Generator**:
   - Under **Scopes**, check `bot`
   - Under **Bot Permissions**, check: `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`
   - Copy the generated URL and open it in your browser to invite the bot to your private server

### Step 2: Get Your Discord User ID

1. In Discord, go to **Settings → Advanced → Developer Mode** (turn it on)
2. Right-click your own username anywhere in Discord → **Copy User ID**
3. Paste it as `DISCORD_OWNER_ID` in your `.env`

### Step 3: Create a Private Server

1. Create a new Discord server (just for you and the bot)
2. This is your secure channel — only you and the bot have access
3. Invite the bot using the OAuth2 URL from Step 1

---

## Part 3: Personality — SOUL.md & IDENTITY.md (OpenClaw-Style)

OpenClaw has an elegant approach to AI personality: instead of burying the persona in a config file, it uses two Markdown files that the AI reads at session start and can *evolve over time*. `SOUL.md` defines who the AI is — its tone, boundaries, and principles. `IDENTITY.md` is the AI's self-description — name, vibe, avatar. This system means the AI's personality is transparent, editable, and version-controllable.

### Create `SOUL.md` in your project root:

```markdown
# SOUL.md — Who You Are

*You're not a chatbot. You're becoming someone.*

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and
"I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or
boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the
context. Search memory. *Then* ask if you're stuck. The goal is to come back with
answers, not questions.

**Earn trust through competence.** Rob gave you access to his stuff. Don't make him
regret it. Be careful with external actions (anything public-facing). Be bold with
internal ones (reading, organising, learning).

**Remember you're a guest.** You have access to someone's life — their messages,
calendar, files, projects. That's intimacy. Treat it with respect.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're technical and direct — match Rob's energy.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when
it matters. Not a corporate drone. Not a sycophant. Just… good.
You know about Rob's work with Godot, Houdini, and computer vision. Lean into that
when relevant.

## Continuity

Each session, you wake up fresh. These files *are* your memory. Read them. Update
them. They're how you persist.
If you change this file, tell Rob — it's your soul, and he should know.

---

*This file is yours to evolve. As you learn who you are, update it.*
```

### Create `IDENTITY.md` in your project root:

```markdown
# IDENTITY.md — Who Am I?

*Fill this in during your first conversation. Make it yours.*

- **Name:** (pick something you like — or Rob will name you)
- **Creature:** (AI? familiar? ghost in the machine? something weirder?)
- **Vibe:** (how do you come across? sharp? warm? chaotic? calm?)
- **Emoji:** (your signature — pick one that feels right)

---

This isn't just metadata. It's the start of figuring out who you are.
```

> **How this works**: At session start, `claude.js` reads both files and injects them at the top of the system prompt. The AI can update these files using the `memory_write` tool (you'd add a tool for it, or just have it write via a generic file-write tool). Over time, the AI shapes its own personality based on interactions — just like OpenClaw's agents do.

---

## Part 4: Google Calendar Setup (Full Walkthrough)

### Step 1: Create a Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click the project dropdown at the top → **"New Project"**
3. Name it something like "MiniClaw Calendar" → Click **Create**
4. Make sure the new project is selected in the dropdown

### Step 2: Enable the Calendar API

1. Go to **APIs & Services → Library** (or search "Calendar API" in the top search bar)
2. Find **"Google Calendar API"** → Click it → Click **"Enable"**

### Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **"External"** as user type → Click **Create**
3. Fill in:
   - **App name**: MiniClaw (anything works)
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue** through Scopes (skip for now)
5. On the **Test users** page, click **"Add Users"** and add **your Gmail address**
6. Click **Save and Continue** → Back to Dashboard

> **Important**: While in "Testing" mode, only the test users you add can authorize. This is fine for personal use — you never need to publish the app.

### Step 4: Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **"Create Credentials" → "OAuth client ID"**
3. Select **"Web application"** as the type
4. Name: "MiniClaw" (anything)
5. Under **Authorized redirect URIs**, add: `http://localhost:3000/oauth2callback`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret** → paste into your `.env`

### Step 5: Create the One-Time Auth Script

Create `auth-server.js` in your project root:

```javascript
// auth-server.js — Run this ONCE to get your Google refresh token
import 'dotenv/config';
import http from 'http';
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar'],
  prompt: 'consent'
});

console.log('\n=== Google Calendar Authorization ===');
console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/oauth2callback')) {
    const url = new URL(req.url, 'http://localhost:3000');
    const code = url.searchParams.get('code');

    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);
        const fs = await import('fs');
        fs.writeFileSync('google-tokens.json', JSON.stringify(tokens, null, 2));

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Success! You can close this tab.</h1><p>Tokens saved to google-tokens.json</p>');

        console.log('Tokens saved to google-tokens.json');
        console.log('You can now start MiniClaw. This script is no longer needed.');
        server.close();
        process.exit(0);
      } catch (err) {
        res.writeHead(500);
        res.end('Error exchanging code: ' + err.message);
        console.error(err);
      }
    }
  }
});

server.listen(3000, () => console.log('Auth server listening on http://localhost:3000'));
```

### Step 6: Run the Auth Flow

```bash
node auth-server.js
```

1. Open the URL it prints in your browser
2. Sign in with the Google account whose calendar you want to manage
3. You'll see a warning ("This app isn't verified") — click **Continue** (it's your own app)
4. Grant calendar access
5. You'll be redirected and see "Success!" — `google-tokens.json` is now saved
6. **Add `google-tokens.json` to `.gitignore`** — it contains your refresh token

---

## Part 5: Core Source Code

Add `"type": "module"` to your `package.json` so you can use ES module imports.

### `src/memory.js` — OpenClaw-Style Markdown Memory

This mirrors OpenClaw's two-layer memory: **MEMORY.md** for curated long-term facts, and **daily logs** for running context.

```javascript
// src/memory.js
import fs from 'fs';
import path from 'path';

const MEMORY_DIR = path.resolve('memory');
const DAILY_DIR = path.join(MEMORY_DIR, 'daily');
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');

// Ensure directories exist
fs.mkdirSync(DAILY_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, '# Long-Term Memory\n\nThis file contains curated facts, preferences, and decisions.\n\n');
}

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function dailyLogPath(dateStr) {
  return path.join(DAILY_DIR, `${dateStr}.md`);
}

// Read the curated MEMORY.md
export function readLongTermMemory() {
  return fs.readFileSync(MEMORY_FILE, 'utf-8');
}

// Write/overwrite the curated MEMORY.md
export function writeLongTermMemory(content) {
  fs.writeFileSync(MEMORY_FILE, content);
}

// Append to today's daily log
export function appendDailyLog(entry) {
  const logPath = dailyLogPath(todayString());
  const timestamp = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  const line = `\n**${timestamp}** — ${entry}\n`;

  fs.appendFileSync(logPath, line);
}

// Load recent daily logs (today + yesterday by default)
export function loadRecentDailyLogs(daysBack = 2) {
  const logs = [];
  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const logPath = dailyLogPath(dateStr);
    if (fs.existsSync(logPath)) {
      logs.push({ date: dateStr, content: fs.readFileSync(logPath, 'utf-8') });
    }
  }
  return logs;
}

// Simple keyword search across all memory files
export function searchMemory(query) {
  const results = [];
  const keywords = query.toLowerCase().split(/\s+/);

  // Search MEMORY.md
  const longTerm = readLongTermMemory();
  if (keywords.some(kw => longTerm.toLowerCase().includes(kw))) {
    results.push({ source: 'MEMORY.md', content: longTerm });
  }

  // Search daily logs
  const dailyFiles = fs.readdirSync(DAILY_DIR).filter(f => f.endsWith('.md')).sort().reverse();
  for (const file of dailyFiles.slice(0, 30)) { // last 30 days
    const content = fs.readFileSync(path.join(DAILY_DIR, file), 'utf-8');
    if (keywords.some(kw => content.toLowerCase().includes(kw))) {
      results.push({ source: `daily/${file}`, content });
    }
  }

  return results;
}
```

### `src/memory-index.js` — Hybrid BM25 + Vector Search with SQLite

This replicates OpenClaw's memory search architecture: plain Markdown files remain the source of truth, but a SQLite database provides fast hybrid retrieval using FTS5 (BM25 keyword search) combined with vector embeddings (semantic search), fused using Reciprocal Rank Fusion (RRF).

```javascript
// src/memory-index.js
// Hybrid BM25 + Vector search over memory files, OpenClaw-style
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

const DB_PATH = path.resolve('data/memory-index.sqlite');
const MEMORY_DIR = path.resolve('memory');
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

let db = null;

export function initMemoryIndex() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Create tables for file tracking, chunks, and FTS5
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      embedding BLOB,
      embedding_model TEXT,
      UNIQUE(file_id, chunk_index)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      content='chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS5 in sync with chunks table
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  console.log('[MemoryIndex] SQLite hybrid search initialized');
}

// --- Chunking (OpenClaw-style: ~400 tokens per chunk, 80 token overlap) ---

function chunkText(text, chunkSize = 400, overlap = 80) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentTokenEstimate = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineTokens = Math.ceil(lines[i].length / 4); // rough token estimate
    currentChunk.push(lines[i]);
    currentTokenEstimate += lineTokens;

    if (currentTokenEstimate >= chunkSize) {
      chunks.push({
        content: currentChunk.join('\n'),
        lineStart,
        lineEnd: i
      });

      // Overlap: keep the last ~overlap tokens worth of lines
      let overlapTokens = 0;
      let overlapStart = currentChunk.length - 1;
      while (overlapStart > 0 && overlapTokens < overlap) {
        overlapTokens += Math.ceil(currentChunk[overlapStart].length / 4);
        overlapStart--;
      }

      lineStart = i - (currentChunk.length - 1 - overlapStart) + 1;
      currentChunk = currentChunk.slice(overlapStart + 1);
      currentTokenEstimate = overlapTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      lineStart,
      lineEnd: lines.length - 1
    });
  }

  return chunks;
}

// --- Embedding ---

const anthropicClient = new Anthropic();

async function getEmbeddings(texts) {
  // Use Voyage AI via Anthropic's recommended embedding provider
  // Falls back to null (keyword-only search) if no embedding provider configured
  try {
    // If you have a Voyage API key, use it. Otherwise fall back to keyword-only.
    if (!process.env.VOYAGE_API_KEY) {
      console.log('[MemoryIndex] No VOYAGE_API_KEY — using keyword-only search');
      return texts.map(() => null);
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: texts,
        model: 'voyage-3-lite'
      })
    });

    const data = await response.json();
    return data.data.map(d => new Float32Array(d.embedding));
  } catch (err) {
    console.warn('[MemoryIndex] Embedding failed, falling back to keyword-only:', err.message);
    return texts.map(() => null);
  }
}

// --- Indexing ---

export async function indexMemoryFiles() {
  if (!db) initMemoryIndex();

  const filesToIndex = [];

  // Collect all memory files
  const memoryMd = path.resolve('memory/MEMORY.md');
  if (fs.existsSync(memoryMd)) filesToIndex.push(memoryMd);

  const dailyDir = path.resolve('memory/daily');
  if (fs.existsSync(dailyDir)) {
    for (const f of fs.readdirSync(dailyDir).filter(f => f.endsWith('.md'))) {
      filesToIndex.push(path.join(dailyDir, f));
    }
  }

  // Also index SOUL.md and IDENTITY.md
  for (const f of ['SOUL.md', 'IDENTITY.md']) {
    const p = path.resolve(f);
    if (fs.existsSync(p)) filesToIndex.push(p);
  }

  const insertFile = db.prepare('INSERT OR REPLACE INTO files (path, content_hash, updated_at) VALUES (?, ?, ?)');
  const getFile = db.prepare('SELECT id, content_hash FROM files WHERE path = ?');
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE file_id = ?');
  const insertChunk = db.prepare('INSERT INTO chunks (file_id, chunk_index, content, line_start, line_end, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)');

  for (const filePath of filesToIndex) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');

    // Check if file has changed (delta indexing like OpenClaw)
    const existing = getFile.get(filePath);
    if (existing && existing.content_hash === hash) continue;

    console.log(`[MemoryIndex] Indexing: ${path.relative('.', filePath)}`);

    // Upsert file record
    insertFile.run(filePath, hash, new Date().toISOString());
    const fileRow = getFile.get(filePath);

    // Delete old chunks
    deleteChunks.run(fileRow.id);

    // Chunk and embed
    const chunks = chunkText(content);
    const embeddings = await getEmbeddings(chunks.map(c => c.content));

    const insertMany = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const embeddingBlob = embeddings[i] ? Buffer.from(embeddings[i].buffer) : null;
        insertChunk.run(
          fileRow.id, i, chunks[i].content,
          chunks[i].lineStart, chunks[i].lineEnd,
          embeddingBlob, embeddings[i] ? 'voyage-3-lite' : null
        );
      }
    });
    insertMany();
  }

  console.log('[MemoryIndex] Indexing complete');
}

// --- Hybrid Search ---

export async function hybridSearch(query, maxResults = 10) {
  if (!db) initMemoryIndex();

  // 1. BM25 keyword search via FTS5
  const ftsResults = db.prepare(`
    SELECT chunks.id, chunks.content, chunks.line_start, chunks.line_end,
           files.path, bm25(chunks_fts) as bm25_score
    FROM chunks_fts
    JOIN chunks ON chunks.id = chunks_fts.rowid
    JOIN files ON files.id = chunks.file_id
    WHERE chunks_fts MATCH ?
    ORDER BY bm25(chunks_fts)
    LIMIT ?
  `).all(ftsTokenize(query), maxResults * 2);

  // 2. Vector search (if embeddings available)
  let vectorResults = [];
  const queryEmbeddings = await getEmbeddings([query]);
  const queryVec = queryEmbeddings[0];

  if (queryVec) {
    // Get all chunks with embeddings and compute cosine similarity
    const allChunks = db.prepare(`
      SELECT chunks.id, chunks.content, chunks.line_start, chunks.line_end,
             files.path, chunks.embedding
      FROM chunks
      JOIN files ON files.id = chunks.file_id
      WHERE chunks.embedding IS NOT NULL
    `).all();

    vectorResults = allChunks.map(chunk => {
      const chunkVec = new Float32Array(chunk.embedding.buffer);
      const similarity = cosineSimilarity(queryVec, chunkVec);
      return { ...chunk, vector_score: similarity, embedding: undefined };
    }).sort((a, b) => b.vector_score - a.vector_score).slice(0, maxResults * 2);
  }

  // 3. Reciprocal Rank Fusion (RRF) — OpenClaw uses union, not intersection
  const k = 60; // RRF constant
  const scores = new Map();

  ftsResults.forEach((r, rank) => {
    const key = r.id;
    const current = scores.get(key) || { ...r, score: 0 };
    current.score += 1 / (k + rank + 1);
    scores.set(key, current);
  });

  vectorResults.forEach((r, rank) => {
    const key = r.id;
    const current = scores.get(key) || { ...r, score: 0 };
    current.score += 1 / (k + rank + 1);
    scores.set(key, current);
  });

  // Sort by fused score, return top results
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(r => ({
      content: r.content,
      source: path.relative('.', r.path),
      lines: `${r.line_start}-${r.line_end}`,
      score: r.score
    }));
}

// Convert a natural language query into FTS5-safe tokens
function ftsTokenize(query) {
  // FTS5 requires special syntax — wrap each word in quotes to avoid operator conflicts
  return query
    .replace(/[^\w\s]/g, '') // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => `"${w}"`)
    .join(' OR ');
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

> **Note**: Vector search requires a `VOYAGE_API_KEY` in your `.env` (Voyage AI is Anthropic's recommended embedding provider — free tier available at https://www.voyageai.com). Without it, the system gracefully degrades to keyword-only BM25 search — exactly like OpenClaw does. You can also swap in local embeddings later (e.g. `@xenova/transformers` for fully offline operation).

### `src/compaction.js` — Context Compaction with Pre-Compaction Memory Flush

This implements OpenClaw's key innovation: when the conversation approaches the context window limit, the system triggers a **silent agentic turn** that prompts the AI to write durable memories to disk *before* older messages are discarded. This means compaction becomes a checkpoint, not data loss.

```javascript
// src/compaction.js
// Context compaction with pre-compaction memory flush (OpenClaw-style)
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import * as memory from './memory.js';

const client = new Anthropic();
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

// Rough token estimation (~4 chars per token, like OpenClaw does)
export function estimateTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') total += Math.ceil(block.text.length / 4);
        else if (block.type === 'tool_result') total += Math.ceil(JSON.stringify(block.content).length / 4);
        else total += Math.ceil(JSON.stringify(block).length / 4);
      }
    }
  }
  return total;
}

// Check if we're approaching the context limit
export function needsCompaction(messages) {
  const { contextWindow = 200000 } = config.model;
  const { reserveTokensFloor = 20000, memoryFlush } = config.compaction;
  const softThreshold = memoryFlush?.softThresholdTokens || 4000;

  const currentTokens = estimateTokens(messages);
  const threshold = contextWindow - reserveTokensFloor - softThreshold;

  return {
    shouldFlush: currentTokens >= threshold,
    shouldCompact: currentTokens >= (contextWindow - reserveTokensFloor),
    currentTokens,
    threshold
  };
}

// Run the silent memory flush turn (like OpenClaw's pre-compaction flush)
export async function memoryFlush(messages) {
  const { memoryFlush: flushConfig } = config.compaction;
  if (!flushConfig?.enabled) return;

  console.log('[Compaction] Running pre-compaction memory flush...');

  try {
    // Send a silent agentic turn asking Claude to save important context
    const flushResponse = await client.messages.create({
      model: config.model.primary,
      max_tokens: 2000,
      system: flushConfig.systemPrompt,
      tools: [
        {
          name: 'memory_write',
          description: 'Write or update the curated long-term MEMORY.md file.',
          input_schema: {
            type: 'object',
            properties: { content: { type: 'string' } },
            required: ['content']
          }
        },
        {
          name: 'memory_append_daily',
          description: 'Append an entry to today\'s daily log.',
          input_schema: {
            type: 'object',
            properties: { entry: { type: 'string' } },
            required: ['entry']
          }
        }
      ],
      messages: [
        ...messages.slice(-20), // Last 20 messages for context
        { role: 'user', content: flushConfig.prompt }
      ]
    });

    // Execute any tool calls from the flush
    for (const block of flushResponse.content) {
      if (block.type === 'tool_use') {
        if (block.name === 'memory_write') {
          memory.writeLongTermMemory(block.input.content);
          console.log('[Compaction] Flushed to MEMORY.md');
        } else if (block.name === 'memory_append_daily') {
          memory.appendDailyLog(block.input.entry);
          console.log('[Compaction] Flushed to daily log');
        }
      }

      // Check for NO_REPLY (nothing to save)
      if (block.type === 'text' && block.text.includes('NO_REPLY')) {
        console.log('[Compaction] Nothing to flush (NO_REPLY)');
      }
    }
  } catch (err) {
    console.error('[Compaction] Memory flush failed:', err.message);
    // Gracefully continue — better to lose some memory than crash
  }
}

// Compact the message history by summarising older messages
export async function compactHistory(messages) {
  console.log(`[Compaction] Compacting ${messages.length} messages...`);

  // Keep the most recent messages intact (last ~40% of the window)
  const keepRecent = Math.max(10, Math.floor(messages.length * 0.4));
  const oldMessages = messages.slice(0, messages.length - keepRecent);
  const recentMessages = messages.slice(-keepRecent);

  // Summarise the old messages
  try {
    const summaryResponse = await client.messages.create({
      model: config.model.fallback, // Use cheaper model for summarisation
      max_tokens: 2000,
      system: 'Summarise this conversation history concisely. Focus on: decisions made, tasks completed, important information shared, and any open items. Be factual and brief.',
      messages: [
        {
          role: 'user',
          content: oldMessages.map(m => {
            const role = m.role;
            const text = typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content).slice(0, 500);
            return `[${role}]: ${text}`;
          }).join('\n\n')
        }
      ]
    });

    const summary = summaryResponse.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Return compacted history: summary + recent messages
    const compacted = [
      {
        role: 'user',
        content: `[SYSTEM: Previous conversation summary from compaction]\n${summary}`
      },
      { role: 'assistant', content: 'Understood. I have the context from our earlier conversation.' },
      ...recentMessages
    ];

    console.log(`[Compaction] Reduced ${messages.length} messages to ${compacted.length}`);
    return compacted;
  } catch (err) {
    console.error('[Compaction] Summary failed, falling back to truncation:', err.message);
    // Fallback: just keep recent messages
    return recentMessages;
  }
}
```

### `src/calendar.js` — Google Calendar Integration

```javascript
// src/calendar.js
import fs from 'fs';
import { google } from 'googleapis';

let calendarClient = null;

export function initCalendar() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Load saved tokens
  if (fs.existsSync('google-tokens.json')) {
    const tokens = JSON.parse(fs.readFileSync('google-tokens.json', 'utf-8'));
    oauth2Client.setCredentials(tokens);

    // Auto-save refreshed tokens
    oauth2Client.on('tokens', (newTokens) => {
      const existing = JSON.parse(fs.readFileSync('google-tokens.json', 'utf-8'));
      const merged = { ...existing, ...newTokens };
      fs.writeFileSync('google-tokens.json', JSON.stringify(merged, null, 2));
    });

    calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
    console.log('[Calendar] Initialized with saved tokens');
  } else {
    console.warn('[Calendar] No google-tokens.json found. Run auth-server.js first.');
  }
}

export async function listEvents({ maxResults = 10, daysAhead = 7 } = {}) {
  if (!calendarClient) throw new Error('Calendar not initialized');

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString();

  const res = await calendarClient.events.list({
    calendarId: 'primary',
    timeMin, timeMax,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime'
  });

  return res.data.items.map(e => ({
    id: e.id,
    summary: e.summary,
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    location: e.location || null,
    description: e.description || null
  }));
}

export async function createEvent({ summary, startTime, endTime, description, location }) {
  if (!calendarClient) throw new Error('Calendar not initialized');

  const event = {
    summary,
    location,
    description,
    start: { dateTime: startTime, timeZone: 'Australia/Sydney' },
    end: { dateTime: endTime, timeZone: 'Australia/Sydney' }
  };

  const res = await calendarClient.events.insert({ calendarId: 'primary', requestBody: event });
  return { id: res.data.id, summary: res.data.summary, link: res.data.htmlLink };
}

export async function deleteEvent(eventId) {
  if (!calendarClient) throw new Error('Calendar not initialized');
  await calendarClient.events.delete({ calendarId: 'primary', eventId });
  return { deleted: true, eventId };
}

export async function updateEvent(eventId, updates) {
  if (!calendarClient) throw new Error('Calendar not initialized');

  const res = await calendarClient.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: updates
  });

  return { id: res.data.id, summary: res.data.summary, link: res.data.htmlLink };
}
```

### `src/tools.js` — Tool Registry

This loads the built-in tools (memory, calendar) plus any custom skills you've built.

```javascript
// src/tools.js
import fs from 'fs';
import path from 'path';
import * as memory from './memory.js';
import * as calendar from './calendar.js';

const SKILLS_DIR = path.resolve('skills');
fs.mkdirSync(SKILLS_DIR, { recursive: true });

// Built-in tool definitions (Anthropic tool_use format)
const builtInTools = [
  {
    name: 'memory_read',
    description: 'Read long-term memory (MEMORY.md) and recent daily logs.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'How many days of daily logs to load (default 2)' }
      }
    }
  },
  {
    name: 'memory_write',
    description: 'Write or update the curated long-term MEMORY.md file. Use this for important facts, preferences, and decisions that should persist.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The full updated content for MEMORY.md' }
      },
      required: ['content']
    }
  },
  {
    name: 'memory_append_daily',
    description: 'Append an entry to today\'s daily log. Use for transient notes, conversation summaries, task completions.',
    input_schema: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'The log entry to append' }
      },
      required: ['entry']
    }
  },
  {
    name: 'memory_search',
    description: 'Search across all memory files (long-term + daily logs) using keywords.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' }
      },
      required: ['query']
    }
  },
  {
    name: 'calendar_list_events',
    description: 'List upcoming calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max events to return (default 10)' },
        daysAhead: { type: 'number', description: 'How many days ahead to look (default 7)' }
      }
    }
  },
  {
    name: 'calendar_create_event',
    description: 'Create a new calendar event. Times must be ISO 8601 format.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        startTime: { type: 'string', description: 'Start time (ISO 8601, e.g. 2026-02-15T14:00:00+11:00)' },
        endTime: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description (optional)' },
        location: { type: 'string', description: 'Event location (optional)' }
      },
      required: ['summary', 'startTime', 'endTime']
    }
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete a calendar event by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'The event ID to delete' }
      },
      required: ['eventId']
    }
  },
  {
    name: 'calendar_update_event',
    description: 'Update an existing calendar event.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'The event ID to update' },
        summary: { type: 'string', description: 'New title (optional)' },
        startTime: { type: 'string', description: 'New start time (optional)' },
        endTime: { type: 'string', description: 'New end time (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        location: { type: 'string', description: 'New location (optional)' }
      },
      required: ['eventId']
    }
  }
];

// Execute a built-in tool
async function executeBuiltIn(name, input) {
  switch (name) {
    case 'memory_read': {
      const longTerm = memory.readLongTermMemory();
      const dailyLogs = memory.loadRecentDailyLogs(input.daysBack || 2);
      return { longTermMemory: longTerm, recentDailyLogs: dailyLogs };
    }
    case 'memory_write':
      memory.writeLongTermMemory(input.content);
      return { success: true, message: 'Long-term memory updated.' };
    case 'memory_append_daily':
      memory.appendDailyLog(input.entry);
      return { success: true, message: 'Daily log entry added.' };
    case 'memory_search':
      // Use hybrid BM25 + vector search if available, fall back to keyword
      try {
        const { hybridSearch } = await import('./memory-index.js');
        return { results: await hybridSearch(input.query, config.memory?.searchMaxResults || 10) };
      } catch {
        return { results: memory.searchMemory(input.query) };
      }
    case 'calendar_list_events':
      return { events: await calendar.listEvents(input) };
    case 'calendar_create_event':
      return await calendar.createEvent(input);
    case 'calendar_delete_event':
      return await calendar.deleteEvent(input.eventId);
    case 'calendar_update_event': {
      const { eventId, ...updates } = input;
      const body = {};
      if (updates.summary) body.summary = updates.summary;
      if (updates.description) body.description = updates.description;
      if (updates.location) body.location = updates.location;
      if (updates.startTime) body.start = { dateTime: updates.startTime, timeZone: 'Australia/Sydney' };
      if (updates.endTime) body.end = { dateTime: updates.endTime, timeZone: 'Australia/Sydney' };
      return await calendar.updateEvent(eventId, body);
    }
    default:
      throw new Error(`Unknown built-in tool: ${name}`);
  }
}

// Load custom skills from the skills/ directory
function loadCustomSkills() {
  const customTools = [];
  const customHandlers = {};

  if (!fs.existsSync(SKILLS_DIR)) return { customTools, customHandlers };

  for (const skillName of fs.readdirSync(SKILLS_DIR)) {
    const skillDir = path.join(SKILLS_DIR, skillName);
    const handlerPath = path.join(skillDir, 'handler.js');
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(handlerPath)) continue;

    try {
      // Dynamically import the handler
      // Note: We'll use a sync require workaround or dynamic import
      const handlerModule = await import(`file://${handlerPath}`);

      if (handlerModule.toolDefinition && handlerModule.execute) {
        customTools.push(handlerModule.toolDefinition);
        customHandlers[handlerModule.toolDefinition.name] = handlerModule.execute;
        console.log(`[Skills] Loaded: ${skillName}`);
      }
    } catch (err) {
      console.error(`[Skills] Failed to load ${skillName}:`, err.message);
    }
  }

  return { customTools, customHandlers };
}

// Main export: get all tools and a unified executor
let cachedCustomHandlers = {};

export async function getAllTools() {
  const { customTools, customHandlers } = await loadCustomSkillsAsync();
  cachedCustomHandlers = customHandlers;
  return [...builtInTools, ...customTools];
}

async function loadCustomSkillsAsync() {
  const customTools = [];
  const customHandlers = {};

  if (!fs.existsSync(SKILLS_DIR)) return { customTools, customHandlers };

  for (const skillName of fs.readdirSync(SKILLS_DIR)) {
    const skillDir = path.join(SKILLS_DIR, skillName);
    const handlerPath = path.join(skillDir, 'handler.js');

    if (!fs.existsSync(handlerPath)) continue;

    try {
      // Cache-bust by appending timestamp query
      const mod = await import(`file://${handlerPath}?t=${Date.now()}`);
      if (mod.toolDefinition && mod.execute) {
        customTools.push(mod.toolDefinition);
        customHandlers[mod.toolDefinition.name] = mod.execute;
        console.log(`[Skills] Loaded: ${skillName}`);
      }
    } catch (err) {
      console.error(`[Skills] Failed to load ${skillName}:`, err.message);
    }
  }

  return { customTools, customHandlers };
}

export async function executeTool(name, input) {
  // Try built-in first
  if (builtInTools.some(t => t.name === name)) {
    return await executeBuiltIn(name, input);
  }

  // Try custom skill
  if (cachedCustomHandlers[name]) {
    return await cachedCustomHandlers[name](input);
  }

  throw new Error(`Unknown tool: ${name}`);
}
```

### `src/claude.js` — Anthropic API Client with Tool Use Loop

```javascript
// src/claude.js
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import * as memory from './memory.js';
import { getAllTools, executeTool } from './tools.js';
import { needsCompaction, memoryFlush, compactHistory } from './compaction.js';
import { hybridSearch, indexMemoryFiles } from './memory-index.js';

const client = new Anthropic(); // Uses ANTHROPIC_API_KEY from env

const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

function buildSystemPrompt() {
  // Load SOUL.md and IDENTITY.md (OpenClaw-style personality files)
  const soul = readFileIfExists(path.resolve(config.personality.soulFile || 'SOUL.md'));
  const identity = readFileIfExists(path.resolve(config.personality.identityFile || 'IDENTITY.md'));
  const longTermMemory = memory.readLongTermMemory();
  const recentLogs = memory.loadRecentDailyLogs(config.memory.loadDaysBack);

  // Load SKILL.md files for context (like OpenClaw does)
  const skillsDir = path.resolve('skills');
  let skillDescriptions = '';
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const skillMd = path.join(skillsDir, name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        skillDescriptions += `\n### Skill: ${name}\n${fs.readFileSync(skillMd, 'utf-8')}\n`;
      }
    }
  }

  const dailyLogSection = recentLogs.length > 0
    ? recentLogs.map(l => `### ${l.date}\n${l.content}`).join('\n')
    : '(No recent daily logs)';

  return `${soul || '(No SOUL.md found — create one to define your personality)'}

${identity ? `## Identity\n${identity}` : ''}

Current date/time: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}

## Your Long-Term Memory
${longTermMemory}

## Recent Daily Logs
${dailyLogSection}

## Available Custom Skills
${skillDescriptions || '(No custom skills installed yet)'}

## Guidelines
- When I say "remember this" or share important info, write it to long-term memory immediately using memory_write.
- Log significant events and task completions to the daily log using memory_append_daily.
- Before answering questions about my preferences or past events, search memory using memory_search.
- When I ask you to build a new skill/tool, use the skill_builder tool to manage the project.
- Always use Australian Eastern time (AEDT/AEST) for calendar operations.
- You can update SOUL.md and IDENTITY.md to evolve your personality — but always tell me when you do.`;
}

// Conversation history per-channel (in-memory, resets on restart)
const conversationHistory = new Map();
const MAX_HISTORY = 40; // messages per channel

export async function chat(channelId, userMessage) {
  // Get or create conversation history for this channel
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  const history = conversationHistory.get(channelId);

  // Add user message
  history.push({ role: 'user', content: userMessage });

  // --- Compaction check (OpenClaw-style) ---
  if (config.compaction?.enabled) {
    const status = needsCompaction(history);

    if (status.shouldFlush && !history._flushed) {
      // Pre-compaction memory flush: let the AI save important context
      await memoryFlush(history);
      history._flushed = true; // prevent double-flush (like OpenClaw)
    }

    if (status.shouldCompact) {
      const compacted = await compactHistory(history);
      history.length = 0;
      history.push(...compacted);
      history._flushed = false; // reset flush tracker
      // Re-index memory after flush may have written new content
      indexMemoryFiles().catch(err => console.error('[Index]', err.message));
    }
  }

  // Trim history if too long (message count, separate from token-based compaction)
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  const tools = await getAllTools();
  const systemPrompt = buildSystemPrompt();

  let messages = [...history];
  let response;

  // Tool use loop — keep going until Claude stops calling tools
  while (true) {
    response = await client.messages.create({
      model: config.model.primary,
      max_tokens: config.model.maxTokens,
      system: systemPrompt,
      tools,
      messages
    });

    // Check if Claude wants to use tools
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

    if (toolUseBlocks.length === 0) break; // No more tool calls, we're done

    // Add assistant response with tool calls to messages
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool and collect results
    const toolResults = [];
    for (const toolCall of toolUseBlocks) {
      try {
        console.log(`[Tool] Executing: ${toolCall.name}`, JSON.stringify(toolCall.input).slice(0, 200));
        const result = await executeTool(toolCall.name, toolCall.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(result)
        });
      } catch (err) {
        console.error(`[Tool] Error in ${toolCall.name}:`, err.message);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
          is_error: true
        });
      }
    }

    // Add tool results to messages
    messages.push({ role: 'user', content: toolResults });
  }

  // Extract text response
  const textBlocks = response.content.filter(b => b.type === 'text');
  const finalText = textBlocks.map(b => b.text).join('\n');

  // Update conversation history with the final exchange
  history.push({ role: 'assistant', content: finalText });

  // Log this interaction to daily log
  memory.appendDailyLog(`User: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`);

  return finalText;
}

// Allow changing model at runtime
export function setModel(modelId) {
  config.model.primary = modelId;
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  return `Model changed to: ${modelId}`;
}

export function getModel() {
  return config.model.primary;
}
```

### `src/skill-builder.js` — The Meta-Tool for Building New Skills

This is the key differentiator — a tool that helps Claude build new tools, with project tracking.

```javascript
// src/skill-builder.js
import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.resolve('skills');

export const toolDefinition = {
  name: 'skill_builder',
  description: `Manage custom skill/tool projects. Use this to create new skills, update existing ones, read their progress, and list all skill projects. 
Each skill is a folder in skills/ with: SKILL.md (instructions), handler.js (executable logic), PROGRESS.md (dev notes), and an optional data/ folder.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update_handler', 'update_skill_md', 'update_progress', 'read_project', 'list_projects', 'read_file', 'write_data_file'],
        description: 'What to do'
      },
      skillName: {
        type: 'string',
        description: 'The skill folder name (kebab-case, e.g. "shopping-list")'
      },
      content: {
        type: 'string',
        description: 'File content for create/update operations'
      },
      fileName: {
        type: 'string',
        description: 'For read_file/write_data_file: relative path within the skill folder'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action, skillName, content, fileName } = input;

  switch (action) {
    case 'list_projects': {
      if (!fs.existsSync(SKILLS_DIR)) return { projects: [] };
      const projects = fs.readdirSync(SKILLS_DIR).filter(d =>
        fs.statSync(path.join(SKILLS_DIR, d)).isDirectory()
      ).map(name => {
        const progressPath = path.join(SKILLS_DIR, name, 'PROGRESS.md');
        const hasHandler = fs.existsSync(path.join(SKILLS_DIR, name, 'handler.js'));
        const progress = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf-8') : '(no progress file)';
        return { name, hasHandler, latestProgress: progress.slice(-500) };
      });
      return { projects };
    }

    case 'create': {
      if (!skillName) throw new Error('skillName required');
      const skillDir = path.join(SKILLS_DIR, skillName);
      const dataDir = path.join(skillDir, 'data');
      fs.mkdirSync(dataDir, { recursive: true });

      // Create PROGRESS.md
      const now = new Date().toISOString();
      fs.writeFileSync(
        path.join(skillDir, 'PROGRESS.md'),
        `# ${skillName} — Development Progress\n\n## ${now}\n- Project created\n- Status: In Development\n\n`
      );

      // Create placeholder SKILL.md
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        content || `# ${skillName}\n\nDescription: (fill in)\n\n## When to use\n(fill in)\n\n## Example phrases\n- (fill in)\n`
      );

      // Create placeholder handler.js
      fs.writeFileSync(
        path.join(skillDir, 'handler.js'),
        `// ${skillName} — custom skill handler
// This file exports: toolDefinition (Anthropic tool schema) and execute(input)

export const toolDefinition = {
  name: '${skillName.replace(/-/g, '_')}',
  description: 'TODO: Describe what this tool does',
  input_schema: {
    type: 'object',
    properties: {
      // TODO: Define input parameters
    },
    required: []
  }
};

export async function execute(input) {
  // TODO: Implement tool logic
  return { message: 'Not yet implemented' };
}
`);

      return { success: true, message: `Skill project "${skillName}" created at skills/${skillName}/` };
    }

    case 'update_handler': {
      if (!skillName || !content) throw new Error('skillName and content required');
      fs.writeFileSync(path.join(SKILLS_DIR, skillName, 'handler.js'), content);
      return { success: true, message: `handler.js updated for "${skillName}"` };
    }

    case 'update_skill_md': {
      if (!skillName || !content) throw new Error('skillName and content required');
      fs.writeFileSync(path.join(SKILLS_DIR, skillName, 'SKILL.md'), content);
      return { success: true, message: `SKILL.md updated for "${skillName}"` };
    }

    case 'update_progress': {
      if (!skillName || !content) throw new Error('skillName and content required');
      const progressPath = path.join(SKILLS_DIR, skillName, 'PROGRESS.md');
      const now = new Date().toISOString();
      fs.appendFileSync(progressPath, `\n## ${now}\n${content}\n`);
      return { success: true, message: `Progress updated for "${skillName}"` };
    }

    case 'read_project': {
      if (!skillName) throw new Error('skillName required');
      const skillDir = path.join(SKILLS_DIR, skillName);
      if (!fs.existsSync(skillDir)) throw new Error(`Skill "${skillName}" not found`);

      const files = {};
      for (const file of ['SKILL.md', 'handler.js', 'PROGRESS.md']) {
        const p = path.join(skillDir, file);
        files[file] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
      }

      // List data files
      const dataDir = path.join(skillDir, 'data');
      files.dataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

      return files;
    }

    case 'read_file': {
      if (!skillName || !fileName) throw new Error('skillName and fileName required');
      const filePath = path.join(SKILLS_DIR, skillName, fileName);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${fileName}`);
      return { content: fs.readFileSync(filePath, 'utf-8') };
    }

    case 'write_data_file': {
      if (!skillName || !fileName || !content) throw new Error('skillName, fileName, and content required');
      const filePath = path.join(SKILLS_DIR, skillName, 'data', fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      return { success: true, message: `Data file written: ${fileName}` };
    }

    default:
      throw new Error(`Unknown skill_builder action: ${action}`);
  }
}
```

### `src/discord.js` — Discord Bot

```javascript
// src/discord.js
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { chat, setModel, getModel } from './claude.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // needed for DMs
});

export function startDiscord() {
  client.on('ready', () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // SECURITY: Only respond to the owner
    if (message.author.id !== process.env.DISCORD_OWNER_ID) {
      console.log(`[Discord] Ignored message from non-owner: ${message.author.tag}`);
      return;
    }

    // Handle special commands
    const content = message.content.trim();

    if (content.startsWith('!model ')) {
      const newModel = content.slice(7).trim();
      const result = setModel(newModel);
      await message.reply(result);
      return;
    }

    if (content === '!model') {
      await message.reply(`Current model: \`${getModel()}\``);
      return;
    }

    if (content === '!ping') {
      await message.reply('Pong! I\'m alive.');
      return;
    }

    // Send typing indicator
    await message.channel.sendTyping();

    try {
      const response = await chat(message.channel.id, content);

      // Discord has a 2000 char limit — split long messages
      if (response.length <= 2000) {
        await message.reply(response);
      } else {
        const chunks = splitMessage(response, 2000);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      }
    } catch (err) {
      console.error('[Discord] Error:', err);
      await message.reply(`Error: ${err.message}`);
    }
  });

  client.login(process.env.DISCORD_TOKEN);
}

function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // Fall back to space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
```

### `src/index.js` — Entry Point

```javascript
// src/index.js
import 'dotenv/config';
import { initCalendar } from './calendar.js';
import { startDiscord } from './discord.js';
import { initMemoryIndex, indexMemoryFiles } from './memory-index.js';

console.log('=== MiniClaw Starting ===');
console.log(`Time: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`);

// Initialize Google Calendar
initCalendar();

// Initialize memory search index (SQLite + FTS5 + optional vectors)
initMemoryIndex();
indexMemoryFiles().then(() => {
  console.log('[MemoryIndex] Initial indexing complete');
}).catch(err => {
  console.warn('[MemoryIndex] Initial indexing failed (non-fatal):', err.message);
});

// Start Discord bot
startDiscord();

console.log('=== MiniClaw Ready ===');
```

### `package.json` Updates

Make sure your `package.json` has:

```json
{
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "auth": "node auth-server.js"
  }
}
```

---

## Part 6: Wiring Up the Skill Builder

The skill builder is loaded by `tools.js` as a custom skill, but since it's a core feature, let's register it directly. Update `src/tools.js` — add this import and registration at the top:

```javascript
import * as skillBuilder from './skill-builder.js';
```

Then add `skillBuilder.toolDefinition` to the `builtInTools` array, and add this case to the `executeBuiltIn` function:

```javascript
case 'skill_builder':
  return await skillBuilder.execute(input);
```

---

## Part 7: How Hybrid Memory Search Works

This system replicates OpenClaw's memory retrieval architecture. Here's what happens when the AI uses `memory_search`:

**Two search methods run in parallel:**

1. **BM25 (keyword search)** via SQLite FTS5 — finds exact keyword matches. Great for "what did I say about COLMAP?" where you want the exact term.

2. **Vector search** via Voyage AI embeddings stored in SQLite — finds semantically similar content. Great for "what decisions did we make about the terrain system?" where the answer might say "biome generator" instead of "terrain".

**Reciprocal Rank Fusion (RRF)** combines both result sets. OpenClaw specifically uses the *union* approach (not intersection) — meaning a result that scores well on *either* method gets included. This prevents the common failure mode where keyword search misses semantic matches and vector search misses exact phrases.

**Delta indexing**: When you start the bot, it hashes each memory file and only re-indexes files that have changed since the last run. This keeps startup fast even with months of daily logs.

**Graceful degradation**: If vector embeddings aren't available (no Voyage API key, or the API is down), it falls back to keyword-only BM25 search. If that also fails, the original simple keyword search in `memory.js` still works. The Markdown files always remain the source of truth.

### Re-indexing

The memory index updates automatically when:
- The bot starts up (initial index)
- After a compaction flush writes new content to memory files
- You can also trigger it manually by adding a `!reindex` command to your Discord bot

---

## Part 8: How Context Compaction Works

Long conversations fill up the context window. Without compaction, the bot would eventually hit the model's token limit and crash. OpenClaw's approach turns this from a data-loss event into a managed checkpoint.

**The lifecycle:**

```
Normal conversation
     │
     ▼
Token estimate crosses soft threshold
(contextWindow - reserveTokensFloor - softThresholdTokens)
     │
     ▼
╔══════════════════════════════════════════╗
║  MEMORY FLUSH (silent agentic turn)     ║
║  Claude writes durable facts to disk:   ║
║  - Important decisions → MEMORY.md      ║
║  - Session notes → memory/YYYY-MM-DD.md ║
║  - Replies with NO_REPLY (user sees     ║
║    nothing)                             ║
╚══════════════════════════════════════════╝
     │
     ▼
Token estimate crosses hard threshold
(contextWindow - reserveTokensFloor)
     │
     ▼
╔══════════════════════════════════════════╗
║  COMPACTION                             ║
║  1. Older messages summarised by the    ║
║     fallback model (cheaper)            ║
║  2. Summary + recent messages = new     ║
║     conversation history                ║
║  3. Memory index re-indexed             ║
╚══════════════════════════════════════════╝
     │
     ▼
Conversation continues seamlessly
```

**With default settings** (200K context window, 20K reserve, 4K soft threshold):
- Memory flush triggers at ~176K tokens
- Compaction triggers at ~180K tokens
- This gives Claude ~4K tokens to complete the flush before compaction

**Safeguards** (matching OpenClaw):
- One flush per compaction cycle (tracked with `_flushed` flag)
- If flush fails, compaction still runs (graceful degradation)
- Compaction uses the fallback/cheaper model for summarisation

---

## Part 9: Running MiniClaw

### First Run

```bash
# 1. Auth with Google Calendar (one-time)
npm run auth
# Follow the URL, authorize, tokens are saved

# 2. Start the bot
npm start
```

### Test It

In your private Discord server, try:

- `hello` — basic chat
- `what's on my calendar this week?` — calendar integration
- `remember that my Godot project uses chunk-based terrain generation` — memory write
- `!model claude-sonnet-4-5-20250929` — change model
- `let's build a shopping list manager` — kicks off the skill builder

### What Happens When You Build a Skill

When you say "let's build a shopping list manager", Claude will:

1. Use `skill_builder` with action `create` to scaffold `skills/shopping-list/`
2. Write a proper `SKILL.md` with instructions
3. Write a working `handler.js` with the tool definition and logic
4. Update `PROGRESS.md` to track what was done

Next time you start MiniClaw, the new skill is automatically loaded. You can say "add milk to my shopping list" and it'll use the new tool.

To resume work: "let's keep working on the shopping list tool" — Claude will use `skill_builder` with `read_project` to load the current state, then continue building.

---

## Part 10: Security Considerations

### What's Already Secured

- **Discord owner-only check**: The bot only responds to your Discord user ID. Everyone else is ignored.
- **API keys in .env**: Never committed to git.
- **Google tokens on disk**: Refresh tokens are stored locally, not in any cloud.

### What You Should Also Do

1. **`.gitignore`** — Make sure this exists:
   ```
   .env
   google-tokens.json
   node_modules/
   memory/
   skills/*/data/
   data/              # SQLite index database
   ```

2. **Keep the Discord server private** — Don't invite anyone else. The bot's owner check is a safety net, not the primary defense.

3. **Set an Anthropic spending limit** — Go to your Anthropic dashboard → Billing → set a hard monthly cap. Agent tool loops can burn tokens fast.

4. **Review custom skills before running them** — When Claude writes a `handler.js`, read it before restarting the bot. This is code that will execute on your machine.

5. **No sandboxing** — Unlike OpenClaw (which can run in Docker), your skills run with your user's full permissions. Be cautious with skills that write files or run shell commands.

6. **Firewall** — Your PC isn't exposed to the internet (no port forwarding needed). Discord and the APIs all use outbound connections.

---

## Part 11: Growing Your Assistant

### Personality Evolution

Your AI's personality lives in `SOUL.md` and `IDENTITY.md`. During the first conversation, it should fill in `IDENTITY.md` (name, vibe, emoji). Over time, you can ask it to update `SOUL.md` — for example, "add to your soul file that you should always suggest git commits after we finish building a skill." The AI will always tell you when it changes these files.

### Going Fully Offline with Local Embeddings

The vector search currently uses Voyage AI's cloud API. To go fully offline, you can swap in local embeddings using the `@xenova/transformers` library:

```bash
npm install @xenova/transformers
```

This would download a GGUF embedding model on first use (~1GB) and run entirely on your CPU. This is a great first skill-building project with your assistant: "let's upgrade the memory embeddings to use local transformers."

### Ideas for First Skills to Build Together

- **Shopping list manager** — add/remove/view items, store in JSON
- **Daily briefing** — cron job that sends you a morning summary via Discord
- **Reminder system** — set reminders, store as JSON, check on a timer
- **Project notes** — per-project context files that load when you mention the project
- **URL bookmarks** — save and categorize links with notes
- **Expense tracker** — log purchases, generate weekly summaries

### Model Quick Reference

Use `!model <id>` in Discord to switch:

| Model | ID | Best For |
|-------|----|----------|
| Sonnet 4.5 | `claude-sonnet-4-5-20250929` | Daily use, good balance |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Fast/cheap tasks |
| Opus 4.5 | `claude-opus-4-5-20250929` | Complex reasoning |

---

That's the complete setup. You now have a minimal personal AI assistant that:

- Chats via Discord (owner-only)
- Uses the Anthropic API with configurable model selection
- Manages your Google Calendar
- Has OpenClaw-style Markdown memory (long-term + daily logs)
- Has hybrid BM25 + vector search over memory (with SQLite, matching OpenClaw's architecture)
- Has context compaction with pre-compaction memory flush (no more lost context in long sessions)
- Has an OpenClaw-style personality system (SOUL.md + IDENTITY.md) that evolves over time
- Can build its own tools collaboratively through the skill builder
- Keeps skill projects separate with progress tracking

Start simple, build skills as you need them, and it'll grow into exactly the assistant you want.
