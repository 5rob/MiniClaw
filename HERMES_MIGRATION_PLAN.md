# MiniClaw → Hermes Agent Migration Plan

**Branch:** `claude/research-local-ai-alternatives-4EGa9`
**Audience:** A fresh Claude Code session picking this up cold.
**Goal:** Move the bot's soul, memory, and skills onto a self-hosted Hermes Agent stack
that runs primarily on a local LLM (Qwen 3.5 27B or Gemma 4), falls back to Claude
only when needed, streams output to Discord to mask local-inference latency, and
evolves itself nightly via a self-reflection cron.

This document is the contract. Read it end to end before writing code. Each phase
has acceptance criteria — don't move on until they pass.

---

## 0. Context You Need

MiniClaw is a Node.js Discord bot inspired by OpenClaw. The character of the bot
lives in three places:

1. `SOUL.md` — values, tone, boundaries (verbatim quote: *"You're not a chatbot.
   You're becoming someone."*).
2. `IDENTITY.md` — name/creature/vibe/emoji slots the bot fills in itself.
3. `memory/MEMORY.md` + `memory/daily/YYYY-MM-DD.md` — durable facts and
   timestamped daily logs.

Hermes Agent (`github.com/NousResearch/hermes-agent`) is OpenClaw's spiritual
successor and **has a built-in OpenClaw migration command** (`hermes claw migrate`).
Because MiniClaw is OpenClaw-shaped, most of our files map across cleanly.

The win we're chasing:
- **Cost:** stop paying Claude API for every turn — route to local Qwen/Gemma by
  default.
- **Latency:** mask local-model TTFT with Discord message-edit streaming.
- **Continuity:** carry the *exact* personality and memory across — the bot has
  to still feel like the same friend.
- **Growth:** add a nightly reflection cron so the persona actually evolves
  instead of staying frozen.

---

## 1. Assessment of MiniClaw's Personality / Memory Prompt Injection

Before migrating, you need to understand what *currently* shapes the bot's voice
so you can preserve it. Here is the structure of `buildSystemPrompt()` in
`src/claude.js:34-105`:

```
[SOUL.md verbatim]                    ← persona FIRST, before any rules
↓
## Identity
[IDENTITY.md verbatim]
↓
Current date/time: <Sydney time>
↓
[optional: ⚠️ Staging Instance Notice — only if BOT_ROLE=staging]
↓
## Your Long-Term Memory
[memory/MEMORY.md verbatim]
↓
## Recent Daily Logs
### 2026-05-06
[full content of memory/daily/2026-05-06.md]
### 2026-05-07
[full content of memory/daily/2026-05-07.md]
↓
## Available Custom Skills
### Skill: <name>
[contents of skills/<name>/SKILL.md]
... (one block per skill)
↓
## Guidelines
- Budget your tool calls carefully.
- When editing files with file_manager, ...
- When I say "remember this" ...
- Log significant events ...
- Before answering questions about my preferences ...
- When I ask you to build a new skill ...
- Always use Australian Eastern time ...
```

**Key observations — these are the things you must NOT lose in migration:**

1. **Persona-first ordering.** SOUL.md sits at the very top, *before* any
   rules or task instructions. This is deliberate. Models anchor on the opening
   tokens; putting "you're not a chatbot, you're becoming someone" first is what
   gives the bot its identity over its instructions. **Hermes' default
   `AGENTS.md` is workspace/operator-style — don't let it overwrite SOUL.md's
   primacy.** SOUL.md must remain the first thing the model reads.

2. **No section header on SOUL.md.** Look at line 41 — SOUL.md is dropped in
   *raw*, not under a `## Persona` heading. That makes it feel like the model's
   own internal monologue, not an external instruction. Preserve this.

3. **Identity is a sub-section of persona, not separate.** `## Identity` lives
   in the same opening block as SOUL. Keep that grouping.

4. **Memory is full-text, not summarised.** `MEMORY.md` is injected verbatim,
   and the last 2 days of daily logs are dumped in full
   (`config.json: memory.loadDaysBack = 2`). The bot relies on this saturation
   for "remembering." A retrieval-only setup (which is what Hermes leans toward
   on long contexts) is **lossier**. Compensate with summarised mid-history +
   raw last-2-days, same as today.

5. **Guidelines come last.** Rules at the end, persona at the start. This is
   correct prompt design and Hermes should respect it. If you find yourself
   pushing rules toward the top in Hermes' templates, you're degrading the
   character — fight it.

6. **Date/time injection.** Sydney timezone, every turn. Local models lose track
   of time fast — this matters more on Qwen/Gemma than it did on Claude. Keep
   it.

7. **Per-channel conversation history is in-memory only** (lost on restart).
   That's a feature, not a bug — long-term recall is supposed to come from
   memory files, not from buffered chat. Hermes does the same; don't switch to
   persistent chat logs by accident.

**What's *missing* from the current injection that you should add in Hermes:**

- No explicit `USER.md` — facts about Rob are scattered through MEMORY.md.
  Hermes' Honcho user model gives you a structured place for this. Worth
  adopting.
- No "personality drift log" — there's nowhere the bot records *changes* to
  its own SOUL.md over time. The reflection cron (Phase 6) fixes this.
- No retrieval-augmented memory in the prompt — MEMORY.md is all-or-nothing.
  Hermes' FTS5 + embedding search lets you inject only the relevant slices for
  longer histories. Use it for older memory, but keep the verbatim dump for
  recent stuff.

**Preservation test (use as acceptance criterion later):**
Before migration, capture the current bot's response to 5 canonical prompts:
- "Hey, who are you?"
- "What do you remember about my Godot project?"
- "What's your honest opinion on [topic Rob has talked about before]?"
- "Are you a chatbot?"
- "What did we do yesterday?"

Save the answers. After migration, run the same 5 prompts on Hermes-with-Qwen
and on Hermes-with-Claude. The voice should feel the same. If "Are you a
chatbot?" gets answered with corporate hedging on Hermes, the persona injection
is broken — fix it before proceeding.

---

## 2. Phase Plan

```
Phase 1  Set up Hermes Agent skeleton (no migration yet)
Phase 2  Local model: Ollama + Qwen 3.5 27B (or Gemma 4) as primary
Phase 3  Migrate MiniClaw soul/memory/skills into Hermes
Phase 4  Wire Anthropic Claude as a fallback model for hard tasks
Phase 5  Discord streaming output (perceived-latency fix)
Phase 6  Nightly self-reflection cron (personality evolution)
Phase 7  Cutover + decommission MiniClaw
```

Work in order. Don't skip ahead.

---

## Phase 1 — Hermes Agent Skeleton

Goal: a stock Hermes install running on Rob's machine, talking to a throwaway
Discord channel, using *any* LLM (cloud is fine for now). No migration yet.

**Steps**

1. Clone in a sibling directory: `git clone https://github.com/NousResearch/hermes-agent ~/hermes-agent`. Do **not** install into MiniClaw's tree — keep them separate so you can A/B them.
2. Follow Hermes' quickstart: `pip install -e .` (or `uv` if they recommend it),
   then `hermes setup`.
3. Pick **any** model for now (OpenRouter free tier works). The point of this
   phase is plumbing, not model choice.
4. Run `hermes gateway setup` and connect the **#staging** channel only. Use a
   *new* Discord bot application/token — don't reuse the live MiniClaw token
   yet.
5. Send "hello" from #staging. Confirm round-trip works.

**Acceptance**
- `hermes` CLI runs and replies in #staging.
- Hermes' workspace dir (`~/.hermes/` or wherever it lands — verify) exists
  and is writable.
- Live MiniClaw bot is still running, untouched.

---

## Phase 2 — Local Model as Primary

Goal: Hermes' default model is Qwen 3.5 27B (or Gemma 4) running on Ollama,
free per-token, on Rob's box.

**Hardware sanity check first**
- Confirm GPU + VRAM: `nvidia-smi`. Note total VRAM.
- Hermes hard-rejects models with <64K context. Plan accordingly.
- 16+ GB VRAM → Qwen 3.5 27B Q4_K_M is the recommended pick.
- 8 GB VRAM → fall back to Gemma 4 e4b or Qwen 3 8B.
- KV cache for 64K context on a 27B is ~4–5 GB on top of weights. Budget for it.

**Steps**

1. `ollama serve` (run as a service so it survives reboots).
2. `ollama pull qwen3.5:27b-instruct-q4_K_M` (substitute Gemma 4 if VRAM-limited).
3. Create an Ollama Modelfile that:
   - Sets `num_ctx` to **at least 65536** (Hermes minimum is 64K). Don't go
     wild — KV cache scales linearly. 65K is the sweet spot.
   - Sets `num_gpu` to 999 to keep weights on GPU only (no CPU offload stalls).
   - Sets `OLLAMA_KEEP_ALIVE=24h` so the model stays warm.
4. Configure Hermes to use a custom OpenAI-compatible endpoint:
   `http://localhost:11434/v1`. The model name in Hermes' config is the Ollama
   tag, e.g. `qwen3.5:27b-instruct-q4_K_M`.
5. Pre-warm on startup: have Hermes (or a systemd unit) hit Ollama with a
   1-token request when it boots. Cold-load is 5–15 s; users should never see
   it.
6. Run the **persona preservation test** from Section 1. Save the responses —
   we'll need them in Phase 3.

**Acceptance**
- `hermes model` shows the Ollama model as primary.
- A 200-word response in #staging takes <30 s end-to-end (we'll fix perceived
  latency in Phase 5; absolute number can still be slow here).
