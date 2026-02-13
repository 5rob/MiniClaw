// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
// v2.0 — Gemini Vision + Image Generation
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
// Claude's response will reference the file path. We detect these
// and attach them to the Discord message.
const TEMP_DIR = path.resolve('temp');

/**
 * Extract image file paths from Claude's response text.
 * Looks for paths in temp/ directory that exist on disk.
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

// --- Haiku Quick-Call Helper ---
const haiku = new Anthropic();

async function haikuQuickCall(system, userContent, maxTokens = 100) {
  const response = await haiku.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userContent }]
  });
  return response.content[0]?.text?.trim() || null;
}

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

async function generateWakeUpMessage() {
  try {
    const context = gatherWakeUpContext();
    let contextBlock = '';
    if (context.upgrade) {
      contextBlock += `\n\nUPGRADE CONTEXT: Just upgraded to version ${context.upgrade.version}. Files promoted: ${context.upgrade.promoted.join(', ')}.`;
    }
    if (context.recentActivity) {
      contextBlock += `\n\nRECENT CONVERSATION (tail):\n${context.recentActivity}`;
    }

    const systemPrompt = `You are an AI assistant who just came back online after a restart. Generate a single short wake-up message (1-2 sentences max). Be witty, dry, and casual — not corporate or overly enthusiastic. You have personality: think dry humour, understated competence, maybe a little self-aware about being rebooted.

IMPORTANT: You have context about what was happening before you restarted. Use it! Reference what you were working on, acknowledge the upgrade if there was one, or comment on the conversation. Don't be generic — show you remember.

If there's upgrade context, acknowledge the new version naturally.
If there's recent conversation context, reference what was being discussed or built.
If there's both, blend them naturally.
If there's neither, fall back to a generic but personality-filled message.

Keep it brief and natural. Just output the message, nothing else. No quotes, no preamble.`;

    const userPrompt = contextBlock || 'No context available — generate a generic wake-up message.';
    const text = await haikuQuickCall(systemPrompt, userPrompt, 150);
    return text || "I'm back.";
  } catch (err) {
    console.error('[Discord] Failed to generate wake-up message:', err.message);
    return "I'm back online.";
  }
}

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

export function startDiscord() {
  if (!process.env.DISCORD_TOKEN) {
    console.error('[Discord] ERROR: No DISCORD_TOKEN in .env file');
    process.exit(1);
  }

  if (!process.env.DISCORD_OWNER_ID) {
    console.error('[Discord] ERROR: No DISCORD_OWNER_ID in .env file');
    process.exit(1);
  }

  // v2.0: Log Gemini status on startup
  if (isGeminiEnabled()) {
    console.log('[Discord] Gemini enabled (Vision + Image Generation) (v2.0)');
  } else {
    console.log('[Discord] Gemini disabled — no GEMINI_API_KEY in .env');
  }

  client.on('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
    console.log(`[Discord] Owner ID: ${process.env.DISCORD_OWNER_ID}`);
    console.log(`[Discord] Listening for messages...`);

    writeHeartbeat();
    console.log('[Discord] Heartbeat written');

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
      }
    }, 2000);
  });

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (message.author.id !== process.env.DISCORD_OWNER_ID) {
        console.log(`[Discord] Ignored message from non-owner: ${message.author.tag} (${message.author.id})`);
        return;
      }

      let content = message.content.trim();

      // --- Attachment Processing ---
      if (message.attachments.size > 0) {
        const textExtensions = ['.txt', '.js', '.ts', '.json', '.py', '.md', '.csv', '.log'];

        for (const [, attachment] of message.attachments) {
          // Text files
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

      // Check embeds for images
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

      if (!content) return;

      // Handle special commands
      if (content.startsWith('!model ')) {
        const newModel = content.slice(7).trim();
        const result = setModel(newModel);
        await message.reply(result);
        return;
      }
      if (content === '!model') { await message.reply(`Current model: \`${getModel()}\``); return; }
      if (content === '!ping') {
        const startTime = Date.now();
        const msg = await message.reply('Pong!');
        await msg.edit(`Pong! Latency: ${Date.now() - startTime}ms`);
        return;
      }
      if (content === '!reindex') {
        await message.reply('Reindexing memory...');
        try { await indexMemoryFiles(); await message.channel.send('✅ Memory index updated'); }
        catch (err) { await message.channel.send(`❌ Reindexing failed: ${err.message}`); }
        return;
      }
      if (content === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('Conversation history cleared for this channel.');
        return;
      }
      if (content === '!help') {
        const helpText = `**MiniClaw Commands**\n\n**Model Management:**\n\`!model\` — Show current model\n\`!model <model-id>\` — Switch to a different model\n\n**System:**\n\`!ping\` — Check bot latency\n\`!reindex\` — Rebuild memory search index\n\`!clear\` — Clear conversation history for this channel\n\`!help\` — Show this help message`;
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
        switchNotice = '';
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
          ? switchNotice + "✅ *(done — tools executed, no text response)*"
          : "✅ *(done — tools executed, no text response)*";
        await message.reply(reply);
        return;
      }

      const fullResponse = switchNotice + (response || '');

      // Send with or without image attachments
      if (fullResponse.length <= 2000) {
        if (attachments.length > 0) {
          await message.reply({ content: fullResponse || null, files: attachments });
        } else {
          await message.reply(fullResponse);
        }
      } else {
        // Split long messages — attach images to the last chunk
        const chunks = splitMessage(fullResponse, 2000);
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0) {
            await message.reply(chunks[i]);
          } else if (i === chunks.length - 1 && attachments.length > 0) {
            await message.channel.send({ content: chunks[i], files: attachments });
          } else {
            await message.channel.send(chunks[i]);
          }
        }
      }

      // Clean up temp files after sending
      if (pendingImages.length > 0) {
        cleanupSentImages(pendingImages);
      }

    } catch (err) {
      console.error('[Discord] Error handling message:', err);
      try {
        const errorMsg = err.message.length > 500 ? err.message.slice(0, 500) + '...' : err.message;
        await message.reply(`❌ Error: ${errorMsg}`);
      } catch (replyErr) {
        console.error('[Discord] Failed to send error message:', replyErr);
      }
    }
  });

  client.on('error', (err) => console.error('[Discord] Client error:', err));
  client.on('warn', (warn) => console.warn('[Discord] Client warning:', warn));

  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('[Discord] Login failed:', err.message);
    process.exit(1);
  });
}

function splitMessage(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
