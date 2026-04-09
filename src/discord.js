// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
// v1.18 — Gemma default routing with auto-upgrade to Claude
import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import { chat, forceGemmaE4B, forceGemma31B, forceSonnet, forceOpus, getModelStatus } from './gemma.js';
import { setModel as claudeSetModel, getModel as claudeGetModel, clearHistory } from './claude.js';
import { indexMemoryFiles } from './memory-index.js';
import { loadRecentDailyLogs, appendDailyLog } from './memory.js';
import { isGeminiEnabled, isImageAttachment, getImageMimeType, describeImage } from './gemini.js';
import { drainPendingAttachments } from './pending-attachments.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
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

// --- Conversation Context Buffer (v1.14) ---
const conversationBuffers = new Map();
const BUFFER_SIZE = 5;
const BUFFER_TIMEOUT_MS = 30 * 60 * 1000;

function addToConversationBuffer(channelId, role, content) {
  if (!conversationBuffers.has(channelId)) {
    conversationBuffers.set(channelId, []);
  }

  const buffer = conversationBuffers.get(channelId);

  if (buffer.length > 0) {
    const lastTimestamp = new Date(buffer[buffer.length - 1].timestamp).getTime();
    if (Date.now() - lastTimestamp > BUFFER_TIMEOUT_MS) {
      buffer.length = 0;
      console.log(`[Discord] Cleared stale conversation buffer for channel ${channelId}`);
    }
  }

  buffer.push({
    role,
    content: content.slice(0, 500),
    timestamp: new Date().toISOString()
  });

  while (buffer.length > BUFFER_SIZE) {
    buffer.shift();
  }
}

function getConversationBuffer(channelId) {
  const buffer = conversationBuffers.get(channelId);
  if (!buffer || buffer.length === 0) return null;

  const lastTimestamp = new Date(buffer[buffer.length - 1].timestamp).getTime();
  if (Date.now() - lastTimestamp > BUFFER_TIMEOUT_MS) {
    conversationBuffers.delete(channelId);
    return null;
  }

  return buffer;
}

function seedBufferFromDailyLog(channelId) {
  try {
    const logs = loadRecentDailyLogs(1);
    if (logs.length === 0 || !logs[0].content) {
      console.log('[Discord] No daily log to seed buffer from — starting with empty buffer');
      return;
    }

    const logContent = logs[0].content;
    const lines = logContent.split('\n');
    const messages = [];

    for (const line of lines) {
      const userMatch = line.match(/^\*\*(\d{2}:\d{2})\s*[ap]m\*\*\s*—\s*User:\s*(.+)$/i);
      const assistantMatch = line.match(/^\*\*(\d{2}:\d{2})\s*[ap]m\*\*\s*—\s*Assistant:\s*(.+)$/i);

      if (userMatch) {
        messages.push({
          role: 'user',
          content: userMatch[2].trim().slice(0, 500),
          timestamp: new Date().toISOString()
        });
      } else if (assistantMatch) {
        messages.push({
          role: 'assistant',
          content: assistantMatch[2].trim().slice(0, 500),
          timestamp: new Date().toISOString()
        });
      }
    }

    const seedMessages = messages.slice(-BUFFER_SIZE);
    if (seedMessages.length > 0) {
      conversationBuffers.set(channelId, seedMessages);
      console.log(`[Discord] Seeded conversation buffer with ${seedMessages.length} messages from daily log`);
    } else {
      console.log('[Discord] No messages found in daily log — starting with empty buffer');
    }
  } catch (err) {
    console.error('[Discord] Failed to seed buffer from daily log:', err.message);
  }
}

// --- Haiku Quick-Call Helper (for wake/ack only) ---
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

async function generateWakeUpMessage(channelId = null) {
  try {
    const context = gatherWakeUpContext();

    let contextBlock = '';

    if (context.upgrade) {
      contextBlock += `\n\nUPGRADE CONTEXT: Just upgraded to version ${context.upgrade.version}. Changes: ${context.upgrade.reason || 'No details provided.'}`;
    }

    if (context.recentActivity) {
      contextBlock += `\n\nRECENT ACTIVITY (tail of today's log):\n${context.recentActivity}`;
    }

    if (channelId) {
      const conversationContext = getConversationBuffer(channelId);
      if (conversationContext && conversationContext.length > 0) {
        contextBlock += `\n\nRECENT CONVERSATION:\n`;
        for (const msg of conversationContext) {
          const label = msg.role === 'user' ? 'Rob' : 'You';
          contextBlock += `${label}: ${msg.content}\n`;
        }
      }
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

// --- Attachment cleanup helper ---
function cleanupSentFiles(filePaths) {
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      console.error(`[Discord] Failed to clean up ${fp}:`, err.message);
    }
  }
}

// --- Attachment Processing (v1.15) ---
const TEXT_EXTENSIONS = ['.txt', '.md', '.js', '.ts', '.json', '.csv', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.log', '.sh', '.bat', '.ps1', '.env.example'];
const MAX_TEXT_ATTACHMENT_SIZE = 50000;

function isTextAttachment(attachment) {
  const ext = path.extname(attachment.name || '').toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext)) return true;
  if (attachment.contentType && attachment.contentType.startsWith('text/')) return true;
  return false;
}