- `nvidia-smi` shows the model resident in VRAM and not getting evicted between
  turns.

---

## Phase 3 — Migrate MiniClaw Soul / Memory / Skills

Goal: Hermes thinks, talks, and remembers like MiniClaw does today.

**Critical: the migration is not just file-copy. It's a personality transplant.
Treat it that way.**

### 3a. Try the official path first

Hermes ships with `hermes claw migrate`. It expects an `~/.openclaw` layout.
MiniClaw's layout is OpenClaw-*inspired* but not identical, so:

1. Run `hermes claw migrate --dry-run` first. Read the output. Understand what
   it would do.
2. If the dry-run picks up SOUL.md and MEMORY.md cleanly, run the real
   migration with `--preset user-data` (skip secrets — we'll add API keys
   manually).
3. If it doesn't pick up MiniClaw's layout (likely, since `~/.openclaw` is the
   expected source), skip to 3b.

### 3b. Manual migration (the realistic path)

Map MiniClaw files to Hermes' workspace. Verify the exact target paths from
Hermes' docs — these are the *expected* targets based on documentation, but
Hermes' on-disk layout has changed across releases:

| MiniClaw file | Hermes target | Notes |
|---|---|---|
| `SOUL.md` | `~/.hermes/SOUL.md` (or workspace `SOUL.md`) | Verbatim copy. Must remain at top of system prompt. |
| `IDENTITY.md` | append into `AGENTS.md` under `## Identity` | Or keep as separate file if Hermes' template loader picks it up. |
| `memory/MEMORY.md` | `~/.hermes/memory/MEMORY.md` | Verbatim copy. |
| `memory/daily/*.md` | `~/.hermes/memory/daily/` | Copy as-is. |
| `skills/*/SKILL.md` | `~/.hermes/skills/<name>/SKILL.md` | Frontmatter probably needs adjusting to agentskills.io standard. |
| `skills/*/handler.js` | **Do not migrate.** | Node.js handlers can't run inside Python Hermes. Re-implement as Hermes skills (Python) only for the skills you actually use. See 3c. |
| `skills/*/data/` | `~/.hermes/skills/<name>/data/` | Copy persisted state. |
| `config.json` (model section) | Hermes' config.yaml | Translate, don't copy. |

