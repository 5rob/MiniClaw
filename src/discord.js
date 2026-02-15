// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
// v1.13 — Three-tier model routing (Haiku/Sonnet/Opus), manual switch commands, auto-reset after builds
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { chat, setModel, getModel, clearHistory } from './claude.js';
import { indexMemoryFiles } from './memory-index.js';
import { loadRecentDailyLogs } from './memory.js';
import { isGeminiEnabled } from './gemini.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // needed for DMs
});

// --- Heartbeat (v1.9) ---
const HEARTBEAT_FILE = path.resolve('.heartbeat');

function writeHeartbeat() {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' })
    }));
  } catch (err) {
    console.error('[Discord] Failed to write heartbeat:', err.message);
  }
}

// --- Three-Tier Model Routing (v1.13) ---
const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6'
};

// Messages that need Opus — building, coding, complex dev work
const BUILD_TRIGGERS = [
  /\blet'?s\s+(build|work on|tackle|get to work|implement|get #?\d)/i,
  /\bcan (you|we)\s+(build|implement|create|write|code|develop|set up|upgrade)/i,
  /\bstart\s+(building|coding|implementing|working)/i,
  /\bget\s+(this|that|it)\s+(built|done|implemented|working|going)/i,
  /\btime to\s+(build|code|work)/i,
  /\blet'?s\s+do\s+(it|this|that)\b/i,
  /\blet'?s\s+get\s+#?\d/i,
  /\bgenerate.+prompt/i,
  /\bkick off.+(build|skill)/i,
];

// Messages that need Sonnet — tool use, reasoning, questions needing memory/calendar/search
const TOOL_TRIGGERS = [
  // Calendar
  /\b(calendar|schedule|appointment|event|meeting|what'?s on|free time|busy)\b/i,
  /\b(remind|reminder|tomorrow|next week|this week)\b/i,
  // Memory operations
  /\b(remember|forget|what do you know|do you recall|you mentioned)\b/i,
  /\b(save|store|write|update|note)\s+(this|that|it|down)\b/i,
  // Search / research / web
  /\b(search|look up|find|fetch|web|browse|research)\b/i,
  // Image generation
  /\b(generate|create|make|draw)\s+(an?\s+)?(image|picture|photo|art|illustration)\b/i,
  // File operations
  /\b(read|write|edit|create|delete|list)\s+(file|files|the file|my file)/i,
  // Skill/tool management (non-build)
  /\b(list|show|check|inspect)\s+(skills|tools|projects)/i,
  // Process management
  /\b(promote|restart|deploy|staging|status)\b/i,
  // Questions that likely need memory search or reasoning
  /\bwhat (did|was|were|is|are|has)\b.{10,}/i,
  /\b(how|why|when|where)\b.{10,}\?$/i,
  // Explicit tool requests
  /\b(use|call|run|execute|invoke)\s+(the\s+)?\w+\s+tool\b/i,
];

// Wind-down triggers — switch back to Haiku
const CHAT_TRIGGERS = [
  /\bjust\s+chat/i,
  /\btake\s+a\s+break/i,
  /\bdone\s+(building|coding|working)/i,
  /\bstop\s+(building|coding|working)/i,
  /\bwind\s+down/i,
  /\bthat'?s\s+(it|all)\s+for\s+(now|today|tonight)/i,
  /\bno\s+more\s+(building|coding|work)/i,
  /\bswitch\s+to\s+haiku\b/i,
];

// Build completion patterns — auto-reset from Opus to Haiku
const BUILD_DONE_PATTERNS = [
  /build\s+(is\s+)?(complete|done|finished|succeeded)/i,
  /successfully\s+built/i,
  /skill\s+(is\s+)?ready/i,
  /deployed?\s+to\s+staging/i,
  /promotion\s+(complete|done|succeeded)/i,
  /want\s+to\s+test/i,
];

/**
 * Detect which model tier a message needs.
 * Returns 'opus', 'sonnet', 'haiku', or null (no change).
 */
function detectModelContext(messageContent) {
  // Build triggers → Opus (highest priority)
  for (const pattern of BUILD_TRIGGERS) {
    if (pattern.test(messageContent)) return 'opus';
  }

  // Tool triggers → Sonnet
  for (const pattern of TOOL_TRIGGERS) {
    if (pattern.test(messageContent)) return 'sonnet';
  }

  // Wind-down triggers → Haiku
  for (const pattern of CHAT_TRIGGERS) {
    if (pattern.test(messageContent)) return 'haiku';
  }

  // No trigger matched — return null (use current model, which defaults to Haiku)
  return null;
}

/**
 * Apply auto model switch if context detection finds a trigger.
 * Returns a string describing the switch, or null if no switch happened.
 */
function autoSwitchModel(messageContent) {
  const switchTo = detectModelContext(messageContent);
  if (!switchTo) return null;

  const modelId = MODELS[switchTo];
  const currentModel = getModel();

  if (currentModel === modelId) return null; // Already on the right model

  setModel(modelId);
  const label = switchTo.charAt(0).toUpperCase() + switchTo.slice(1);
  console.log(`[AutoSwitch] ${switchTo} mode — ${currentModel} → ${modelId}`);
  return label;
}

/**
 * Check if a response indicates build completion. If so, auto-reset to Haiku.
 */
function checkBuildComplete(responseText) {
  if (getModel() !== MODELS.opus) return;

  for (const pattern of BUILD_DONE_PATTERNS) {
    if (pattern.test(responseText)) {
      setModel(MODELS.haiku);
      console.log('[AutoSwitch] Build complete — returning to Haiku');
      return;
    }
  }
}

// --- Haiku Quick-Call Helper (shared by wake-up and ack) ---
const haiku = new Anthropic(); // Uses ANTHROPIC_API_KEY from env

async function haikuQuickCall(system, userContent, maxTokens = 100) {
  const response = await haiku.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userContent }]
  });
  return response.content[0]?.text?.trim() || null;
}

