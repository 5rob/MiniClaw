# MiniClaw Quick Start

## Immediate Next Steps

### 1. Install Dependencies

```bash
npm install
```

> ⚠️ **Windows Note**: If you get build errors for `better-sqlite3`, you need Windows build tools:
>
> ```bash
> npm install --global windows-build-tools
> ```
>
> Run as **administrator**, then retry `npm install`.

### 2. Configure Environment

```bash
copy .env.example .env
notepad .env
```

Fill in at minimum:
- `ANTHROPIC_API_KEY` — Get from https://console.anthropic.com/
- `DISCORD_TOKEN` — See "Discord Setup" below
- `DISCORD_OWNER_ID` — Your Discord user ID

Optional:
- `VOYAGE_API_KEY` — For vector embeddings (free at https://www.voyageai.com)
- Google Calendar credentials — See README for full setup

### 3. Discord Setup (5 minutes)

1. Go to https://discord.com/developers/applications
2. Click "New Application" → Name: "MiniClaw"
3. Go to **Bot** tab → Click "Reset Token" → Copy token → Paste into `.env` as `DISCORD_TOKEN`
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Message History`, `Embed Links`
6. Copy URL → Open in browser → Invite to your private server
7. In Discord: Settings → Advanced → Enable Developer Mode
8. Right-click your username → Copy User ID → Paste into `.env` as `DISCORD_OWNER_ID`

### 4. Google Calendar Setup (Optional, 10 minutes)

See full instructions in README.md. Summary:

1. Create Google Cloud project
2. Enable Calendar API
3. Create OAuth2 credentials
4. Add credentials to `.env`
5. Run: `npm run auth` (opens browser, authorize, done)

### 5. Start MiniClaw

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

### 6. First Message

In your Discord server, try:

```
hello! who are you?
```

The bot should respond. Try these next:

```
remember that I'm building a game in Godot with procedural terrain
```

```
what do you remember about me?
```

```
let's build a shopping list skill together
```

## Troubleshooting

### Bot doesn't respond
- Check `DISCORD_OWNER_ID` matches your Discord user ID exactly
- Make sure Message Content Intent is enabled in Discord Developer Portal
- Look at console for error messages

### "Calendar not initialized"
- Either skip calendar for now (it's optional)
- Or run `npm run auth` to complete Google OAuth2 flow

### "better-sqlite3" build errors
- Install Windows build tools: `npm install --global windows-build-tools` (as admin)
- Requires Python 3 and Visual Studio Build Tools

### "Vector search failed"
- This is expected if you don't have `VOYAGE_API_KEY`
- System falls back to keyword-only search (works fine!)
- Add Voyage API key later if you want semantic search

## What to Try

Once running, explore these features:

**Memory System:**
```
remember that my favorite color is blue
search my memory for "blue"
```

**Calendar (if configured):**
```
what's on my calendar this week?
add a meeting tomorrow at 3pm for 1 hour called "Project Review"
```

**Skill Building:**
```
let's build a note-taking skill
```

**Model Switching:**
```
!model claude-haiku-4-5-20251001
what model are you using?
!model claude-sonnet-4-5-20250929
```

**Personality:**
```
update your identity file - pick a name and emoji you like
```

## Running 24/7

To keep MiniClaw running permanently on your Windows PC:

1. Install PM2: `npm install -g pm2`
2. Start with PM2: `pm2 start src/index.js --name miniclaw`
3. Save: `pm2 save`
4. Setup startup: `pm2 startup` (follow instructions)

Or use `node-windows` to create a Windows service.

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore `SOUL.md` and `IDENTITY.md` to shape your AI's personality
- Build your first custom skill together with the AI
- Set up Google Calendar if you skipped it initially

---

Have fun! Your AI assistant is ready to grow with you.