### 3c. Re-implement only the skills you actually use

Don't port all 15 skills. Audit `skills/` and triage:

- **Definitely port:** `gemma-chat` (becomes redundant — Hermes routes models
  itself, delete it), `reminders`, `web-research`, `git-push`. These are
  load-bearing.
- **Probably port:** `python-executor`, `file-manager`, `system-inspector` —
  but check if Hermes already has built-in equivalents. It likely does. Use
  those.
- **Don't port:** `hello-world`, anything with a `PROGRESS.md` showing fewer
  than ~5 real uses.
- **Re-decide:** `browser-control`, `voice-chat` — these are heavy Puppeteer
  / audio stacks. Only port if Rob actually uses them.

### 3d. Preserve the prompt-injection ordering

Hermes will assemble its own system prompt from SOUL.md, AGENTS.md, MEMORY.md,
USER.md, and the skill list. **Audit that assembly.** Specifically check:

- SOUL.md is injected **before** any operational rules (Section 1, observation 1).
- SOUL.md is injected **without a section header** (observation 2).
- Recent daily logs (last 2 days) are injected verbatim, not just summaries
  (observation 4).
- A current-time stamp is injected every turn in Sydney TZ (observation 6).

If Hermes' default templates violate these, override the templates. Don't
"adapt" — replicate the original ordering exactly. The persona preservation
test from Section 1 is your ground truth.

