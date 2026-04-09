// audio-playback.js
// Plays TTS audio through Discord voice channels

import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { promises as fs } from 'fs';

// Singleton audio player (reused across playback sessions)
let audioPlayer = null;

/**
 * Get or create the audio player instance
 */
function getAudioPlayer() {
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer();

    // Log player state changes
    audioPlayer.on(AudioPlayerStatus.Playing, () => {
      console.log('[AudioPlayback] Audio player started playing');
    });

    audioPlayer.on(AudioPlayerStatus.Idle, () => {
      console.log('[AudioPlayback] Audio player idle');
    });

    audioPlayer.on('error', (error) => {
      console.error('[AudioPlayback] Audio player error:', error);
    });
  }

  return audioPlayer;
}

/**
 * Play an audio file through the voice connection
 * @param {VoiceConnection} connection - Active voice connection
 * @param {string} filePath - Path to audio file (must be .opus format)
 * @param {boolean} deleteAfter - Whether to delete the file after playback (default true)
 * @returns {Promise<void>} Resolves when playback completes
 */
export async function playAudio(connection, filePath, deleteAfter = true) {
  return new Promise(async (resolve, reject) => {
    try {
      // Verify connection is ready
      if (connection.state.status !== VoiceConnectionStatus.Ready) {
        console.log('[AudioPlayback] Waiting for connection to be ready...');
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        } catch (err) {
          throw new Error('Voice connection not ready for playback');
        }
      }

      // Verify file exists
      try {
        await fs.access(filePath);
      } catch (err) {
        throw new Error(`Audio file not found: ${filePath}`);
      }

      console.log(`[AudioPlayback] Playing audio: ${filePath}`);

      // Create audio resource from file
      const resource = createAudioResource(filePath, {
        inlineVolume: true
      });

      // Set volume to a reasonable level (0.5 = 50%)
      if (resource.volume) {
        resource.volume.setVolume(0.5);
      }

      // Get the audio player
      const player = getAudioPlayer();

      // Set up one-time listeners for this playback
      const onIdle = async () => {
        console.log('[AudioPlayback] Playback complete');
        cleanup();

        // Delete file if requested
        if (deleteAfter) {
          try {
            await fs.unlink(filePath);
            console.log(`[AudioPlayback] Deleted audio file: ${filePath}`);
          } catch (err) {
            console.error(`[AudioPlayback] Failed to delete file: ${err.message}`);
          }
        }

        resolve();
      };

      const onError = async (error) => {
        console.error('[AudioPlayback] Playback error:', error);
        cleanup();

        // Still try to delete the file
        if (deleteAfter) {
          try {
            await fs.unlink(filePath);
          } catch (err) {
            // Ignore cleanup errors
          }
        }

        reject(new Error(`Playback failed: ${error.message}`));
      };

      const cleanup = () => {
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.off('error', onError);
      };

      // Attach listeners
      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once('error', onError);

      // Subscribe the connection to the player
      connection.subscribe(player);

      // Start playing
      player.play(resource);

    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stop any currently playing audio
 */
export function stopAudio() {
  if (audioPlayer && audioPlayer.state.status !== AudioPlayerStatus.Idle) {
    console.log('[AudioPlayback] Stopping audio playback');
    audioPlayer.stop();
  }
}

/**
 * Get current playback status
 * @returns {string} Player status ('idle', 'playing', 'paused', 'buffering', or 'none')
 */
export function getPlaybackStatus() {
  if (!audioPlayer) return 'none';

  switch (audioPlayer.state.status) {
    case AudioPlayerStatus.Idle:
      return 'idle';
    case AudioPlayerStatus.Playing:
      return 'playing';
    case AudioPlayerStatus.Paused:
      return 'paused';
    case AudioPlayerStatus.Buffering:
      return 'buffering';
    default:
      return 'unknown';
  }
}
