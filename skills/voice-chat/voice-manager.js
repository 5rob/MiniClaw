// voice-manager.js
// Manages Discord voice connections with auto-reconnect

import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';

let currentConnection = null;
let currentGuildId = null;
let currentChannelId = null;
let currentAdapterCreator = null;

/**
 * Join a voice channel
 * @param {Client} client - Discord.js client
 * @param {string} channelId - Voice channel ID to join
 * @param {string} guildId - Guild ID
 * @returns {VoiceConnection} The voice connection
 */
export async function joinChannel(client, channelId, guildId) {
  try {
    // Check if already connected to this channel
    if (currentConnection && currentChannelId === channelId) {
      console.log('[VoiceManager] Already connected to this channel');
      return currentConnection;
    }

    // Leave any existing connection first
    if (currentConnection) {
      await leaveChannel();
    }

    // Get the guild and channel
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!channel || channel.type !== 2) { // 2 = GUILD_VOICE
      throw new Error(`Channel ${channelId} is not a voice channel`);
    }

    console.log(`[VoiceManager] Joining voice channel: ${channel.name}`);

    // Create voice connection
    currentConnection = joinVoiceChannel({
      channelId: channelId,
      guildId: guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    // Store connection details for reconnection
    currentGuildId = guildId;
    currentChannelId = channelId;
    currentAdapterCreator = guild.voiceAdapterCreator;

    // Set up connection state listeners
    setupConnectionListeners(currentConnection);

    // Wait for connection to be ready
    try {
      await entersState(currentConnection, VoiceConnectionStatus.Ready, 30_000);
      console.log('[VoiceManager] Voice connection ready');
    } catch (err) {
      console.error('[VoiceManager] Failed to enter Ready state:', err.message);
      currentConnection.destroy();
      currentConnection = null;
      throw new Error('Failed to establish voice connection');
    }

    return currentConnection;
  } catch (err) {
    console.error('[VoiceManager] Failed to join channel:', err.message);
    currentConnection = null;
    throw err;
  }
}

/**
 * Leave the current voice channel
 */
export async function leaveChannel() {
  if (!currentConnection) {
    console.log('[VoiceManager] No active connection to leave');
    return;
  }

  console.log('[VoiceManager] Leaving voice channel');
  currentConnection.destroy();
  currentConnection = null;
  currentGuildId = null;
  currentChannelId = null;
  currentAdapterCreator = null;
}

/**
 * Get the current voice connection (or null)
 * @returns {VoiceConnection|null}
 */
export function getConnection() {
  return currentConnection;
}

/**
 * Check if currently connected to a voice channel
 * @returns {boolean}
 */
export function isConnected() {
  return currentConnection !== null &&
         currentConnection.state.status !== VoiceConnectionStatus.Destroyed &&
         currentConnection.state.status !== VoiceConnectionStatus.Disconnected;
}

/**
 * Set up connection event listeners for auto-reconnect
 */
function setupConnectionListeners(connection) {
  // Handle disconnections with exponential backoff reconnect
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.log('[VoiceManager] Disconnected from voice channel');

    try {
      // Wait for the connection to reconnect within 5 seconds
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
      // Connection is reconnecting, reset attempt counter
      reconnectAttempts = 0;
      console.log('[VoiceManager] Reconnecting...');
    } catch (err) {
      // Connection didn't reconnect automatically, try manual reconnect
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`[VoiceManager] Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms`);

        setTimeout(() => {
          if (currentGuildId && currentChannelId && currentAdapterCreator) {
            try {
              connection.rejoin({
                channelId: currentChannelId,
                selfDeaf: false,
                selfMute: false
              });
            } catch (rejoinErr) {
              console.error('[VoiceManager] Rejoin failed:', rejoinErr.message);
              connection.destroy();
              currentConnection = null;
            }
          }
        }, delay);
      } else {
        console.error('[VoiceManager] Max reconnection attempts reached, destroying connection');
        connection.destroy();
        currentConnection = null;
      }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.log('[VoiceManager] Voice connection destroyed');
    currentConnection = null;
  });

  connection.on(VoiceConnectionStatus.Connecting, () => {
    console.log('[VoiceManager] Connecting to voice channel...');
  });

  connection.on(VoiceConnectionStatus.Signalling, () => {
    console.log('[VoiceManager] Signalling voice connection...');
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log('[VoiceManager] Voice connection ready');
    reconnectAttempts = 0; // Reset on successful connection
  });

  connection.on('error', (error) => {
    console.error('[VoiceManager] Voice connection error:', error);
  });
}