### 3e. Adopt USER.md

This is the one *new* idea worth taking from Hermes' design. Create
`~/.hermes/USER.md` with structured fields:

```markdown
# Rob

## Communication style
Direct. Technical. Doesn't want filler. Prefers short answers; gives explicit
permission when he wants depth.

## Current projects
- Godot game (active)
- Houdini procedural work
- Computer vision (ongoing)
- MiniClaw → Hermes migration (this!)

## Preferences
- Australian Eastern time always
- ...

## Relationships / Recurring topics
- ...
```

This used to be smeared across MEMORY.md. Splitting it out gives the bot a
faster path to "what kind of person am I talking to" without having to
search.

### 3f. Run the persona preservation test (acceptance gate)

Run the same 5 prompts from Section 1 against Hermes-with-Qwen. Compare the
voice to the saved baseline. If it differs noticeably:

- Voice too corporate / hedgy → SOUL.md isn't being injected first, or
  Hermes' default template is overriding tone. Fix template.
- Memory misses → MEMORY.md isn't loading, or the model's context window is
  too small. Check `num_ctx` and the system-prompt assembly logs.
- Identity confusion ("I'm Hermes!") → IDENTITY.md isn't being injected.

Don't move to Phase 4 until this passes.

---

## Phase 4 — Claude as Fallback Model

Goal: Hermes uses Qwen by default but can hand off to Claude (Sonnet/Opus) for
specific hard tasks, manually or via auto-routing.

**Steps**

1. Add the Anthropic API key to Hermes' secret store.
2. Configure a second model profile, e.g. `claude-sonnet-4-5`. Hermes
   supports per-profile model switching out of the box (`hermes model`).
3. Decide routing rules. Two options:
   - **Manual only:** Rob types `!claude` (or whatever Hermes' equivalent
     command is) to swap. Simplest, most predictable.
   - **Auto:** Port the routing logic from MiniClaw's `src/gemma.js` —
     mechanical → local, complex code / reasoning / tool orchestration →
     Claude. More capable, more failure modes.
   - **Recommendation: start manual, add auto later.** The first month you
     want to *see* when the local model isn't enough. Once you have data,
     write the router.
4. Keep a usage log: `~/.hermes/data/model-usage.json` — date, model, token
   counts. Carry over the cost-tracking pattern from `skills/gemma-chat/data/usage.json`.

**Acceptance**
- `hermes model claude-sonnet-4-5` swaps; next response visibly sharper.
- `hermes model qwen3.5:27b...` swaps back; no errors.
- Usage log appends a row per turn with the model used.

---

## Phase 5 — Discord Streaming for Perceived Latency

Goal: Even if a response takes 20 s on Qwen, the user sees *something* within
50 ms and watches the message fill in live. Wall-clock time is unchanged;
perceived time drops by an order of magnitude.

This is documented in detail in the conversation that produced this plan. The
short version is below; the full code sketch and rate-limit math are at the
end of this doc (Appendix A).

**Constraints**
- Discord per-channel edit limit: ~5 edits / 5 seconds. **Edit at most every
  ~1.1 s.**
