# Build Spec: Claude Pro Offload Skill

## Purpose
A skill that offloads expensive Claude API tasks to the free Claude Pro web UI via browser automation. This reduces API token costs by using Rob's existing Claude Pro subscription for heavy tasks like skill building, deep research, and document analysis.

## Problem Statement
- Rob has limited Claude API tokens ($22 remaining)
- Claude Pro subscription is unlimited but only accessible via web UI
- Expensive tasks (Opus builds, deep research) eat through API budget quickly
- Need a way to leverage Pro subscription programmatically

## Solution
Use the existing `browser-control` skill to:
1. Navigate to claude.ai
2. Interact with Claude Code in the web UI
3. Execute expensive tasks there (free via Pro subscription)
4. Capture results and return them
5. Optionally pull code from GitHub if Claude pushes changes

## Core Functionality

### Actions

#### `offload_task`
Send a task to Claude Pro web UI and wait for response.

**Parameters:**
- `task` (required): The task/prompt to send to Claude
- `use_code` (optional, default false): Whether to use Claude Code (terminal access)
- `wait_for_github` (optional): GitHub repo URL to monitor for pushes
- `timeout` (optional, default 600): Max seconds to wait for completion

**Workflow:**
1. Navigate to claude.ai (or create new project if using Code)
2. Wait for page load
3. Type the task into the message input
4. Submit and wait for Claude's response
5. Monitor for completion (detect thinking → response → idle state)
6. Extract the response text
7. If `wait_for_github`, poll GitHub API for new commits
8. Return results

**Example:**
```javascript
{
  action: 'offload_task',
  task: 'Build a skill that does X. Use terminal to create files. Push to GitHub when done.',
  use_code: true,
  wait_for_github: 'https://github.com/5paceman/MiniClaw',
  timeout: 1200
}
```

#### `check_session`
Verify Claude Pro session is still active (not logged out or expired).

**Returns:**
- `active`: boolean
- `project_count`: number (if active)

#### `start_project`
Create a new Claude Code project for isolated work.

**Parameters:**
- `name` (optional): Project name

**Returns:**
- `project_url`: URL of the new project

## Technical Requirements

### Browser State Management
- **Session persistence**: Use browser-control's profile storage to maintain login
- **First-time setup**: Manual login required once (Rob logs in, browser saves session)
- **Session validation**: Check if logged in before each task

### Claude Response Detection
Claude's UI has distinct states we can detect via DOM:

1. **Idle**: Message input is enabled, no loading spinner
2. **Thinking**: Loading animation visible
3. **Responding**: Streaming text appearing
4. **Complete**: Response finished, input re-enabled

**Detection strategy:**
```javascript
// Wait for response to complete
await page.waitForSelector('.message-content:last-child', { timeout: 60000 });
await page.waitForFunction(() => {
  const input = document.querySelector('textarea[placeholder*="Reply"]');
  return input && !input.disabled;
}, { timeout: 600000 }); // 10 min max

// Extract response
const response = await page.evaluate(() => {
  const messages = document.querySelectorAll('.message-content');
  return messages[messages.length - 1].innerText;
});
```

### GitHub Integration (Optional)
If task involves code generation with GitHub push:

1. **Before starting**: Get latest commit SHA via GitHub API
2. **After task**: Poll GitHub API every 10s for new commits
3. **On new commit**: Clone/pull locally, return diff
4. **Timeout**: If no commit after `timeout` seconds, return Claude's response only

**GitHub API call:**
```javascript
const response = await fetch(
  'https://api.github.com/repos/5paceman/MiniClaw/commits',
  { headers: { 'User-Agent': 'MiniClaw' } }
);
const commits = await response.json();
const latestSHA = commits[0].sha;
```

