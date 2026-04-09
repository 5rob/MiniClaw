# Voice Chat Skill

## Overview
Full Discord voice channel integration for MiniClaw. Enables the bot to join voice channels, listen to the user's voice, transcribe speech using Whisper, and respond with Google Cloud TTS audio played back through the voice channel.

## Status: Production Ready ✅
- ✅ Whisper transcription (local GPU-accelerated)
- ✅ Google Cloud TTS synthesis (Australian voice)
- ✅ Discord voice connection (@discordjs/voice integrated)
- ✅ Audio capture pipeline (Opus → PCM → WAV)
- ✅ Audio playback pipeline (Opus → Discord voice)
- ✅ Auto join/leave based on owner's voice state
- ✅ Silence detection for natural conversation flow

## Features
- **Voice Connection Management**: Join/leave voice channels with auto-reconnect
- **Audio Capture**: Capture user's voice from Discord with silence detection
- **Speech Transcription**: Convert voice to text using local faster-whisper
- **Text-to-Speech**: Generate natural speech with Google Cloud TTS (Australian voice)
- **Audio Playback**: Play TTS responses through the voice channel
- **Auto Join/Leave**: Bot automatically joins when owner joins configured channel

## Actions

### `start_conversation`
**NEW:** Start autonomous conversation loop that actively listens and responds.
- Automatically captures audio when the owner starts speaking
- Transcribes speech using Whisper
- Generates response (currently echo, TODO: Claude Haiku integration)
- Speaks response via TTS
- Returns to listening state
- Loops continuously until stopped

**Parameters**:
- `voice_style` (optional): casual, professional, excited, calm (default: casual)

**Example trigger**: "Start talking to me", "Begin voice conversation"

**Example**:
```javascript
{
  action: 'start_conversation',
  voice_style: 'casual'
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Conversation loop started",
  listening_for: "987654321"
}
```

**Note**: This is the main autonomous mode. The bot will actively listen for your voice and respond automatically. Use `stop_conversation` to end the loop.

### `stop_conversation`
Stop the autonomous conversation loop.

**Example trigger**: "Stop listening"

**Example**:
```javascript
{
  action: 'stop_conversation'
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Conversation loop stopped"
}
```

### `join`
Join the configured voice channel.
- Reads `VOICE_CHANNEL_ID` from .env
- Auto-detects the guild containing the channel
- Establishes persistent voice connection with auto-reconnect

**Example trigger**: "Join voice channel"

**Example**:
```javascript
{
  action: 'join'
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Joined voice channel in Guild Name",
  channel_id: "123456789",
  guild_id: "987654321"
}
```

### `leave`
Leave the current voice channel.

**Example trigger**: "Leave voice chat"

**Example**:
```javascript
{
  action: 'leave'
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Left voice channel"
}
```

### `listen`
Capture audio from the owner's voice in the channel and save as WAV file.
- Captures until 1.5 seconds of silence detected
- Maximum recording duration: 30 seconds (configurable)
- Returns path to WAV file for transcription

**Parameters**:
- `duration` (optional): Max recording time in seconds (default: 30)

**Example**:
```javascript
{
  action: 'listen',
  duration: 30
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Audio captured successfully",
  audio_file: "/path/to/capture-123456.wav"
}
```

### `converse`
Full conversation loop: capture audio → transcribe → return text.
- Captures owner's voice
- Transcribes using Whisper
- Cleans up temp audio files
- Returns transcription text

**Parameters**:
- `duration` (optional): Max recording time in seconds (default: 30)

**Example trigger**: "Listen to what I'm saying"

**Example**:
```javascript
{
  action: 'converse',
  duration: 30
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Audio captured and transcribed",
  transcription: "Hey mate, how's it going?",
  user_said: "Hey mate, how's it going?"
}
```

### `speak`
Generate TTS audio and play it through the voice channel (if connected).
- Synthesizes text using Google Cloud TTS
- Australian male voice with style variations
- Automatically plays if connected to voice
- Saves .opus file to data/ directory

**Parameters**:
- `text` (required): Text to synthesize
- `voice_style` (optional): casual, professional, excited, calm (default: casual)

**Example trigger**: "Say 'Hello' in voice chat"

