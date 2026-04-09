import { spawn } from 'child_process';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import * as voiceManager from './voice-manager.js';
import { captureUserAudio, deleteAudioFile } from './audio-capture.js';
import { playAudio, stopAudio, getPlaybackStatus } from './audio-playback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, 'data');
const logsDir = path.resolve(__dirname, 'logs');

// Ensure directories exist (async initialization)
const initDirectories = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
};

// Initialize immediately (fire and forget for module load)
initDirectories().catch(err => console.error('[VoiceChat] Failed to create directories:', err));

// Discord client reference (set by init())
let discordClient = null;

// Anthropic API client (imported dynamically)
let anthropicClient = null;

// Voice conversation history (lightweight, separate from text chat)
const voiceHistory = [];
const MAX_VOICE_HISTORY = 10; // Keep last 10 exchanges

// Conversation loop state
let conversationLoopActive = false;
let isProcessing = false;
let currentSpeaker = null;

/**
 * Voice Chat Tool Definition
 * Provides voice interaction capabilities via Discord voice channels
 */
export const toolDefinition = {
  name: 'voice_chat',
  description: 'Voice interaction tool for Discord voice channels. Captures audio from voice channel, transcribes speech using local Whisper, processes with Claude, and responds via TTS. Use when user wants voice interaction or is in a voice channel.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['join', 'leave', 'listen', 'speak', 'converse', 'play', 'status', 'test_setup', 'start_conversation', 'stop_conversation'],
        description: 'Operation: join (join voice channel), leave (leave channel), listen (capture & transcribe), speak (generate TTS), converse (full loop: capture → transcribe), play (play TTS file), status (check connection), test_setup (verify config), start_conversation (begin auto-listen loop), stop_conversation (stop auto-listen loop)'
      },
      text: {
        type: 'string',
        description: 'Text to speak (for speak/play actions)'
      },
      duration: {
        type: 'number',
        description: 'Max recording duration in seconds (for listen/converse, default: 30)',
        default: 30
      },
      voice_style: {
        type: 'string',
        enum: ['casual', 'professional', 'excited', 'calm'],
        description: 'TTS voice style modifier',
        default: 'casual'
      },
      audio_file: {
        type: 'string',
        description: 'Path to audio file to play (for play action)'
      }
    },
    required: ['action']
  }
};

/**
 * Log event to file
 */
async function logEvent(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...metadata
  };

  const logFile = path.resolve(logsDir, `voice-chat-${new Date().toISOString().split('T')[0]}.log`);
  const logLine = `${timestamp} [${level}] ${message} ${JSON.stringify(metadata)}\n`;

  try {
    await fs.appendFile(logFile, logLine);
  } catch (err) {
    console.error('Failed to write log:', err);
  }

  // Also log to console for immediate visibility
  console.log(`[VoiceChat/${level}] ${message}`, metadata);
}

/**
 * Execute Whisper transcription
 * Supports both whisper.cpp and faster-whisper
 */