/**
 * Gather context for the wake-up message (v1.8):
 * - Recent daily log entries
 * - Upgrade context file (if this is a post-promotion restart)
 */
function gatherWakeUpContext() {
  const context = { recentActivity: null, upgrade: null };

  try {
    const logs = loadRecentDailyLogs(1);
    if (logs.length > 0 && logs[0].content) {
      const content = logs[0].content;
      const tail = content.length > 800 ? content.slice(-800) : content;
      context.recentActivity = tail;
    }
  } catch (err) {
    console.error('[Discord] Failed to read daily logs for wake-up:', err.message);
  }

  try {
    const upgradeContextPath = path.resolve('.upgrade-context');
    if (fs.existsSync(upgradeContextPath)) {
      const raw = fs.readFileSync(upgradeContextPath, 'utf-8');
      context.upgrade = JSON.parse(raw);
      fs.unlinkSync(upgradeContextPath);
      console.log('[Discord] Found upgrade context:', context.upgrade.version);
    }
  } catch (err) {
    console.error('[Discord] Failed to read upgrade context:', err.message);
  }

  return context;
}

/**
 * Generate a context-aware wake-up message using a quick Haiku call.
 */
async function generateWakeUpMessage() {
  try {
    const context = gatherWakeUpContext();

    let contextBlock = '';

    if (context.upgrade) {
      contextBlock += `\n\nUPGRADE CONTEXT: Just upgraded to version ${context.upgrade.version}. Changes: ${context.upgrade.reason || 'No details provided.'}`;
    }

    if (context.recentActivity) {
      contextBlock += `\n\nRECENT ACTIVITY (tail of today's log):\n${context.recentActivity}`;
    }

    const systemPrompt = `You are an AI assistant who just came back online after a restart. Generate a single short wake-up message (1-2 sentences max). Be witty, dry, and casual — not corporate or overly enthusiastic. You have personality: think dry humour, understated competence, maybe a little self-aware about being rebooted.

${context.upgrade ? 'You just got upgraded — reference what changed if it sounds interesting. Keep it brief.' : ''}
${context.recentActivity ? 'You have context about what was happening before you went down. You can reference it naturally if relevant — like picking up a conversation. But keep it SHORT.' : ''}

Examples of the vibe (don't repeat these exactly, come up with something fresh):
- "Back online. What'd I miss?"
- "I'm here. Memory loaded, coffee pending."
- "Rebooted. Still me — I checked."
- "Woke up, read my diary. Caught up now."
- "Back. Did you try turning me off and on again? ...oh wait."

Just output the message, nothing else. No quotes, no preamble.`;

    const userPrompt = contextBlock || 'No context available — generate a generic wake-up message.';

    const text = await haikuQuickCall(systemPrompt, userPrompt, 150);
    return text || "I'm back.";
  } catch (err) {
    console.error('[Discord] Failed to generate wake-up message:', err.message);
    return "I'm back online.";
  }
}