async function processAttachments(message) {
  if (!message.attachments || message.attachments.size === 0) return '';

  const parts = [];

  for (const [, attachment] of message.attachments) {
    try {
      if (isGeminiEnabled() && isImageAttachment(attachment)) {
        const mimeType = getImageMimeType(attachment);
        console.log(`[Attachments] Processing image: ${attachment.name} (${mimeType})`);
        const description = await describeImage(attachment.url, mimeType);
        if (description) {
          parts.push(`[Image: ${attachment.name}]\n${description}`);
        } else {
          parts.push(`[Image: ${attachment.name} — could not describe]`);
        }
        continue;
      }

      if (isTextAttachment(attachment)) {
        if (attachment.size > MAX_TEXT_ATTACHMENT_SIZE) {
          parts.push(`[File: ${attachment.name} — too large to read (${(attachment.size / 1024).toFixed(1)}KB, max ${MAX_TEXT_ATTACHMENT_SIZE / 1000}KB)]`);
          continue;
        }

        console.log(`[Attachments] Reading text file: ${attachment.name} (${(attachment.size / 1024).toFixed(1)}KB)`);
        const response = await fetch(attachment.url);
        if (response.ok) {
          const text = await response.text();
          parts.push(`[File: ${attachment.name}]\n${text}`);
        } else {
          parts.push(`[File: ${attachment.name} — failed to download (HTTP ${response.status})]`);
        }
        continue;
      }

      parts.push(`[Attachment: ${attachment.name} (${attachment.contentType || 'unknown type'}, ${(attachment.size / 1024).toFixed(1)}KB)]`);

    } catch (err) {
      console.error(`[Attachments] Error processing ${attachment.name}:`, err.message);
      parts.push(`[Attachment: ${attachment.name} — error: ${err.message}]`);
    }
  }

  if (parts.length === 0) return '';
  return '\n\n--- Attached Content ---\n' + parts.join('\n\n') + '\n--- End Attached Content ---\n\n';
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

  if (isGeminiEnabled()) {
    console.log('[Discord] Gemini enabled (Vision + Image Generation) (v1.10)');
  } else {
    console.log('[Discord] Gemini disabled — no GEMINI_API_KEY in .env');
  }

  console.log('[Discord] Gemma routing enabled — defaults to local E4B, auto-upgrades to Claude when needed (v1.18)');

  client.on('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
    console.log(`[Discord] Owner ID: ${process.env.DISCORD_OWNER_ID}`);
    console.log(`[Discord] Listening for messages...`);

    writeHeartbeat();
    console.log('[Discord] Heartbeat written');

    const wakeChannelId = process.env.WAKE_CHANNEL_ID;
    if (wakeChannelId) {
      seedBufferFromDailyLog(wakeChannelId);
    }

    // Initialize voice-chat skill
    try {
      const voiceChatPath = path.resolve('skills/voice-chat/handler.js');
      const voiceChat = await import(`file:///${voiceChatPath.replace(/\\/g, '/')}`);
      if (voiceChat.init) {
        voiceChat.init(client);
        console.log('[Discord] Voice chat skill initialized');
      }
    } catch (err) {
      console.error('[Discord] Failed to initialize voice chat:', err.message);
    }

    // Send wake-up message
    if (wakeChannelId) {
      try {
        const channel = await client.channels.fetch(wakeChannelId);
        if (channel) {
          const wakeMsg = await generateWakeUpMessage(wakeChannelId);
          await channel.send(wakeMsg);
          console.log(`[Discord] Wake-up message sent to #${channel.name || wakeChannelId}`);
        }
      } catch (err) {
        console.error('[Discord] Failed to send wake-up message:', err.message);
      }
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.author.id !== process.env.DISCORD_OWNER_ID) return;

    writeHeartbeat();

    const content = message.content.trim();
    const hasAttachments = message.attachments && message.attachments.size > 0;

    if (!content && !hasAttachments) return;

    // --- Command handling ---
    if (content) {
      // Model switch commands (v1.18 — Gemma + Claude)
      if (content === '!gemma' || content === '!e4b') {
        const reply = forceGemmaE4B(message.channel.id);
        await message.reply(reply);
        return;
      }
      if (content === '!31b') {
        const reply = forceGemma31B(message.channel.id);
        await message.reply(reply);
        return;
      }
      if (content === '!sonnet') {
        const reply = forceSonnet(message.channel.id);
        await message.reply(reply);
        return;
      }
      if (content === '!opus') {
        const reply = forceOpus(message.channel.id);
        await message.reply(reply);
        return;
      }

      if (content === '!model') {
        const status = getModelStatus(message.channel.id);
        await message.reply(status);
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
        const helpText = `**MiniClaw Commands (Gemma Edition)**

**Model Switching:**
\`!gemma\` or \`!e4b\` — Gemma E4B (fast local model, no API costs)
\`!31b\` — Gemma 31B (high-quality local model, no API costs)
\`!sonnet\` — Claude Sonnet (balanced, tool-capable)
\`!opus\` — Claude Opus (full power, build mode)

**System:**
\`!model\` — Show current model
\`!ping\` — Check bot latency
\`!reindex\` — Rebuild memory search index
\`!clear\` — Clear conversation history for this channel
\`!help\` — Show this help message

**Auto-routing:** Messages default to Gemma E4B (free local inference). The bot auto-upgrades to Gemma 31B for code generation, Claude Sonnet for tool orchestration, and Claude Opus for building/development work.`;

        await message.reply(helpText);
        return;
      }
    }

    // --- Task Acknowledgement (only for complex tasks) ---
    let ackMessage = null;
    if (content) {
      const ackPromise = generateAckMessage(content);
      await message.channel.sendTyping();
      ackMessage = await ackPromise;
      if (ackMessage) {
        await message.channel.send(ackMessage);
        console.log(`[Discord] Ack sent: "${ackMessage}"`);
      }
    }

    if (!ackMessage) {
      await message.channel.sendTyping();
    }

    // --- Process Attachments ---
    let attachmentContent = '';
    if (hasAttachments) {
      attachmentContent = await processAttachments(message);
    }

    const fullMessageContent = (content || '') + attachmentContent;

    addToConversationBuffer(message.channel.id, 'user', content || '[attachment]');

    try {
      const conversationContext = getConversationBuffer(message.channel.id);

      // Route through Gemma router (auto-upgrades to Claude when needed)
      const response = await chat(message.channel.id, fullMessageContent, conversationContext);

      if (response && response.trim().length > 0) {
        await appendDailyLog(`Assistant: ${response.slice(0, 200)}${response.length > 200 ? '...' : ''}`);
      }

      if (response && response.trim().length > 0) {
        addToConversationBuffer(message.channel.id, 'assistant', response);
      }

      // Drain pending attachments
      const pendingFiles = drainPendingAttachments();
      const attachments = pendingFiles
        .filter(fp => fs.existsSync(fp))
        .map(fp => new AttachmentBuilder(fp, { name: path.basename(fp) }));

      if (attachments.length > 0) {
        console.log(`[Discord] Attaching ${attachments.length} file(s): ${pendingFiles.map(fp => path.basename(fp)).join(', ')}`);
      }

      if ((!response || response.trim().length === 0) && attachments.length === 0) {
        await message.reply('*(completed — no text response)*');
        return;
      }

      // Split long responses
      const maxLen = 1900;

      if (response.length <= maxLen && attachments.length === 0) {
        await message.reply(response);
      } else if (response.length <= maxLen) {
        await message.reply({ content: response, files: attachments });
        const tempFiles = pendingFiles.filter(fp => fp.includes('temp'));
        cleanupSentFiles(tempFiles);
      } else {
        const chunks = splitMessage(response, maxLen);
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0 && attachments.length > 0) {
            await message.reply({ content: chunks[i], files: attachments });
            const tempFiles = pendingFiles.filter(fp => fp.includes('temp'));
            cleanupSentFiles(tempFiles);
          } else if (i === 0) {
            await message.reply(chunks[i]);
          } else {
            await message.channel.send(chunks[i]);
          }
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

export { client };
