# Development Log — gemma-chat

## 2026-04-07 — Initial Build

**Built by:** Julian (live bot)  
**Context:** Rob on train, wants to test local Gemma 4 via Ollama to reduce Claude API costs. Requested !gemma command that coexists with existing model switcher.

**What I built:**
- Full Ollama integration via OpenAI-compatible API
- `!gemma` command support (hooks into Discord handler)
- Three actions: chat, status, usage
- Usage tracking with cost savings estimates
- Direct `chat()` export for programmatic use (other skills, Claude Code integration)
- Graceful error handling when Ollama offline
- Model variant support (e4b, 31b, etc.)
- Function calling / tool support (Gemma 4 native capability)

**Technical decisions:**
- Used native fetch (Node 18+) — no dependencies
- 30s timeout for local inference (configurable)
- Persistent usage log in `data/usage.json`
- Cost savings calculated vs Haiku and Sonnet
- OpenAI-compatible format for easy portability

**Assumptions:**
- Ollama installed and running at `http://localhost:11434`
- Rob will install when home from train
- Default model: `gemma4:e4b` (good balance of speed/quality)

**Testing needed:**
- Verify Ollama connectivity when Rob gets home
- Test !gemma command in staging
- Check tool/function calling with existing MiniClaw tools
- Validate usage tracking accumulates correctly

**Next steps:**
- Hook into Discord message handler for !gemma detection
- Test in staging with Test Bud
- Promote to live if working
- Future: auto-routing (simple → Gemma, complex → Claude)
