# Gemma 4 Integration — Setup Guide

## What I Built While You Were On The Train

I've created a `gemma-chat` skill in `staging/skills/gemma-chat/` that provides local LLM integration via Ollama. Here's what's ready and what you need to do when you get home.

## Status: Skill Built, Not Yet Integrated

✅ **Done:**
- Full Ollama integration handler (`handler.js`)
- Three actions: `chat`, `status`, `usage`
- Usage tracking with cost savings calculation
- Graceful error handling for offline Ollama
- Documentation (`SKILL.md`, `PROGRESS.md`)

❌ **Not Done:**
- `!gemma` command not hooked into Discord yet (needs discord.js modification)
- Ollama not installed on your machine
- Testing

## What You Need To Do

### 1. Install Ollama (5 minutes)

**On Windows:**
```powershell
# Download from https://ollama.com/download
# Run the installer — it auto-starts as a background service
```

**Verify installation:**
```powershell
ollama --version
```

### 2. Pull Gemma 4 Model (5-10 minutes)

**Recommended: E4B (balanced speed/quality)**
```powershell
ollama pull gemma4:e4b
```

**Or if you have a beefy GPU: 31B (better quality, slower)**
```powershell
ollama pull gemma4:31b
```

### 3. Test Ollama Directly

```powershell
ollama run gemma4:e4b
```

Ask it something: *"Write a Python function to validate an email address."*

If it responds, Ollama is working.

### 4. Hook Into MiniClaw

I need to modify `staging/src/discord.js` to add the `!gemma` command handler. Two approaches:

**Option A: Simple one-shot command**
- `!gemma <message>` sends message to Ollama, returns response
- Doesn't change conversation history or mode
- Easy to implement

**Option B: Mode switcher (like !haiku/!sonnet/!opus)**
- `!gemma` switches to "Gemma mode"
- All subsequent messages go to Ollama until you switch back
- More complex, better for extended local use

**Which do you prefer?** I can build either tonight.

## How To Use (Once Integrated)

### Check Ollama Status
Via tool call (once I hook it up):
```javascript
{
  tool: 'gemma_chat',
  action: 'status'
}
```

### Send A Message To Gemma
```javascript
{
  tool: 'gemma_chat',
  action: 'chat',
  message: 'Write a regex to validate Australian phone numbers'
}
```

### Check Usage Stats
```javascript
{
  tool: 'gemma_chat',
  action: 'usage'
}
```

## Expected Performance

| Task | Gemma 4 E4B | Claude Haiku | Claude Sonnet |
|------|-------------|--------------|---------------|
| Simple Q&A | ✅ Good | ✅ Better | ✅ Best |
| Code gen (Python) | ✅ Good | ✅ Good | ✅ Better |
| Complex reasoning | ⚠️ Okay | ✅ Good | ✅ Best |
| Tool orchestration | ⚠️ Basic | ✅ Good | ✅ Best |
| **Cost per 1M tokens** | **$0** | **$0.25** | **$3.00** |

## Estimated Savings

If you offload 40% of current Haiku/Sonnet usage to local Gemma:

**Current spend (hypothetical):**
- Haiku: $5/month
- Sonnet: $20/month
- Opus: $30/month
- **Total: $55/month**

**With Gemma hybrid:**
- Gemma (local): $0/month (40% of simple tasks)
- Sonnet: $12/month (reduced, tool-only)
- Opus: $20/month (reduced, complex builds)
- **Total: ~$32/month**

**Savings: ~$23/month (~42%)**

Over a year: **$276 saved** — almost covers one ADHD treatment session.

## Next Steps

1. **Install Ollama** when you get home
2. **Pull gemma4:e4b**
3. **Test it standalone** to verify it works
4. **Tell me which integration approach you want** (one-shot vs mode switcher)
5. **I'll finish the discord.js integration** and you can test in staging
6. **Promote to live** if it works

## Files Created

```
staging/skills/gemma-chat/
├── handler.js          # Main skill logic
├── SKILL.md           # Full documentation
├── PROGRESS.md        # Build log
└── data/              # Usage stats (created on first use)
    └── usage.json     # Token tracking
```

## Questions To Answer

1. **Which command style?** One-shot (`!gemma write code`) or mode switcher (`!gemma` then all messages go local)?
2. **Default model?** E4B (fast) or 31B (better but slower)?
3. **Auto-routing?** Should I build logic that auto-sends simple questions to Gemma without you asking?

Let me know and I'll finish the integration tonight.

---

**Bottom line:** The hard part is done. Just need Ollama installed, model pulled, and 10 minutes to hook up the Discord command.
