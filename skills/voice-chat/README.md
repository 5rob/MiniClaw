# Voice Chat Skill

Voice interaction skill for MiniClaw Discord bot with local Whisper transcription and Google Cloud TTS.

## Quick Status

✅ **Working**: TTS synthesis, Whisper transcription, setup testing
⚠️ **In Progress**: Discord voice integration (capture/playback)
❌ **Not Started**: Wake word detection (requires standalone app)

## Files

- **handler.js** - Main skill implementation
- **SKILL.md** - Complete documentation and usage guide
- **SETUP.md** - Installation and configuration instructions
- **PROGRESS.md** - Development log and technical notes
- **data/** - TTS audio output files
- **logs/** - Event logs (voice-chat-YYYY-MM-DD.log)

## Quick Start

1. **Install dependencies:**
   ```bash
   pip install faster-whisper google-cloud-texttospeech
   ```

2. **Configure environment:**
   ```bash
   # Add to MiniClaw .env
   WHISPER_ENGINE=faster-whisper
   WHISPER_MODEL_PATH=base.en
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   ```

3. **Test setup:**
   In Discord: "Test my voice chat setup"

4. **Try TTS:**
   In Discord: "Say 'G'day mate' in voice"

## What It Does

- 🎤 Transcribes speech via local Whisper (GPU-accelerated)
- 🗣️ Synthesizes speech via Google Cloud TTS (Australian voice)
- 🔧 Validates setup and configuration
- 📊 Reports status and capabilities

## What's Missing

- Discord voice channel integration (@discordjs/voice)
- Audio capture from voice channels
- Audio playback in voice channels
- Wake word detection ("Hey bud")
- Voice Activity Detection (auto-stop recording)

## Usage Examples

```
User: "Test my voice chat setup"
→ Validates Whisper and TTS configuration

User: "Say 'Ready when you are' in voice"
→ Creates TTS audio file

User: "Say 'This is important' in a professional voice"
→ Uses professional voice style

User: "Is voice chat working?"
→ Shows status and capabilities
```

## Voice Styles

- **casual** (default) - Normal conversation
- **professional** - Formal tone
- **excited** - Enthusiastic, fast
- **calm** - Soothing, slow

## Architecture

Modular pipeline designed for future task delegation:

```
captureAudio() → transcribe() → process(model, immediate) → speak()
```

Future routing:
- Simple questions → Haiku (immediate voice response)
- Complex tasks → Sonnet/Opus (background, notify when done)

## Performance

- Whisper (GPU): ~1-2 seconds for 10-second clip
- TTS synthesis: ~0.5-1 second
- Total latency: 2-4 seconds (once voice integration complete)

## Requirements

- Python 3.8+ with faster-whisper
- Google Cloud account with TTS API enabled
- NVIDIA GPU recommended (CUDA support)
- Discord bot with voice permissions

## Documentation

- **SKILL.md** - Full feature documentation
- **SETUP.md** - Step-by-step installation guide
- **PROGRESS.md** - Development notes and decisions

## Troubleshooting

Check logs: `logs/voice-chat-YYYY-MM-DD.log`

Common issues:
- "faster-whisper import failed" → `pip install faster-whisper`
- "Google Cloud TTS error" → Check GOOGLE_APPLICATION_CREDENTIALS path
- "Discord voice integration required" → Expected (not yet implemented)

## Next Steps

1. Install @discordjs/voice in main bot
2. Implement voice channel join/leave
3. Add audio capture from voice channels
4. Add audio playback for TTS responses
5. Implement Voice Activity Detection
6. Add manual triggers (!listen, emoji reactions)

## License

Part of MiniClaw Discord bot project.
