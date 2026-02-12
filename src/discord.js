// src/discord.js
// Discord bot with owner-only security, typing indicators, message splitting
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { chat, setModel, getModel, clearHistory } from './claude.js';
import { indexMemoryFiles } from './memory-index.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // needed for DMs
});

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

  client.on('ready', () => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);
    console.log(`[Discord] Owner ID: ${process.env.DISCORD_OWNER_ID}`);
    console.log(`[Discord] Listening for messages...`);
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

      const content = message.content.trim();
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
• \`claude-opus-4-5-20250929\` — Opus 4.5 (most capable)

Just chat normally for AI assistance!`;

        await message.reply(helpText);
        return;
      }

      // Send typing indicator
      await message.channel.sendTyping();

      // Get response from Claude
      const response = await chat(message.channel.id, content);

      // Discord has a 2000 char limit — split long messages
      if (response.length <= 2000) {
        await message.reply(response);
      } else {
        const chunks = splitMessage(response, 2000);
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
