import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { parseRequest } from './parser.js';
import { checkAvailability } from './tmdb.js';
import { searchTorrents } from './jackett.js';
import { filterTorrents } from './torrent-filter.js';
import { addTorrent, pollDownload } from './qbittorrent.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const WATCH_CHANNEL_ID = process.env.WATCH_CHANNEL_ID;

client.once('ready', () => {
  console.log(`✅ Plex Bot logged in as ${client.user.tag}`);
  console.log(`📺 Watching channel ID: ${WATCH_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only watch the configured channel
  if (message.channel.id !== WATCH_CHANNEL_ID) return;

  const content = message.content.trim();
  if (!content) return;

  console.log(`\n📝 Request from ${message.author.tag}: "${content}"`);

  try {
    // Parse the request
    const parsed = parseRequest(content);
    if (!parsed) {
      await message.reply('❌ Couldn\'t parse that request. Try formats like:\n- `Blue Moon (2025)`\n- `Breaking Bad S03E08`\n- `Seinfeld season 4`');
      return;
    }

    console.log(`📋 Parsed:`, parsed);

    // Check availability on TMDB
    const availability = await checkAvailability(parsed);
    
    if (!availability.found) {
      await message.reply(`❌ Couldn't find **${parsed.title}** ${parsed.year ? `(${parsed.year})` : ''} on TMDB. Double-check the title/year?`);
      return;
    }

    if (!availability.available) {
      await message.reply(`🎬 **${availability.title}** is still in cinemas — not available digitally yet.`);
      return;
    }

    console.log(`✅ Available: ${availability.title} (${availability.year})`);

    // Search for torrents via Jackett
    // FIXED: Use parentheses format that Jackett expects
    const searchQuery = parsed.type === 'movie' 
      ? `${availability.title} (${availability.year})`
      : parsed.episode
        ? `${availability.title} S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`
        : `${availability.title} S${String(parsed.season).padStart(2, '0')}`;

    console.log(`🔍 Searching Jackett for: "${searchQuery}"`);
    const torrents = await searchTorrents(searchQuery, parsed.type);

    if (!torrents || torrents.length === 0) {
      await message.reply(`❌ No torrents found for **${availability.title}**. It might be too new or too obscure.`);
      return;
    }

    // Filter for quality
    const filtered = filterTorrents(torrents);

    if (!filtered || filtered.length === 0) {
      await message.reply(`❌ Found **${availability.title}** but no quality torrents yet (only CAM/TS versions).`);
      return;
    }

    const best = filtered[0];
    console.log(`🎯 Best torrent: ${best.title} [${best.size}, ${best.seeders} seeders]`);

    // Send to qBittorrent
    const downloadName = await addTorrent(best.magnetLink, parsed.type);
    
    // Send initial status message showing full torrent name
    const statusMsg = await message.reply(`⏳ Downloading **${best.title}** [${best.size}]`);

    // Poll for completion with live progress updates
    pollDownload(
      downloadName,
      // Completion callback
      async (success, name) => {
        if (success) {
          await statusMsg.edit(`✅ **${availability.title}** is ready on Plex within the next 15 minutes!`);
        } else {
          await statusMsg.edit(`⚠️ **${availability.title}** download stalled or failed. You might need to check qBittorrent.`);
        }
      },
      // Progress callback — edit the status message in place
      async ({ name, progress, state }) => {
        try {
          await statusMsg.edit(`⏳ **${name}**: ${progress}% [${state}]`);
        } catch (err) {
          // Ignore edit failures (rate limits, etc.)
          console.error('Failed to edit progress message:', err.message);
        }
      }
    );

  } catch (error) {
    console.error('❌ Error processing request:', error);
    await message.reply('❌ Something went wrong processing your request. Check the bot logs.');
  }
});

client.login(process.env.DISCORD_TOKEN);