async function transcribeAudio(audioFilePath) {
  await logEvent('INFO', 'Starting transcription', { audioFile: audioFilePath });

  const whisperPath = process.env.WHISPER_PATH || 'whisper';
  const whisperModelPath = process.env.WHISPER_MODEL_PATH;
  const whisperEngine = process.env.WHISPER_ENGINE || 'faster-whisper'; // 'faster-whisper' or 'whisper.cpp'

  return new Promise((resolve, reject) => {
    let command, args, spawnOptions;

    if (whisperEngine === 'whisper.cpp') {
      // whisper.cpp command line
      command = whisperPath;
      args = [
        '-m', whisperModelPath || 'models/ggml-base.en.bin',
        '-f', audioFilePath,
        '--output-txt',
        '--no-timestamps'
      ];
      spawnOptions = {};
    } else {
      // faster-whisper (Python)
      command = 'python';
      args = [
        '-c',
        `
import sys
import os
from faster_whisper import WhisperModel

# Verbose output for debugging
print("Python Whisper starting...", file=sys.stderr)
print(f"Audio file: ${audioFilePath.replace(/\\/g, '\\\\')}", file=sys.stderr)
print(f"KMP_DUPLICATE_LIB_OK: {os.getenv('KMP_DUPLICATE_LIB_OK')}", file=sys.stderr)

model_path = "${whisperModelPath || 'base.en'}"
audio_path = "${audioFilePath.replace(/\\/g, '\\\\')}"

try:
    print("Loading Whisper model...", file=sys.stderr)
    model = WhisperModel(model_path, device="cuda", compute_type="float16")
    
    print("Starting transcription...", file=sys.stderr)
    segments, info = model.transcribe(audio_path, beam_size=5)
    
    print(f"Detected language: {info.language}, probability: {info.language_probability:.2f}", file=sys.stderr)
    
    text = " ".join([segment.text for segment in segments])
    
    print(f"Transcription complete: '{text}'", file=sys.stderr)
    print(text.strip())
    
except Exception as e:
    import traceback
    print(f"EXCEPTION: {e}", file=sys.stderr)
    print(f"TRACEBACK:", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
        `.trim()
      ];
      
      // CRITICAL: Pass environment variables explicitly to the child process
      spawnOptions = {
        env: {
          ...process.env,  // Inherit all current env vars
          KMP_DUPLICATE_LIB_OK: 'TRUE'  // Force-set the OpenMP fix
        }
      };
    }

    logEvent('DEBUG', 'Spawning Whisper process', { command, engine: whisperEngine, env: spawnOptions.env ? 'custom' : 'inherited' });

    const whisper = spawn(command, args, spawnOptions);
    let stdout = '';
    let stderr = '';

    whisper.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log('[Whisper STDOUT]', chunk.trim());
    });

    whisper.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.log('[Whisper STDERR]', chunk.trim());
    });

    whisper.on('close', async (code) => {
      await logEvent('DEBUG', 'Whisper process closed', { code, stdoutLength: stdout.length, stderrLength: stderr.length });

      if (code !== 0) {
        await logEvent('ERROR', 'Whisper transcription failed', { 
          code, 
          stderr: stderr.substring(0, 1000),  // First 1000 chars
          stdout: stdout.substring(0, 500)
        });
        reject(new Error(`Whisper failed with code ${code}: ${stderr}`));
        return;
      }

      const transcription = stdout.trim();
      await logEvent('INFO', 'Transcription complete', { transcription, stderrPreview: stderr.substring(0, 500) });
      resolve(transcription);
    });

    whisper.on('error', async (err) => {
      await logEvent('ERROR', 'Whisper spawn error', { error: err.message, stack: err.stack });
      reject(err);
    });
  });
}

/**
 * Generate speech using Google Cloud TTS
 */
async function synthesizeSpeech(text, outputPath, style = 'casual') {
  await logEvent('INFO', 'Starting TTS synthesis', { text, style });

  // Check for Google Cloud credentials
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
  }

  // Voice parameters based on style
  const voiceParams = {
    casual: { pitch: 0, speakingRate: 1.1 },
    professional: { pitch: -2, speakingRate: 1.0 },
    excited: { pitch: 4, speakingRate: 1.2 },
    calm: { pitch: -1, speakingRate: 0.9 }
  };

  const params = voiceParams[style] || voiceParams.casual;

  return new Promise((resolve, reject) => {
    const python = spawn('python', [
      '-c',
      `
import sys
import json
from google.cloud import texttospeech

client = texttospeech.TextToSpeechClient()

synthesis_input = texttospeech.SynthesisInput(text="""${text.replace(/"/g, '\\"')}""")

voice = texttospeech.VoiceSelectionParams(
    language_code="en-AU",
    name="en-AU-Neural2-B",  # Australian male voice
    ssml_gender=texttospeech.SsmlVoiceGender.MALE
)

audio_config = texttospeech.AudioConfig(
    audio_encoding=texttospeech.AudioEncoding.OGG_OPUS,
    speaking_rate=${params.speakingRate},
    pitch=${params.pitch}
)

try:
    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice,
        audio_config=audio_config
    )

    with open("${outputPath.replace(/\\/g, '\\\\')}", "wb") as out:
        out.write(response.audio_content)

    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
      `.trim()
    ]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', async (code) => {
      if (code !== 0) {
        await logEvent('ERROR', 'TTS synthesis failed', { code, stderr });
        reject(new Error(`TTS failed: ${stderr}`));
        return;
      }

      await logEvent('INFO', 'TTS synthesis complete', { outputPath });
      resolve(outputPath);
    });

    python.on('error', async (err) => {
      await logEvent('ERROR', 'TTS spawn error', { error: err.message });
      reject(err);
    });
  });
}

