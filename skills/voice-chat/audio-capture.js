// audio-capture.js
// Captures audio from Discord voice channels and converts to WAV for Whisper

import { EndBehaviorType } from '@discordjs/voice';
import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import prism from 'prism-media';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, 'data');

// Audio constants
const CHANNELS = 2;
const SAMPLE_RATE = 48000;
const BITS_PER_SAMPLE = 16;

/**
 * Capture audio from a user in the voice channel
 * @param {VoiceConnection} connection - Active voice connection
 * @param {string} userId - Discord user ID to capture audio from
 * @param {number} maxDuration - Maximum recording duration in seconds (default 30)
 * @returns {Promise<string>} Path to the captured WAV file
 */
export async function captureUserAudio(connection, userId, maxDuration = 30) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const tempPcmPath = path.resolve(dataDir, `capture-${timestamp}.pcm`);
    const outputWavPath = path.resolve(dataDir, `capture-${timestamp}.wav`);

    console.log(`[AudioCapture] Starting capture for user ${userId}`);

    try {
      // Get the audio receiver
      const receiver = connection.receiver;

      // Subscribe to the user's audio stream
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1500 // 1.5 seconds of silence ends the stream
        }
      });

      // Create opus decoder
      const decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: 960
      });

      // Create write stream for raw PCM data
      const pcmWriter = createWriteStream(tempPcmPath);

      let hasReceivedAudio = false;
      let streamEnded = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!streamEnded) {
          console.log('[AudioCapture] Max duration reached, ending capture');
          audioStream.destroy();
          decoder.destroy();
        }
      }, maxDuration * 1000);

      // Track when we receive audio
      decoder.on('data', () => {
        if (!hasReceivedAudio) {
          hasReceivedAudio = true;
          console.log('[AudioCapture] Receiving audio data...');
        }
      });

      // Handle stream completion
      const handleStreamEnd = async () => {
        if (streamEnded) return;
        streamEnded = true;

        clearTimeout(timeout);

        try {
          // Wait a bit for buffers to flush
          await new Promise(resolve => setTimeout(resolve, 100));

          if (!hasReceivedAudio) {
            // No audio was captured
            await cleanup(tempPcmPath, outputWavPath);
            reject(new Error('No audio received from user'));
            return;
          }

          console.log('[AudioCapture] Audio capture complete, converting to WAV...');

          // Convert PCM to WAV
          await convertPcmToWav(tempPcmPath, outputWavPath);

          // Clean up temp PCM file
          await fs.unlink(tempPcmPath).catch(() => {});

          console.log(`[AudioCapture] WAV file created: ${outputWavPath}`);
          resolve(outputWavPath);
        } catch (err) {
          await cleanup(tempPcmPath, outputWavPath);
          reject(err);
        }
      };

      // Pipe audio stream through decoder to PCM file
      audioStream
        .pipe(decoder)
        .pipe(pcmWriter);

      // Handle end events
      audioStream.on('end', handleStreamEnd);
      audioStream.on('close', handleStreamEnd);

      // Handle errors
      audioStream.on('error', async (err) => {
        clearTimeout(timeout);
        await cleanup(tempPcmPath, outputWavPath);
        reject(new Error(`Audio stream error: ${err.message}`));
      });

      decoder.on('error', async (err) => {
        clearTimeout(timeout);
        await cleanup(tempPcmPath, outputWavPath);
        reject(new Error(`Decoder error: ${err.message}`));
      });

      pcmWriter.on('error', async (err) => {
        clearTimeout(timeout);
        await cleanup(tempPcmPath, outputWavPath);
        reject(new Error(`Write error: ${err.message}`));
      });

    } catch (err) {
      reject(new Error(`Failed to set up audio capture: ${err.message}`));
    }
  });
}

/**
 * Convert raw PCM data to WAV file format
 * @param {string} pcmPath - Path to input PCM file
 * @param {string} wavPath - Path to output WAV file
 */
async function convertPcmToWav(pcmPath, wavPath) {
  // Read PCM data
  const pcmData = await fs.readFile(pcmPath);
  const pcmSize = pcmData.length;

  // Calculate WAV header parameters
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

  // Create WAV header (44 bytes)
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmSize, 4); // File size - 8
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // Audio format (1 = PCM)
  header.writeUInt16LE(CHANNELS, 22); // Number of channels
  header.writeUInt32LE(SAMPLE_RATE, 24); // Sample rate
  header.writeUInt32LE(byteRate, 28); // Byte rate
  header.writeUInt16LE(blockAlign, 32); // Block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34); // Bits per sample

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(pcmSize, 40); // Data size

  // Write WAV file (header + PCM data)
  await fs.writeFile(wavPath, Buffer.concat([header, pcmData]));
}

/**
 * Clean up temporary audio files
 */
async function cleanup(...paths) {
  for (const p of paths) {
    try {
      await fs.unlink(p);
    } catch (err) {
      // Ignore errors - file might not exist
    }
  }
}

/**
 * Delete an audio file after use
 * @param {string} filePath - Path to audio file to delete
 */
export async function deleteAudioFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`[AudioCapture] Deleted audio file: ${filePath}`);
  } catch (err) {
    console.error(`[AudioCapture] Failed to delete ${filePath}:`, err.message);
  }
}