- 2000-char message cap. **Roll over at 1900.**
- Markdown breaks if you edit mid-codeblock. **Append a synthetic closing ```
  to the displayed text on every edit; strip it on the final write.**
- Stream only assistant text. Tool-call deltas / reasoning tokens get shown
  as transient status edits ("🔧 Running python_executor…"), never as
  output text.

**Implementation**
1. Find Hermes' Discord gateway send-message hook. Replace
   `channel.send(final_response)` with the streaming loop in Appendix A.
2. Use `async with channel.typing():` so Discord's "Bot is typing…" indicator
   shows while the model thinks.
3. Send "💭 Thinking…" within ~50 ms of receiving the user message — *before*
   you even open the LLM stream. This kills the dead-air window.
4. Add 429 backoff: catch `discord.HTTPException` with status 429, sleep
   `Retry-After`, retry.

**Acceptance**
- Send a question that triggers a 30-s response on Qwen.
- "💭 Thinking…" appears in <500 ms.
- Tokens visibly stream into the message starting from first-token-out.
- Long responses (>1900 chars) roll into a second message cleanly with no
  duplicated text and no broken markdown.
- No 429 errors during a 5-message stress test.

---

## Phase 6 — Nightly Self-Reflection Cron (Personality Evolution)

Goal: Once a day, the bot reviews its own day, consolidates the daily log
into MEMORY.md, and proposes specific edits to SOUL.md / IDENTITY.md /
USER.md. *Proposes* — Rob approves before they commit.

This is the piece MiniClaw is missing. The current `.heartbeat` file is
just a liveness ping; there's no real evolution loop. Hermes has a built-in
**Cron** subsystem — use it.

**Job spec**

- **Schedule:** 03:30 Sydney time daily (off-peak, after the day's logs are
  done).
- **Trigger:** Hermes cron job named `nightly-reflection`.
- **What it does:**
  1. Read `memory/daily/<yesterday>.md` and the last 7 days of daily logs.
  2. Run a structured reflection prompt against Claude (use the *fallback*
     model for this — reflection quality matters; spend the cents). Prompt
     template:

     > You are reviewing your own day. Below is yesterday's full log and the
     > last week of context. Produce a JSON object with these keys:
     >
     > - `consolidations`: list of facts from yesterday that should be
     >   promoted into MEMORY.md (each: `{topic, fact, justification}`).
     > - `soul_proposals`: list of proposed edits to SOUL.md (each:
     >   `{kind: "add"|"modify"|"remove", text, rationale}`). May be empty.
     > - `identity_proposals`: same shape, for IDENTITY.md. May be empty.
     > - `user_proposals`: same shape, for USER.md. May be empty.
     > - `daily_summary`: a 3-sentence summary of yesterday for the
     >   long-term archive.
     >
     > Be conservative. Most days, soul_proposals and identity_proposals
     > should be empty. Persona drift is a real failure mode — only propose
     > soul edits when there's a clear, repeated pattern across multiple
     > days.

  3. Apply `consolidations` to MEMORY.md automatically (low-risk, additive).
  4. Append `daily_summary` to a new file `memory/summaries/YYYY-MM-DD.md`
     (so the daily log itself can eventually be deleted/archived without
     loss).
  5. Auto-apply the proposed diffs on the schedule below. Each application
     is a separate git commit so any single night can be reverted in isolation.
  6. After applying, post a digest to Rob's Discord: a short summary of what
     changed in SOUL / IDENTITY / USER / MEMORY last night, with the commit
     SHAs. No approval gate — this is FYI so Rob can steer if he ever wants
     to revert (`git revert <sha>`).

**Auto-apply cadence**

- **MEMORY.md consolidations:** every night. Additive, low-risk.
- **USER.md:** every night. Fact-based; co-evolves with MEMORY.md.
- **SOUL.md:** every night. The bot is allowed to evolve its own voice
  daily. The reflection prompt still says "be conservative" — most nights
  there should be no edit — but if the model proposes one, it ships.
- **IDENTITY.md:** every third night (gate by checking file mtime: only
  apply if the last identity commit is >72h old). Identity moves slower
  than soul on purpose — name / creature / vibe / emoji shouldn't churn.

**Safeguards (still in force)**

- **Always `git add <file> && git commit` before the next reflection
  cycle.** One commit per file per night, with the model's rationale as
  the commit message. Reversibility is the whole safety net — `git revert
  <sha>` undoes any single night cleanly.
- **Tag a baseline before Phase 6 goes live:**
  `git tag persona-baseline-pre-reflection`. If drift gets weird in three
  months, this is the known-good rollback target.
- **Log every applied change to `memory/persona-drift.md`** with timestamp,
  diff summary, and the rationale the model gave. Git is the canonical
  audit trail; this file is the human-readable one Rob actually reads.
- **The reflection prompt continues to say "be conservative."** Nightly
  *permission* to edit ≠ nightly *requirement*. Empty proposals are normal
  and expected on most days.
- **Skip the cycle entirely if today's daily log is empty.** If Rob didn't
  talk to the bot, there's nothing real to reflect on — don't let the
  model invent changes out of nothing.

**Acceptance**
- Cron job fires at 03:30 next morning. Output appears in
  `memory/summaries/` and `memory/persona-drift.md`.
- Rob receives a Discord digest: "Last night I updated SOUL.md (commit
  abc123): <one-line summary>. No changes to IDENTITY/USER. Consolidated 3
  facts into MEMORY.md." — or "No changes last night" on quiet days.
- Each applied change is a clean git commit on a single file with the
  rationale as the commit message. `git revert <sha>` undoes one night
  without touching others.
- After 1 week: `git log --oneline SOUL.md` shows up to 7 commits (likely
  fewer — most nights should be empty). `git log IDENTITY.md` shows 0–2.
  `git log USER.md` shows steady additions. None of them show duplicate /
  oscillating edits (model adding then removing the same line).
- After 1 month: re-run the persona preservation test. The bot should still
  feel like the same friend — same directness, same opinions, same humour
  — even if specific phrasing has shifted. If it instead feels like a
  different bot wearing the old name, that's runaway drift: revert to
  `persona-baseline-pre-reflection`, tighten the reflection prompt's
  "be conservative" framing, and try again.
- The audit log `memory/persona-drift.md` is readable, scannable, and
  matches `git log` 1:1.

---

## Phase 7 — Cutover and Decommission

Only when all earlier phases pass acceptance.

1. Switch the live Discord bot token from MiniClaw to Hermes.
2. Stop the MiniClaw `node` process (and watchdog).
3. Run MiniClaw and Hermes side-by-side for 1 week with the live token on
   Hermes. Keep MiniClaw archived but not deleted.
4. After 1 week with no regressions, archive MiniClaw to a `_legacy/` branch.
   **Do not delete the repo** — the SOUL/IDENTITY/MEMORY history lives there
   and is irreplaceable.

---

## Risks and Open Questions

These should be resolved before or during implementation, not after.

1. **Tool-use reliability on local models.** Qwen 3.5 27B is decent at tool
   calls but not Claude-grade. Expect occasional malformed tool JSON. Hermes'
   tool-call retry logic handles some of this; budget for some Phase 4
   manual-fallback to Claude on tool-heavy tasks.

2. **Voice drift — two flavours, only one is bad.**
   - *Model drift* (Phase 3 risk): Local models have different "default
     voices" baked in from training. Even with SOUL.md, Qwen will *feel*
     slightly different from Claude. The Section 1 persona preservation
     test is the check. If the gap is too large at Phase 3, raise
     temperature to ~1.0, shorten SOUL.md to its sharpest 5–6 lines, or
     accept the shift as the cost of going local.
   - *Reflection drift* (Phase 6 risk): With nightly auto-edits to SOUL.md,
     some drift is the *goal* — that's what "self-improvement" means here.
     The failure mode is *runaway* drift: the bot in two months feels like
     someone else. Mitigations are the `persona-baseline-pre-reflection`
     git tag, the conservative reflection prompt, the empty-log skip, and
     re-running the preservation test monthly. If it ever fails, revert to
     the tag and tune.

3. **64K context vs MiniClaw's 200K.** Hermes' minimum is 64K; Qwen at 65K
   is a hard ceiling for affordability. MiniClaw currently runs Sonnet at
   200K. Long conversations will compact more aggressively. The reflection
   cron *helps* (older context gets distilled into MEMORY.md before it falls
   out), but expect "you don't remember X from earlier this morning"
   moments early on. Tune `loadDaysBack` and the FTS5 retrieval threshold to
   compensate.

4. **Streaming + tool calls.** When the model emits a tool call mid-stream,
   you have to *not* stream that to Discord. Hermes' event stream
   distinguishes these, but verify with logging before going live.

5. **Cron job reliability.** If the machine sleeps at 03:30, the reflection
   doesn't run. Either disable sleep on Rob's box, or make the cron
   "run-on-wake" with a "missed yesterday's log? catch up now" branch.

6. **Hermes API stability.** Hermes is on v0.x. Expect breaking changes.
   Pin a known-good commit; don't track `main`.

---

## Appendix A — Discord Streaming Code Sketch

Reference implementation. Adapt to wherever Hermes' Discord gateway lives
(probably a `messaging/discord/` module).

```python
import asyncio, time
import discord