### Error Handling
- **Session expired**: Return error, prompt Rob to re-login
- **Rate limit**: Claude Pro has usage caps — detect "You've reached your limit" message
- **Timeout**: If response takes > `timeout` seconds, return partial results
- **CAPTCHA**: If CAPTCHA appears, return error (can't solve programmatically reliably)

## File Structure
```
skills/claude-pro-offload/
├── handler.js           # Main skill handler (execute function)
├── session-manager.js   # Login state validation
├── response-detector.js # Wait for Claude response completion
├── github-poller.js     # Monitor GitHub for commits
├── SKILL.md            # This file
├── PROGRESS.md         # Build log
└── data/
    └── session.json    # Last-used project URL, login state
```

## Usage Examples

### Example 1: Build a Skill (Expensive Task)
```javascript
// Rob: "Build the nightly reflection skill"
// MiniClaw detects this is expensive (Opus, multi-turn)

const result = await skill_execute('claude-pro-offload', {
  action: 'offload_task',
  task: `Build a Node.js skill called "nightly-reflection" that:
  - Runs at 2am daily via cron
  - Reads daily log and memory files
  - Reflects on the day using Claude Opus
  - Updates SOUL.md and IDENTITY.md if needed
  
  Use Claude Code terminal to create all files.
  Test the code.
  Push to GitHub repo: https://github.com/5paceman/MiniClaw
  `,
  use_code: true,
  wait_for_github: 'https://github.com/5paceman/MiniClaw',
  timeout: 1800 // 30 minutes
});

// Result:
{
  success: true,
  response: "I've built the skill and pushed to GitHub...",
  github_commit: "abc123",
  files_changed: ["skills/nightly-reflection/handler.js", ...]
}
```

### Example 2: Deep Research (Token-Heavy)
```javascript
const result = await skill_execute('claude-pro-offload', {
  action: 'offload_task',
  task: `Research the current state of real-time TTS systems. Compare:
  - Qwen3-TTS vs Bark vs Tortoise
  - RTF performance on consumer GPUs
  - Voice cloning quality
  - Instruction control capabilities
  
  Provide a detailed report with sources.`,
  use_code: false,
  timeout: 600
});
```

### Example 3: Document Analysis
```javascript
const result = await skill_execute('claude-pro-offload', {
  action: 'offload_task',
  task: `Analyze this architecture document and suggest improvements:
  
  [paste STREAMING_TTS_ARCHITECTURE.md content]
  
  Focus on performance bottlenecks and implementation risks.`,
  use_code: false
});
```

## Integration with Existing System

### When to Use This Skill
MiniClaw should **automatically decide** when to offload based on:

1. **Task cost estimation**: If a task would cost >$0.50 in API calls
2. **Task type**: Code generation, deep research, large document processing
3. **Token budget**: If API budget is low (<$5 remaining)

**Decision logic (in tools.js or discord.js):**
```javascript
async function shouldOffloadTask(taskType, estimatedTokens) {
  const costPerToken = taskType === 'opus' ? 0.000015 : 0.000003;
  const estimatedCost = estimatedTokens * costPerToken;
  const remainingBudget = await getRemainingAPIBudget();
  
  // Offload if:
  // - Task is expensive (>$0.50) OR
  // - Budget is low (<$5) and task is moderate (>$0.10)
  return estimatedCost > 0.50 || (remainingBudget < 5 && estimatedCost > 0.10);
}
```

### Fallback Strategy
If offload fails (session expired, timeout, error):
1. Log the failure
2. Ask Rob: "Offload to web UI failed. Use API anyway? (costs ~$X)"
3. Wait for confirmation before proceeding

## Performance Expectations

### Latency
- **API (current)**: 2-10 minutes for skill builds
- **Web UI offload**: 5-20 minutes (slower due to browser overhead)
- **Trade-off**: Acceptable for expensive one-off tasks

### Cost Savings
- **Skill build**: $2-5 saved per build
- **Deep research**: $0.50-2 saved per task
- **Document analysis**: $0.10-0.50 saved

**ROI:** If we build 5 skills and do 10 research tasks, we save ~$15-30 in API costs.

## Risks & Mitigations

### Risk 1: Session Expiration
- **Mitigation**: Check session before each task, prompt Rob to re-login if expired

### Risk 2: Claude Pro Usage Limits
- **Mitigation**: Detect "usage limit" message, fall back to API with confirmation

### Risk 3: Browser Automation Fragility
- **Mitigation**: Use robust selectors, wait conditions, screenshot on error for debugging

### Risk 4: GitHub Push Never Happens
- **Mitigation**: Timeout after N minutes, return Claude's response even if no commit

## Future Enhancements
1. **Parallel offloading**: Multiple browser instances for concurrent tasks
2. **Smart retry**: Auto-retry with refined prompts if task fails
3. **Result validation**: Parse Claude's response to verify task completion
4. **Cost tracking**: Log savings vs API costs for transparency

## Success Criteria
- ✅ Can send a task to Claude Pro web UI and get response
- ✅ Can detect when Claude finishes responding
- ✅ Can monitor GitHub for code pushes
- ✅ Session persists across bot restarts
- ✅ Saves >50% on expensive tasks compared to API

## Dependencies
- **browser-control skill** (already built)
- **GitHub API** (no auth needed for public repos)
- **Node.js fetch** (built-in)

## Reference Implementation
The existing `browser-control` skill already handles:
- Chromium launch with persistent profile
- Navigation and element interaction
- Screenshots for debugging
- Session persistence

This skill builds on top of that — no new browser infrastructure needed.

---

**Estimated build time:** 1-2 hours for Claude Code  
**Complexity:** Medium (browser automation + state detection)  
**Impact:** High (major cost savings on expensive tasks)