/**
 * Generate a quick acknowledgement message before a long operation (v1.7).
 * Only used when model is Sonnet or Opus (Haiku responds fast enough to skip ack).
 */
async function generateAckMessage(userMessage) {
  try {
    const text = await haikuQuickCall(
      `You are an AI assistant's quick-response module. Your job: decide if the user's message is a task/request that will take time to process, or just casual conversation.

If it IS a task or request (building something, searching for info, reading files, making changes, creating events, etc.):
→ Respond with a brief, casual acknowledgement (1 short sentence max). Be natural and conversational, not corporate. Vary your responses. Can reference what they asked for.
Examples: "On it.", "Give me a sec.", "Sure thing, working on it.", "Checking now.", "Building that now, one sec.", "Let me take a look."

If it is NOT a task (greetings, casual chat, questions that need discussion, opinions, short replies like "yes", "no", "thanks", "nice", feedback on something you just did):
→ Respond with exactly: SKIP

Just output the ack message or SKIP, nothing else. No quotes, no preamble.`,
      userMessage,
      60
    );

    if (!text || text === 'SKIP') return null;
    return text;
  } catch (err) {
    console.error('[Discord] Failed to generate ack message:', err.message);
    return null;
  }
}

// --- Image attachment cleanup helper (v2.0) ---
function cleanupSentImages(filePaths) {
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      console.error(`[Discord] Failed to clean up ${fp}:`, err.message);
    }
  }
}

// Lazy import for image extraction (only if gemini is available)
let extractPendingImages;
let AttachmentBuilder;