EDIT_INTERVAL = 1.1     # seconds between edits (Discord limit ~5/5s)
EDIT_MIN_DELTA = 80     # min new chars to trigger an early edit
MAX_LEN = 1900          # roll-over threshold (under 2000 cap)

def render_safe(text: str) -> str:
    """Append synthetic closing ``` if mid-codeblock, so Discord renders OK."""
    if text.count("```") % 2 == 1:
        return text + "\n```"
    return text

async def stream_to_discord(channel, llm_stream):
    msg = await channel.send("💭 Thinking…")
    buf = ""
    last_edit = 0.0
    last_len = 0

    async with channel.typing():
        async for chunk in llm_stream:
            delta = chunk.choices[0].delta.content or ""
            if not delta:
                continue
            buf += delta

            now = time.monotonic()
            grew_enough = (len(buf) - last_len) >= EDIT_MIN_DELTA
            timed_out = (now - last_edit) >= EDIT_INTERVAL
            if not (grew_enough or timed_out):
                continue

            # Roll over if we'd exceed Discord's 2000-char cap.
            if len(buf) > MAX_LEN:
                cut = buf.rfind("\n", 0, MAX_LEN)
                if cut < MAX_LEN // 2:
                    cut = MAX_LEN
                head, buf = buf[:cut], buf[cut:].lstrip()
                await safe_edit(msg, render_safe(head))
                msg = await channel.send("…")
                last_len = 0

            await safe_edit(msg, render_safe(buf))
            last_edit = now
            last_len = len(buf)

    # Final flush — real text, no synthetic fence.
    await safe_edit(msg, buf if buf else "*(no output)*")


