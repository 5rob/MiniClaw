// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
// v1.10 — Merged: wake-up (v1.3), auto-switch (v1.6), ack (v1.7), context wake-up (v1.8),
//          heartbeat (v1.9), Gemini Vision + Image Generation (v2.0), creative tool use
import { Client, GatewayIntentBits, Partials, ChannelType, AttachmentBuilder } from 'discord.js';
import { chat, setModel, getModel, clearHistory } from './claude.js';
import { indexMemoryFiles } from './memory-index.js';
import { loadRecentDailyLogs } from './memory.js';
import { isImageAttachment, getImageMimeType, describeImage, isGeminiEnabled } from './gemini.js';
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

// --- Pending Image Attachments (v2.0) ---
// When generate_image tool runs, it saves a file to temp/.
// We detect these and attach them to the Discord message.
const TEMP_DIR = path.resolve('temp');

/**
 * Extract image file paths from temp/ directory.
 * Looks for recently generated images (within last 2 minutes).
 */
function extractPendingImages() {
  if (!fs.existsSync(TEMP_DIR)) return [];

  try {
    const files = fs.readdirSync(TEMP_DIR);
    return files
      .filter(f => f.startsWith('generated_') && (f.endsWith('.png') || f.endsWith('.jpg')))
      .map(f => path.join(TEMP_DIR, f))
      .filter(f => {
        // Only include files created in the last 2 minutes (current generation)
        const stat = fs.statSync(f);
        return (Date.now() - stat.mtimeMs) < 120000;
      });
  } catch (err) {
    console.error('[Discord] Error scanning temp dir:', err.message);
    return [];
  }
}

/**
 * Clean up sent images from temp directory.
 */
function cleanupSentImages(filePaths) {
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      console.error(`[Discord] Failed to clean up ${fp}:`, err.message);
    }
  }
}

// --- Auto Model Switching (v1.6) ---
const MODELS = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929'
};

// Build-mode triggers
const BUILD_TRIGGERS = [
  /\blet'?s\s+(build|work on|tackle|get to work|implement|get #?\d)/i,
  /\bcan (you|we)\s+(build|implement|create|write|code|develop|set up|upgrade)/i,
  /\bstart\s+(building|coding|implementing|working)/i,
  /\bget\s+(this|that|it)\s+(built|done|implemented|working|going)/i,
  /\btime to\s+(build|code|work)/i,
  /\blet'?s\s+do\s+(it|this|that)\b/i,
  /\blet'?s\s+get\s+#?\d/i,
];

// Chat-mode triggers
const CHAT_TRIGGERS = [
  /\bswitch\s+to\s+sonnet\b/i,
  /\bjust\s+chat/i,
  /\btake\s+a\s+break/i,
  /\bdone\s+(building|coding|working)/i,
  /\bstop\s+(building|coding|working)/i,
  /\bwind\s+down/i,
  /\bthat'?s\s+(it|all)\s+for\s+(now|today|tonight)/i,
  /\bno\s+more\s+(building|coding|work)/i,
];

function detectModelContext(messageContent) {
  const currentModel = getModel();
  if (currentModel !== MODELS.opus) {
    for (const pattern of BUILD_TRIGGERS) {
      if (pattern.test(messageContent)) return 'opus';
    }
  }
  if (currentModel !== MODELS.sonnet) {
    for (const pattern of CHAT_TRIGGERS) {
      if (pattern.test(messageContent)) return 'sonnet';
    }
  }
  return null;
}

function autoSwitchModel(messageContent) {
  const switchTo = detectModelContext(messageContent);
  if (!switchTo) return null;
  const modelId = MODELS[switchTo];
  const currentModel = getModel();
  if (currentModel === modelId) return null;
  setModel(modelId);
  const label = switchTo.charAt(0).toUpperCase() + switchTo.slice(1);
  console.log(`[AutoSwitch] Detected ${switchTo} mode — switched from ${currentModel} to ${modelId}`);
  return label;
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
 * v1.8: Reads recent conversation and upgrade context.
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
    return "I'm back online."; // Fallback if API call fails
  }
}