/**
 * Get Claude response for voice conversation
 * Uses Haiku with minimal context — just the voice conversation history
 */
async function getClaudeResponse(transcription) {
  try {
    // Lazy load Anthropic client
    if (!anthropicClient) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
    }

    await logEvent('INFO', 'Sending to Claude Haiku', { transcription });

    // Add user message to voice history
    voiceHistory.push({
      role: 'user',
      content: transcription
    });

    // Trim history to max size (keep it lightweight)
    while (voiceHistory.length > MAX_VOICE_HISTORY * 2) {
      voiceHistory.shift();
    }

    // Build a minimal system prompt for voice conversations
    const systemPrompt = `You are having a voice conversation with Rob. Keep responses natural, concise, and conversational — you're speaking out loud, not writing an essay. Be helpful and direct. You're Rob's AI assistant named Julian.`;

    // Call Claude API directly with minimal context
    const response = await anthropicClient.messages.create({
      model: 'claude-3-haiku-20240307',  // FIXED: Use the correct stable Haiku model
      max_tokens: 500, // Short responses for voice
      system: systemPrompt,
      messages: voiceHistory
    });

    const assistantMessage = response.content[0].text;

    // Add assistant response to voice history
    voiceHistory.push({
      role: 'assistant',
      content: assistantMessage
    });

    await logEvent('INFO', 'Claude response received', { response: assistantMessage.substring(0, 200) });

    return assistantMessage;
  } catch (err) {
    await logEvent('ERROR', 'Claude API error', { error: err.message, stack: err.stack });
    throw err;
  }
}

/**
 * Start continuous conversation loop
 * Listens for user speaking, transcribes, gets Claude response, speaks it
 */
async function startConversationLoop(connection, userId, voiceStyle = 'casual') {
  if (conversationLoopActive) {
    await logEvent('WARN', 'Conversation loop already active');
    return { success: false, error: 'Conversation loop already running' };
  }

  conversationLoopActive = true;
  await logEvent('INFO', 'Conversation loop started', { userId });

  // Get the receiver
  const receiver = connection.receiver;

  // Listen for when user starts speaking
  const handleSpeaking = async (speakerUserId) => {
    // Only listen to the specified user
    if (speakerUserId !== userId) return;

    // Don't process if already processing another utterance or loop stopped
    if (isProcessing || !conversationLoopActive) {
      await logEvent('DEBUG', 'Ignoring speech - already processing or loop stopped');
      return;
    }

    await logEvent('INFO', 'User started speaking, capturing...', { userId: speakerUserId });
    isProcessing = true;

    try {
      // Capture audio from this user (will automatically end after silence)
      await logEvent('DEBUG', 'Capturing audio from user', { userId: speakerUserId });
      const audioPath = await captureUserAudio(connection, speakerUserId, 30);

      // If loop was stopped during capture, just clean up and return
      if (!conversationLoopActive) {
        await logEvent('INFO', 'Loop stopped during capture, cleaning up');
        await deleteAudioFile(audioPath);
        isProcessing = false;
        return;
      }

      // Transcribe the audio
      await logEvent('DEBUG', 'Transcribing audio', { audioPath });
      const transcription = await transcribeAudio(audioPath);
      await logEvent('INFO', 'Transcription result', { transcription });

      // Clean up audio file
      await deleteAudioFile(audioPath);

      if (!transcription || transcription.trim().length === 0) {
        await logEvent('WARN', 'Empty transcription received');
        isProcessing = false;
        return;
      }

      await logEvent('INFO', 'Valid transcription received', { transcription });

      // Get Claude response
      const response = await getClaudeResponse(transcription);

      await logEvent('DEBUG', 'Generating TTS response', { response });

      // Generate TTS
      const timestamp = Date.now();
      const ttsPath = path.resolve(dataDir, `tts-${timestamp}.opus`);
      await synthesizeSpeech(response, ttsPath, voiceStyle);

      // If loop stopped during synthesis, clean up and return
      if (!conversationLoopActive) {
        await logEvent('INFO', 'Loop stopped during synthesis, cleaning up');
        await deleteAudioFile(ttsPath);
        isProcessing = false;
        return;
      }

      // Play the response
      if (voiceManager.isConnected()) {
        await logEvent('DEBUG', 'Playing TTS response');
        await playAudio(connection, ttsPath, true); // Delete after playing
      } else {
        await logEvent('WARN', 'Not connected to voice, skipping playback');
        await deleteAudioFile(ttsPath);
      }

      await logEvent('INFO', 'Conversation turn complete');

    } catch (err) {
      await logEvent('ERROR', 'Conversation loop error', { error: err.message, stack: err.stack });
      console.error('[VoiceChat] Conversation loop error:', err);
    } finally {
      isProcessing = false;
    }
  };

  // Subscribe to speaking events
  receiver.speaking.on('start', handleSpeaking);

  // Store cleanup function for later
  connection._conversationCleanup = () => {
    receiver.speaking.off('start', handleSpeaking);
  };

  return { success: true, message: 'Conversation loop started', listening_for: userId };
}