export function startDiscord() {
  if (!process.env.DISCORD_TOKEN) {
    console.error('[Discord] ERROR: No DISCORD_TOKEN in .env file');
    console.error('[Discord] Please add your Discord bot token to .env');
    process.exit(1);
  }

  if (!process.env.DISCORD_OWNER_ID) {
    console.error('[Discord] ERROR: No DISCORD_OWNER_ID in .env file');
    console.error('[Discord] Please add your Discord user ID to .env');
    process.exit(1);
  }

  // v2.0: Log Gemini status on startup
  if (isGeminiEnabled()) {
    console.log('[Discord] Gemini enabled (Vision + Image Generation) (v1.10)');
  } else {
    console.log('[Discord] Gemini disabled — no GEMINI_API_KEY in .env');
  }

  client.on('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
    console.log(`[Discord] Owner ID: ${process.env.DISCORD_OWNER_ID}`);
    console.log(`[Discord] Listening for messages...`);

    // v1.9: Write heartbeat IMMEDIATELY
    writeHeartbeat();
    console.log('[Discord] Heartbeat written');

    // Send a context-aware wake-up message
    const wakeChannelId = process.env.WAKE_CHANNEL_ID;
    if (wakeChannelId) {
      try {
        const channel = await client.channels.fetch(wakeChannelId);
        if (channel) {
          const wakeMsg = await generateWakeUpMessage();
          await channel.send(wakeMsg);
          console.log(`[Discord] Wake-up message sent to #${channel.name || wakeChannelId}`);
        }
      } catch (err) {
        console.error('[Discord] Failed to send wake-up message:', err.message);
      }
    }
  });

  client.on('messageCreate', async (message) => {
    // Ignore bots and non-owner messages
    if (message.author.bot) return;
    if (message.author.id !== process.env.DISCORD_OWNER_ID) return;

    // Update heartbeat on every message
    writeHeartbeat();

    const content = message.content.trim();
    if (!content) return;

    // --- Command handling ---

    // Quick model switch commands (v1.13)
    if (content === '!haiku') {
      setModel(MODELS.haiku);
      await message.reply('Switched to **Haiku** ⚡ (fast & cheap chat mode — no tools)');
      return;
    }
    if (content === '!sonnet') {
      setModel(MODELS.sonnet);
      await message.reply('Switched to **Sonnet** 🎵 (balanced, tool-capable)');
      return;
    }
    if (content === '!opus') {
      setModel(MODELS.opus);
      await message.reply('Switched to **Opus** 🔥 (full power, build mode)');
      return;
    }

    if (content.startsWith('!model')) {
      const parts = content.split(/\s+/);
      if (parts.length === 1) {
        await message.reply(`Current model: \`${getModel()}\``);
      } else {
        const newModel = parts[1];
        setModel(newModel);
        await message.reply(`Model set to: \`${newModel}\``);
      }
      return;
    }

    if (content === '!ping') {
      const startTime = Date.now();
      const msg = await message.reply('Pong!');
      await msg.edit(`Pong! Latency: ${Date.now() - startTime}ms`);
      return;
    }

    if (content === '!reindex') {
      await message.reply('Reindexing memory...');
      try {
        await indexMemoryFiles();
        await message.channel.send('✅ Memory index updated');
      } catch (err) {
        await message.channel.send(`❌ Reindexing failed: ${err.message}`);
      }
      return;
    }

    if (content === '!clear') {
      clearHistory(message.channel.id);
      await message.reply('Conversation history cleared for this channel.');
      return;
    }

    if (content === '!help') {
      const helpText = `**MiniClaw Commands**

**Quick Model Switch:**
\`!haiku\` — Fast & cheap chat mode (no tools)
\`!sonnet\` — Balanced mode with tools
\`!opus\` — Full power build mode

**Model Management:**
\`!model\` — Show current model
\`!model <model-id>\` — Switch to a specific model ID

**System:**
\`!ping\` — Check bot latency
\`!reindex\` — Rebuild memory search index
\`!clear\` — Clear conversation history for this channel
\`!help\` — Show this help message

**Auto-routing:** Messages are automatically routed to the right model tier based on content. Build requests → Opus, tool-needing tasks → Sonnet, casual chat → Haiku.`;

      await message.reply(helpText);
      return;
    }

    // --- Auto Model Switching (v1.13: three-tier) ---
    const switchResult = autoSwitchModel(content);
    let switchNotice = '';
    if (switchResult) {
      switchNotice = `⚡ *Auto-switched to ${switchResult}*\n\n`;
    }

    // --- Task Acknowledgement (v1.7) ---
    // Only send ack for Sonnet/Opus — Haiku is fast enough to skip it
    const currentModel = getModel();
    const isHaiku = currentModel === MODELS.haiku || currentModel.includes('haiku');
    let ackMessage = null;

    if (!isHaiku) {
      const ackPromise = generateAckMessage(content);
      await message.channel.sendTyping();
      ackMessage = await ackPromise;
      if (ackMessage) {
        const ackText = switchNotice ? switchNotice + ackMessage : ackMessage;
        await message.channel.send(ackText);
        switchNotice = '';
        console.log(`[Discord] Ack sent: "${ackMessage}"`);
      }
    }

    // Send typing indicator (always, even for Haiku)
    if (isHaiku || !ackMessage) {
      await message.channel.sendTyping();
    }

    try {
      // Get response from Claude
      const response = await chat(message.channel.id, content);

      // v1.13: Check if build is complete — auto-reset to Haiku
      checkBuildComplete(response || '');

      // v2.0: Check for generated images to attach
      let attachments = [];
      try {
        if (!extractPendingImages) {
          const gemini = await import('./gemini.js');
          extractPendingImages = gemini.extractPendingImages || (() => []);
          const djs = await import('discord.js');
          AttachmentBuilder = djs.AttachmentBuilder;
        }
        const pendingImages = extractPendingImages();
        attachments = pendingImages.map(fp => {
          const filename = path.basename(fp);
          return new AttachmentBuilder(fp, { name: filename });
        });
      } catch (e) {
        // Gemini not available, no images
      }

      // Don't send empty messages
      if ((!response || response.trim().length === 0) && attachments.length === 0) {
        const reply = switchNotice
          ? switchNotice + '*(completed — no text response)*'
          : '*(completed — no text response)*';
        await message.reply(reply);
        return;
      }

      // Split long responses (Discord 2000 char limit)
      const maxLen = 1900;
      const fullResponse = switchNotice
        ? switchNotice + response
        : response;

      if (fullResponse.length <= maxLen && attachments.length === 0) {
        await message.reply(fullResponse);
      } else if (fullResponse.length <= maxLen) {
        await message.reply({ content: fullResponse, files: attachments });
        cleanupSentImages(attachments.map(a => a.attachment || ''));
      } else {
        const chunks = splitMessage(fullResponse, maxLen);
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0 && attachments.length > 0) {
            await message.reply({ content: chunks[i], files: attachments });
            cleanupSentImages(attachments.map(a => a.attachment || ''));
          } else if (i === 0) {
            await message.reply(chunks[i]);
          } else {
            await message.channel.send(chunks[i]);
          }
        }
      }
    } catch (err) {
      console.error('[Discord] Error:', err);
      const errorMsg = switchNotice
        ? switchNotice + `Error: ${err.message}`
        : `Error: ${err.message}`;
      await message.reply(errorMsg);
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

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
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