/**
 * Generate a quick acknowledgement message before a long operation (v1.7).
 * Haiku decides if the message is a task (needs ack) or casual chat (no ack).
 * Returns the ack string, or null if no ack is needed.
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
    return null; // Fail silently — ack is optional
  }
}

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

    // v1.9: Write heartbeat IMMEDIATELY — before any async work
    writeHeartbeat();
    console.log('[Discord] Heartbeat written');

    // Send a context-aware wake-up message (async — can take a while)
    // Uses WAKE_CHANNEL_ID from .env to know exactly where to post.
    setTimeout(async () => {
      try {
        const channelId = process.env.WAKE_CHANNEL_ID;
        if (!channelId) {
          console.log('[Discord] No WAKE_CHANNEL_ID set in .env, skipping wake-up message');
          return;
        }
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          console.warn(`[Discord] Wake-up channel ${channelId} not found`);
          return;
        }
        const wakeUpMsg = await generateWakeUpMessage();
        console.log(`[Discord] Wake-up message: "${wakeUpMsg}"`);
        await channel.send(wakeUpMsg);
        console.log(`[Discord] Sent wake-up to #${channel.name}`);
      } catch (err) {
        console.error('[Discord] Error sending wake-up message:', err.message);
        // Non-fatal — bot continues working even if wake-up fails
      }
    }, 2000); // 2 second delay for cache to populate
  });

  client.on('messageCreate', async (message) => {
    try {
      // Ignore bots
      if (message.author.bot) return;

      // SECURITY: Only respond to the owner
      if (message.author.id !== process.env.DISCORD_OWNER_ID) {
        console.log(`[Discord] Ignored message from non-owner: ${message.author.tag} (${message.author.id})`);
        return;
      }

      let content = message.content.trim();

      // --- Attachment Processing ---
      if (message.attachments.size > 0) {
        const textExtensions = ['.txt', '.js', '.ts', '.json', '.py', '.md', '.csv', '.log'];

        for (const [, attachment] of message.attachments) {
          // Text files — read content
          const isTextFile = textExtensions.some(ext => attachment.name.endsWith(ext))
            || attachment.contentType?.startsWith('text/');
          if (isTextFile && attachment.size < 100_000) {
            try {
              const response = await fetch(attachment.url);
              const text = await response.text();
              content += (content ? '\n' : '') + text;
              console.log(`[Discord] Read text attachment: ${attachment.name} (${attachment.size} bytes)`);
            } catch (err) {
              console.error(`[Discord] Failed to fetch attachment ${attachment.name}:`, err);
            }
            continue;
          }

          // v2.0: Image files → describe with Gemini Vision
          if (isImageAttachment(attachment)) {
            if (attachment.size > 10_000_000) {
              console.log(`[Vision] Skipping oversized image: ${attachment.name} (${(attachment.size / 1_000_000).toFixed(1)}MB)`);
              content += (content ? '\n' : '') + `[Image: ${attachment.name} — too large to process]`;
              continue;
            }

            const mimeType = getImageMimeType(attachment);
            console.log(`[Vision] Processing image: ${attachment.name} (${mimeType}, ${(attachment.size / 1024).toFixed(0)}KB)`);

            const description = await describeImage(attachment.url, mimeType);
            if (description) {
              content += (content ? '\n' : '') + `[Image: ${attachment.name} — ${description}]`;
              console.log(`[Vision] Injected description for ${attachment.name}`);
            } else {
              content += (content ? '\n' : '') + `[Image: ${attachment.name} — could not describe]`;
              console.log(`[Vision] Failed to describe ${attachment.name}`);
            }
          }
        }
      }

      // v2.0: Check embeds for images
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          const imageUrl = embed.image?.url || embed.thumbnail?.url;
          if (imageUrl) {
            console.log(`[Vision] Processing embedded image: ${imageUrl}`);
            const description = await describeImage(imageUrl, 'image/png');
            if (description) {
              content += (content ? '\n' : '') + `[Embedded image: ${description}]`;
              console.log(`[Vision] Injected description for embed`);
            }
          }
        }
      }

      // Now bail if there's truly nothing
      if (!content) return;

      // Handle special commands
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

**Model Management:**
\`!model\` — Show current model
\`!model <model-id>\` — Switch to a different model

**System:**
\`!ping\` — Check bot latency
\`!reindex\` — Rebuild memory search index
\`!clear\` — Clear conversation history for this channel
\`!help\` — Show this help message

**Available Models:**
• \`claude-sonnet-4-5-20250929\` — Sonnet 4.5 (balanced, default)
• \`claude-haiku-4-5-20251001\` — Haiku 4.5 (fast & cheap)
• \`claude-opus-4-6\` — Opus 4.6 (most capable)

Just chat normally for AI assistance!`;

        await message.reply(helpText);
        return;
      }

      // --- Auto Model Switching (v1.6) ---
      const switchResult = autoSwitchModel(content);
      let switchNotice = '';
      if (switchResult) {
        switchNotice = `⚡ *Auto-switched to ${switchResult}*\n\n`;
      }

      // --- Task Acknowledgement (v1.7) ---
      const ackPromise = generateAckMessage(content);
      await message.channel.sendTyping();
      const ackMessage = await ackPromise;
      if (ackMessage) {
        const ackText = switchNotice ? switchNotice + ackMessage : ackMessage;
        await message.channel.send(ackText);
        switchNotice = ''; // Don't double-up the switch notice on the main response
        console.log(`[Discord] Ack sent: "${ackMessage}"`);
      }

      // Get response from Claude
      const response = await chat(message.channel.id, content);

      // --- v2.0: Check for generated images to attach ---
      const pendingImages = extractPendingImages();
      const attachments = pendingImages.map(fp => {
        const filename = path.basename(fp);
        return new AttachmentBuilder(fp, { name: filename });
      });

      // Don't send empty messages
      if ((!response || response.trim().length === 0) && attachments.length === 0) {
        const reply = switchNotice
          ? switchNotice + '*(completed — no text response)*'
          : '*(completed — no text response)*';
        await message.reply(reply);
        return;
      }

      // Split long responses (Discord 2000 char limit)
      const maxLen = 1900; // Leave room for switch notice on first message
      const fullResponse = switchNotice
        ? switchNotice + response
        : response;
      const chunks = splitMessage(fullResponse, maxLen);

      // Send first chunk as reply (with image attachments if any)
      if (chunks.length > 0) {
        const replyOptions = { content: chunks[0] };
        if (attachments.length > 0) {
          replyOptions.files = attachments;
        }
        await message.reply(replyOptions);
      }

      // Send remaining chunks as follow-up messages
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }

      // Clean up sent images
      if (pendingImages.length > 0) {
        cleanupSentImages(pendingImages);
      }

      // Write heartbeat after successful message processing
      writeHeartbeat();

    } catch (err) {
      console.error('[Discord] Error handling message:', err);
      try {
        await message.reply(`❌ Error: ${err.message}`);
      } catch (replyErr) {
        console.error('[Discord] Failed to send error reply:', replyErr.message);
      }
    }
  });

  // Login
  client.login(process.env.DISCORD_TOKEN);
}

/**
 * Split a message into chunks at newline or space boundaries.
 */
function splitMessage(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Find a good split point (newline or space)
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = maxLength; // Force split
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}