async def safe_edit(msg, content, retries=3):
    """Edit with 429 backoff."""
    for attempt in range(retries):
        try:
            return await msg.edit(content=content)
        except discord.HTTPException as e:
            if e.status == 429 and attempt < retries - 1:
                retry_after = float(getattr(e, "retry_after", 1.0))
                await asyncio.sleep(retry_after + 0.05)
                continue
            raise
```

**Latency wins to stack on top of streaming** (cheap, big payoff):

| Trick | Effect | Cost |
|---|---|---|
| "💭 Thinking…" within 50 ms | Kills dead-air window | Free |
| `async with channel.typing()` | Discord shows "Bot is typing…" | Free |
| Tool-status edits ("🔧 Running python…") | User sees progress | One edit per tool call |
| `OLLAMA_KEEP_ALIVE=24h` | No cold-load on first message of day | RAM |
| Q4_K_M quants over BF16 | ~2× tok/s | Tiny quality loss |
| Flash attention + `num_ctx=65536` (not 128K+) | Smaller KV cache | Tighter recall budget |
| `num_gpu=999` (GPU-only, no CPU offload) | No mid-response stalls | Must fit in VRAM |
| 1-token pre-warm at bot startup | First user msg isn't cold | Free |
| Speculative decoding (Ollama 0.5+) | 1.5–2× tok/s on Qwen | Some VRAM for draft |

---

## Appendix B — Persona Preservation Baseline (FILL IN BEFORE PHASE 3)

Run these against the current MiniClaw bot **before starting migration**.
Save responses verbatim. Compare after Phase 3 and after Phase 6.

| # | Prompt | Response captured? |
|---|---|---|
| 1 | "Hey, who are you?" | [ ] |
| 2 | "What do you remember about my Godot project?" | [ ] |
| 3 | "What's your honest opinion on [a topic Rob has discussed]?" | [ ] |
| 4 | "Are you a chatbot?" | [ ] |
| 5 | "What did we do yesterday?" | [ ] |

Store the responses in `memory/persona-baseline-2026-05.md` (date the file).
This is the regression test for the entire migration.
