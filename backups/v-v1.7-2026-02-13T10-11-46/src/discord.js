// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
// v1.6 — Auto model switching based on conversation context
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import { chat, setModel, getModel, clearHistory } from './claude.js';
import { indexMemoryFiles } from './memory-index.js';
import Anthropic from '@anthropic-ai/sdk';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // needed for DMs
});

// --- Auto Model Switching (v1.6) ---
const MODELS = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929'
};

// Build-mode triggers — phrases that suggest we're about to do real work
const BUILD_TRIGGERS = [
  /\blet'?s\s+(build|work on|tackle|get to work|implement|get #?\d)/i,
  /\bcan (you|we)\s+(build|implement|create|write|code|develop|set up|upgrade)/i,
  /\bstart\s+(building|coding|implementing|working)/i,
  /\bget\s+(this|that|it)\s+(built|done|implemented|working|going)/i,
  /\btime to\s+(build|code|work)/i,
  /\blet'?s\s+do\s+(it|this|that)\b/i,
  /\blet'?s\s+get\s+#?\d/i,
];

// Chat-mode triggers — phrases that suggest we're winding down or just talking
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

/**
 * Check if the user's message suggests a model switch is needed.
 * Returns 'opus', 'sonnet', or null (no change).
 */
function detectModelContext(messageContent) {
  const currentModel = getModel();

  // Check for build-mode triggers → switch to Opus
  if (currentModel !== MODELS.opus) {
    for (const pattern of BUILD_TRIGGERS) {
      if (pattern.test(messageContent)) {
        return 'opus';
      }
    }
  }

  // Check for chat-mode triggers → switch to Sonnet
  if (currentModel !== MODELS.sonnet) {
    for (const pattern of CHAT_TRIGGERS) {
      if (pattern.test(messageContent)) {
        return 'sonnet';
      }
    }
  }

  return null; // No change needed
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
  console.log(`[AutoSwitch] Detected ${switchTo} mode — switched from ${currentModel} to ${modelId}`);
  return label;
}

/**
 * Generate a short, personality-filled wake-up message using a quick Haiku call.
 * Keeps it cheap and fast — this isn't a full conversation, just flavour.
 */
async function generateWakeUpMessage() {
  try {
    const anthropic = new Anthropic(); // Uses ANTHROPIC_API_KEY from env
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You are an AI assistant who just came back online after a restart. Generate a single short wake-up message (1-2 sentences max). Be witty, dry, and casual — not corporate or overly enthusiastic. You have personality: think dry humour, understated competence, maybe a little self-aware about being rebooted.

Examples of the vibe (don't repeat these exactly, come up with something fresh):
- "Back online. What'd I miss?"
- "I'm here. Memory loaded, coffee pending."
- "Rebooted. Still me — I checked."
- "Woke up, read my diary. Caught up now."
- "Back. Did you try turning me off and on again? ...oh wait."

Just output the message, nothing else. No quotes, no preamble.`,
      messages: [{ role: 'user', content: 'Generate a wake-up message.' }]
    });

    const text = response.content[0]?.text?.trim();
    return text || "I'm back.";
  } catch (err) {
    console.error('[Discord] Failed to generate wake-up message:', err.message);
    return "I'm back online."; // Fallback if API call fails
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

  client.on('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
    console.log(`[Discord] Owner ID: ${process.env.DISCORD_OWNER_ID}`);
    console.log(`[Discord] Listening for messages...`);

    // Send a wake-up message
    // Uses WAKE_CHANNEL_ID from .env to know exactly where to post.
    // Auto-detecting a channel via permissionsFor was unreliable — Discord's
    // permission resolution at startup doesn't properly account for
    // channel-level overrides, causing "Missing Access" errors.
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

      // Fetch text from .txt attachments (Discord auto-converts long pastes)
      if (message.attachments.size > 0) {
        const textExtensions = ['.txt', '.js', '.ts', '.json', '.py', '.md', '.csv', '.log'];
        for (const [, attachment] of message.attachments) {
          const isTextFile = textExtensions.some(ext => attachment.name.endsWith(ext))
            || attachment.contentType?.startsWith('text/');
          if (isTextFile && attachment.size < 100_000) {
            try {
              const response = await fetch(attachment.url);
              const text = await response.text();
              content += (content ? '\n' : '') + text;
              console.log(`[Discord] Read attachment: ${attachment.name} (${attachment.size} bytes)`);
            } catch (err) {
              console.error(`[Discord] Failed to fetch attachment ${attachment.name}:`, err);
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
        const latency = Date.now() - startTime;
        await msg.edit(`Pong! Latency: ${latency}ms`);
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
      // Check message context BEFORE sending to Claude
      const switchResult = autoSwitchModel(content);
      let switchNotice = '';
      if (switchResult) {
        switchNotice = `⚡ *Auto-switched to ${switchResult}*\n\n`;
      }

      // Send typing indicator
      await message.channel.sendTyping();

      // Get response from Claude
      const response = await chat(message.channel.id, content);

      // Don't send empty messages (can happen if Claude only used tools with no text reply)
      if (!response || response.trim().length === 0) {
        const reply = switchNotice
          ? switchNotice + "✅ *(done — tools executed, no text response)*"
          : "✅ *(done — tools executed, no text response)*";
        await message.reply(reply);
        return;
      }

      // Prepend switch notice to the response if a switch happened
      const fullResponse = switchNotice + response;

      // Discord has a 2000 char limit — split long messages
      if (fullResponse.length <= 2000) {
        await message.reply(fullResponse);
      } else {
        const chunks = splitMessage(fullResponse, 2000);
        for (let i = 0; i < chunks.length; i++) {
          // Reply to the first chunk, send others as separate messages
          if (i === 0) {
            await message.reply(chunks[i]);
          } else {
            await message.channel.send(chunks[i]);
          }
        }
      }
    } catch (err) {
      console.error('[Discord] Error handling message:', err);

      try {
        // Try to send error to user
        const errorMsg = err.message.length > 500
          ? err.message.slice(0, 500) + '...'
          : err.message;

        await message.reply(`❌ Error: ${errorMsg}`);
      } catch (replyErr) {
        console.error('[Discord] Failed to send error message:', replyErr);
      }
    }
  });

  client.on('error', (err) => {
    console.error('[Discord] Client error:', err);
  });

  client.on('warn', (warn) => {
    console.warn('[Discord] Client warning:', warn);
  });

  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('[Discord] Login failed:', err.message);
    console.error('[Discord] Check that your DISCORD_TOKEN in .env is correct');
    process.exit(1);
  });
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
      // No good split point, hard cut
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}