/**
 * Stop the conversation loop
 */
async function stopConversationLoop() {
  if (!conversationLoopActive) {
    return { success: false, error: 'Conversation loop not running' };
  }

  conversationLoopActive = false;

  // Clean up event listeners
  const connection = voiceManager.getConnection();
  if (connection && connection._conversationCleanup) {
    connection._conversationCleanup();
    delete connection._conversationCleanup;
  }

  await logEvent('INFO', 'Conversation loop stopped');

  // Wait a moment for any in-progress operations to finish
  await new Promise(resolve => setTimeout(resolve, 500));

  isProcessing = false;
  currentSpeaker = null;

  return { success: true, message: 'Conversation loop stopped' };
}

/**
 * Test setup and configuration
 */
async function testSetup() {
  const results = {
    whisper: { status: 'unknown', details: '' },
    tts: { status: 'unknown', details: '' },
    env: {}
  };

  // Check environment variables
  results.env = {
    WHISPER_PATH: process.env.WHISPER_PATH || 'not set (using default)',
    WHISPER_MODEL_PATH: process.env.WHISPER_MODEL_PATH || 'not set (using default)',
    WHISPER_ENGINE: process.env.WHISPER_ENGINE || 'faster-whisper',
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'set' : 'NOT SET',
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID || 'not set'
  };

  // Test Whisper
  try {
    const engine = process.env.WHISPER_ENGINE || 'faster-whisper';
    if (engine === 'faster-whisper') {
      const test = spawn('python', ['-c', 'from faster_whisper import WhisperModel; print("OK")']);
      const output = await new Promise((resolve) => {
        let out = '';
        test.stdout.on('data', (data) => out += data.toString());
        test.on('close', () => resolve(out));
      });

      if (output.includes('OK')) {
        results.whisper.status = 'ready';
        results.whisper.details = 'faster-whisper module found';
      } else {
        results.whisper.status = 'error';
        results.whisper.details = 'faster-whisper import failed';
      }
    } else {
      results.whisper.status = 'unchecked';
      results.whisper.details = 'whisper.cpp requires binary check';
    }
  } catch (err) {
    results.whisper.status = 'error';
    results.whisper.details = err.message;
  }

  // Test Google Cloud TTS
  try {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      results.tts.status = 'error';
      results.tts.details = 'GOOGLE_APPLICATION_CREDENTIALS not set';
    } else {
      const test = spawn('python', ['-c', 'from google.cloud import texttospeech; print("OK")']);
      const output = await new Promise((resolve) => {
        let out = '';
        test.stdout.on('data', (data) => out += data.toString());
        test.on('close', () => resolve(out));
      });

      if (output.includes('OK')) {
        results.tts.status = 'ready';
        results.tts.details = 'Google Cloud TTS module found';
      } else {
        results.tts.status = 'error';
        results.tts.details = 'google-cloud-texttospeech import failed';
      }
    }
  } catch (err) {
    results.tts.status = 'error';
    results.tts.details = err.message;
  }

  return results;
}

/**
 * Main execute function
 */