**Example**:
```javascript
{
  action: 'speak',
  text: "G'day mate, how's it going?",
  voice_style: 'casual'
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Spoke in voice channel: \"G'day mate...\"",
  audio_file: "/path/to/tts-123456.opus",
  played: true
}
```

### `play`
Play a pre-generated audio file through the voice channel.

**Parameters**:
- `audio_file` (required): Path to .opus audio file

**Example**:
```javascript
{
  action: 'play',
  audio_file: "/path/to/tts-123456.opus"
}
```

**Returns**:
```javascript
{
  success: true,
  message: "Played audio: /path/to/tts-123456.opus"
}
```

### `status`
Check voice connection status and skill capabilities.
- Reports connection state (connected/disconnected)
- Shows playback status (idle/playing)
- Lists all capabilities and configuration

**Example trigger**: "Voice status"

**Example**:
```javascript
{
  action: 'status'
}
```

**Returns**:
```javascript
{
  success: true,
  voice_connection: "connected",
  playback_status: "idle",
  capabilities: {
    transcription: "Whisper (local faster-whisper)",
    synthesis: "Google Cloud TTS (Australian voice)",
    voice_connection: "Active (@discordjs/voice)",
    audio_capture: "Opus → PCM → WAV pipeline",
    audio_playback: "Opus playback through voice channel"
  },
  config: {
    voice_channel_id: "123456789",
    owner_id: "987654321"
  }
}
```

### `test_setup`
Verify Whisper and TTS configuration.
- Tests faster-whisper Python module
- Tests Google Cloud TTS Python module
- Reports environment variable status

**Example trigger**: "Test voice setup"

**Example**:
```javascript
{
  action: 'test_setup'
}
```

**Returns**:
```javascript
{
  success: true,
  results: {
    whisper: { status: 'ready', details: 'faster-whisper module found' },
    tts: { status: 'ready', details: 'Google Cloud TTS module found' },
    env: {
      WHISPER_PATH: 'not set (using default)',
      WHISPER_MODEL_PATH: 'base.en',
      WHISPER_ENGINE: 'faster-whisper',
      GOOGLE_APPLICATION_CREDENTIALS: 'set',
      VOICE_CHANNEL_ID: '123456789'
    }
  }
}
```

## Voice Styles
The `speak` action supports different voice styles via TTS parameters:

| Style | Pitch | Speed | Use Case |
|-------|-------|-------|----------|
| casual | 0 | 1.1x | Normal conversation (default) |
| professional | -2 | 1.0x | Formal responses |
| excited | +4 | 1.2x | Enthusiastic reactions |
| calm | -1 | 0.9x | Soothing, deliberate speech |

## Auto Join/Leave
When initialized with the Discord client, the skill automatically:
- Joins the configured voice channel when the owner joins
- Leaves when the owner leaves
- Checks on startup if owner is already in the channel

This is configured through the `init(client)` function called from discord.js.

## Audio Pipeline

### Capture (Discord → WAV)
1. Discord voice (Opus packets)
2. Opus decoder (prism-media)
3. Raw PCM (signed 16-bit LE, 48kHz, stereo)
4. WAV file (with header)
5. Ready for Whisper transcription

### Playback (TTS → Discord)
1. Google Cloud TTS generates .opus file
2. Audio resource created from file
3. Audio player plays through voice connection
4. File cleaned up after playback

## Configuration

### Required Environment Variables
- `VOICE_CHANNEL_ID` — Discord voice channel ID to join
- `DISCORD_OWNER_ID` — Discord user ID to listen to (for audio capture)
- `GOOGLE_APPLICATION_CREDENTIALS` — Path to Google Cloud service account JSON
- `WHISPER_MODEL_PATH` — Whisper model name (e.g., "base.en", "medium")
- `WHISPER_ENGINE` — Set to "faster-whisper" (default)

### Dependencies
All dependencies are already installed in the main MiniClaw package:
- `@discordjs/voice` — Voice connections
- `@discordjs/opus` — Opus encoding/decoding
- `discord.js` v14+ — Discord client with GuildVoiceStates intent
- Python packages: `faster-whisper`, `google-cloud-texttospeech`

## File Structure
```
skills/voice-chat/
├── handler.js           # Main skill handler with execute() and init()
├── voice-manager.js     # Voice connection management
├── audio-capture.js     # Discord audio capture → WAV conversion
├── audio-playback.js    # TTS playback through voice channel
├── SKILL.md            # This file
├── PROGRESS.md         # Development log
├── data/               # Temp audio files (.opus, .wav)
└── logs/               # Event logs
```

## Conversation Loop States

The autonomous conversation loop has these states:
- **Idle**: Loop is active, waiting for user to speak
- **Processing**: User spoke, capturing/transcribing/responding
- **Speaking**: Bot is playing TTS response

The loop ensures only one utterance is processed at a time to avoid overlapping conversations.

## Typical Usage Flow

### Autonomous Voice Conversation (Recommended)
1. Owner joins configured voice channel
2. Bot auto-joins
3. Claude invokes: `voice_chat.start_conversation`
4. Bot enters listening state
5. When owner speaks:
   - Bot captures audio automatically
   - Transcribes speech
   - Generates response (TODO: Claude Haiku)
   - Speaks response
   - Returns to listening
6. Loop continues until stopped
7. Claude invokes: `voice_chat.stop_conversation` when done

### Manual Voice Conversation
1. Owner joins configured voice channel
2. Bot auto-joins
3. User speaks in voice channel
4. Claude invokes: `voice_chat.converse`
5. Audio is captured, transcribed, and returned as text
6. Claude processes the transcription
7. Claude invokes: `voice_chat.speak` with response text
8. Bot speaks the response in voice channel

### Manual Control
1. Claude invokes: `voice_chat.join`
2. Claude invokes: `voice_chat.converse` to listen
3. Claude processes user's speech
4. Claude invokes: `voice_chat.speak` to respond
5. Claude invokes: `voice_chat.leave` when done

## Example Trigger Phrases
- "Start talking to me" → `start_conversation`
- "Begin voice conversation" → `start_conversation`
- "Stop listening" → `stop_conversation`
- "Join voice channel" → `join`
- "Leave voice chat" → `leave`
- "Talk to me" (one-time) → `converse`
- "Listen to what I'm saying" → `converse`
- "Say [text] in voice" → `speak`
- "Voice status" → `status`
- "Test voice setup" → `test_setup`

## Technical Notes

### Silence Detection
Audio capture uses `EndBehaviorType.AfterSilence` with 1.5 seconds threshold. This means:
- Capture continues while user is speaking
- Ends automatically after 1.5s of silence
- Maximum duration timeout prevents infinite recording

### Audio Format
- **Discord Native**: Opus packets
- **Capture Output**: WAV (48kHz, 16-bit, stereo) for Whisper
- **TTS Output**: Opus for Discord playback

### Error Handling
- Non-throwing errors (returns `{ success: false, error: '...' }`)
- All events logged to skill's logs directory
- Voice connection failures don't crash the main bot
- Auto-reconnect with exponential backoff (max 5 attempts)

### Performance Targets
- Transcription: 1-2 seconds (with GPU)
- TTS synthesis: 0.5-1 second
- Total latency: 2-4 seconds for full conversation loop

## Future Enhancements
- **Claude Haiku Integration**: Replace echo response with actual Claude API calls
- **Wake word detection**: Porcupine integration for "Hey bud" detection
- **Visual status indicators**: Discord presence/status showing listening/processing/speaking states
- **Streaming TTS**: Faster response with streaming audio generation
- **Multi-user conversation**: Support group voice conversations
- **Task delegation**: Route simple questions to Haiku, complex tasks to Sonnet/Opus with background processing
- **Conversation memory**: Store transcripts for context across sessions

## Troubleshooting

**"Voice chat not initialized"**
→ The init() function wasn't called. Check discord.js initialization.

**"Not connected to a voice channel"**
→ Use the `join` action first, or wait for auto-join when you enter the configured channel.

**"No audio received from user"**
→ Check that the user is speaking and Discord permissions are correct. Bot needs permission to receive voice.

**"faster-whisper import failed"**
→ Run `pip install faster-whisper` and ensure CUDA is available.

**"GOOGLE_APPLICATION_CREDENTIALS not set"**
→ Set environment variable to service account JSON path.

**TTS synthesis fails**
→ Check Google Cloud credentials and API quota limits.

**Slow transcription**
→ Verify GPU is available (CUDA) or use smaller Whisper model (base.en).

## Data Storage
- **data/**: TTS audio files (tts-{timestamp}.opus), temp capture files
- **logs/**: Event logs with timestamps, levels, and metadata