export async function execute(input) {
  const { action, text, duration = 30, voice_style = 'casual', audio_file } = input;

  await logEvent('INFO', 'Voice chat action started', { action, input });

  try {
    switch (action) {
      case 'join': {
        if (!discordClient) {
          return { success: false, error: 'Voice chat not initialized. Discord client not available.' };
        }

        const channelId = process.env.VOICE_CHANNEL_ID;
        if (!channelId) {
          return { success: false, error: 'VOICE_CHANNEL_ID not set in .env' };
        }

        // Find the guild that contains this voice channel
        let targetGuild = null;
        for (const [, guild] of discordClient.guilds.cache) {
          const channel = guild.channels.cache.get(channelId);
          if (channel) {
            targetGuild = guild;
            break;
          }
        }

        if (!targetGuild) {
          return { success: false, error: `Voice channel ${channelId} not found in any guild` };
        }

        const connection = await voiceManager.joinChannel(discordClient, channelId, targetGuild.id);

        return {
          success: true,
          message: `Joined voice channel in ${targetGuild.name}`,
          channel_id: channelId,
          guild_id: targetGuild.id
        };
      }

      case 'leave': {
        if (!voiceManager.isConnected()) {
          return { success: true, message: 'Not connected to any voice channel' };
        }

        // Stop conversation loop if active
        if (conversationLoopActive) {
          await stopConversationLoop();
        }

        await voiceManager.leaveChannel();
        return {
          success: true,
          message: 'Left voice channel'
        };
      }

      case 'listen': {
        if (!voiceManager.isConnected()) {
          return { success: false, error: 'Not connected to a voice channel. Use join action first.' };
        }

        const ownerId = process.env.DISCORD_OWNER_ID;
        if (!ownerId) {
          return { success: false, error: 'DISCORD_OWNER_ID not set in .env' };
        }

        const connection = voiceManager.getConnection();
        const audioPath = await captureUserAudio(connection, ownerId, duration);

        return {
          success: true,
          message: 'Audio captured successfully',
          audio_file: audioPath,
          note: 'Use transcribeAudio() to convert to text'
        };
      }

      case 'converse': {
        if (!voiceManager.isConnected()) {
          return { success: false, error: 'Not connected to a voice channel. Use join action first.' };
        }

        const ownerId = process.env.DISCORD_OWNER_ID;
        if (!ownerId) {
          return { success: false, error: 'DISCORD_OWNER_ID not set in .env' };
        }

        const connection = voiceManager.getConnection();

        await logEvent('INFO', 'Starting conversation capture', { duration });

        // Capture audio
        const audioPath = await captureUserAudio(connection, ownerId, duration);

        // Transcribe
        const transcription = await transcribeAudio(audioPath);

        // Clean up audio file
        await deleteAudioFile(audioPath);

        return {
          success: true,
          message: 'Audio captured and transcribed',
          transcription,
          user_said: transcription
        };
      }

      case 'speak': {
        if (!text) {
          return { success: false, error: 'text parameter required for speak action' };
        }

        const timestamp = Date.now();
        const outputPath = path.resolve(dataDir, `tts-${timestamp}.opus`);

        await synthesizeSpeech(text, outputPath, voice_style);

        // If connected to voice, also play it
        if (voiceManager.isConnected()) {
          const connection = voiceManager.getConnection();
          await playAudio(connection, outputPath, false); // Don't delete yet

          return {
            success: true,
            message: `Spoke in voice channel: "${text}"`,
            audio_file: outputPath,
            played: true
          };
        } else {
          return {
            success: true,
            message: `Speech synthesized: "${text}"`,
            audio_file: outputPath,
            played: false,
            note: 'Not connected to voice channel. File created but not played.'
          };
        }
      }

      case 'play': {
        if (!voiceManager.isConnected()) {
          return { success: false, error: 'Not connected to a voice channel. Use join action first.' };
        }

        const filePath = audio_file || (text ? null : null);
        if (!filePath) {
          return { success: false, error: 'audio_file parameter required for play action' };
        }

        const connection = voiceManager.getConnection();
        await playAudio(connection, filePath, false); // Don't auto-delete user-specified files

        return {
          success: true,
          message: `Played audio: ${filePath}`
        };
      }

      case 'test_setup': {
        const results = await testSetup();
        return {
          success: true,
          results,
          message: 'Setup test complete. Check results for details.'
        };
      }

      case 'start_conversation': {
        if (!voiceManager.isConnected()) {
          return { success: false, error: 'Not connected to a voice channel. Use join action first.' };
        }

        const ownerId = process.env.DISCORD_OWNER_ID;
        if (!ownerId) {
          return { success: false, error: 'DISCORD_OWNER_ID not set in .env' };
        }

        const connection = voiceManager.getConnection();
        return await startConversationLoop(connection, ownerId, voice_style);
      }

      case 'stop_conversation': {
        return await stopConversationLoop();
      }

      case 'status': {
        const connected = voiceManager.isConnected();
        const playbackStatus = getPlaybackStatus();

        return {
          success: true,
          voice_connection: connected ? 'connected' : 'disconnected',
          playback_status: playbackStatus,
          conversation_loop: conversationLoopActive ? 'active' : 'inactive',
          processing_state: isProcessing ? 'processing' : 'idle',
          capabilities: {
            transcription: 'Whisper (local faster-whisper)',
            synthesis: 'Google Cloud TTS (Australian voice)',
            voice_connection: 'Active (@discordjs/voice)',
            audio_capture: 'Opus → PCM → WAV pipeline',
            audio_playback: 'Opus playback through voice channel',
            conversation_loop: 'Autonomous listen-respond loop',
            claude_integration: 'Haiku with minimal voice-only context'
          },
          config: {
            voice_channel_id: process.env.VOICE_CHANNEL_ID || 'not set',
            owner_id: process.env.DISCORD_OWNER_ID || 'not set'
          }
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    await logEvent('ERROR', 'Execute failed', { action, error: err.message, stack: err.stack });
    return {
      success: false,
      error: err.message,
      details: err.stack
    };
  }
}

/**
 * Initialize voice chat skill with Discord client
 * Sets up auto-join/leave based on owner's voice state
 * @param {Client} client - Discord.js client instance
 */
export function init(client) {
  discordClient = client;
  console.log('[VoiceChat] Skill initialized with Discord client');

  const voiceChannelId = process.env.VOICE_CHANNEL_ID;
  const ownerId = process.env.DISCORD_OWNER_ID;

  if (!voiceChannelId) {
    console.log('[VoiceChat] VOICE_CHANNEL_ID not set — auto-join/leave disabled');
    return;
  }

  if (!ownerId) {
    console.log('[VoiceChat] DISCORD_OWNER_ID not set — auto-join/leave disabled');
    return;
  }

  console.log('[VoiceChat] Auto-join/leave enabled for voice channel:', voiceChannelId);

  // Listen for voice state updates
  client.on('voiceStateUpdate', async (oldState, newState) => {
    // Only respond to the owner's voice state changes
    if (newState.member.id !== ownerId) return;

    try {
      // Owner joined the configured voice channel
      if (newState.channelId === voiceChannelId && oldState.channelId !== voiceChannelId) {
        console.log('[VoiceChat] Owner joined voice channel — auto-joining');
        await logEvent('INFO', 'Auto-join triggered', { channelId: voiceChannelId });

        await voiceManager.joinChannel(client, voiceChannelId, newState.guild.id);
      }

      // Owner left the configured voice channel
      if (oldState.channelId === voiceChannelId && newState.channelId !== voiceChannelId) {
        console.log('[VoiceChat] Owner left voice channel — auto-leaving');
        await logEvent('INFO', 'Auto-leave triggered', { channelId: voiceChannelId });

        // Stop conversation loop if active
        if (conversationLoopActive) {
          await stopConversationLoop();
        }

        await voiceManager.leaveChannel();
      }
    } catch (err) {
      console.error('[VoiceChat] Auto-join/leave error:', err.message);
      await logEvent('ERROR', 'Auto-join/leave failed', { error: err.message });
    }
  });

  // Check if owner is already in the voice channel on startup
  setTimeout(async () => {
    try {
      for (const [, guild] of client.guilds.cache) {
        const channel = guild.channels.cache.get(voiceChannelId);
        if (channel && channel.members) {
          const ownerInChannel = channel.members.has(ownerId);
          if (ownerInChannel) {
            console.log('[VoiceChat] Owner already in voice channel on startup — auto-joining');
            await logEvent('INFO', 'Auto-join on startup', { channelId: voiceChannelId });
            await voiceManager.joinChannel(client, voiceChannelId, guild.id);
            break;
          }
        }
      }
    } catch (err) {
      console.error('[VoiceChat] Startup check error:', err.message);
    }
  }, 2000); // Wait 2 seconds for client to be fully ready
}
