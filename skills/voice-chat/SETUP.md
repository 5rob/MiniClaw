# Voice Chat Skill - Setup Guide

Complete installation and configuration guide for the MiniClaw voice chat skill.

## Overview
This skill provides voice interaction capabilities using:
- **Local Whisper** (faster-whisper) for speech-to-text
- **Google Cloud TTS** for text-to-speech with high-quality Australian Neural2 voice
- **Discord voice integration** (requires additional setup)

## Prerequisites
- Python 3.8+ with pip — ✅ You have this (conda)
- CUDA-capable GPU (recommended for Whisper performance) — ✅ You have this
- Google Cloud account (for TTS) — ⚠️ Need to set up
- Discord bot with voice permissions — ✅ Already configured

---

## 1. Whisper Setup (Speech Recognition)

### Install faster-whisper

You'll use **faster-whisper** for local speech-to-text transcription.

**Installation (PowerShell):**
```powershell
pip install faster-whisper
```

**Run from anywhere** — doesn't matter what directory you're in. The package installs globally to your Python environment.

**Verify Installation:**
```powershell
python -c "from faster_whisper import WhisperModel; print('✓ faster-whisper installed')"
```

If that prints `✓ faster-whisper installed`, you're good!

---

### GPU Setup (NVIDIA)

You already have a CUDA-capable GPU. Verify it's accessible:

```powershell
python -c "import torch; print(torch.cuda.is_available())"
```

**Expected output:** `True`

If it says `False`, you may need to install/update CUDA toolkit from: https://developer.nvidia.com/cuda-downloads

---

### Choose Whisper Model

Add to your `.env` file:
```
WHISPER_ENGINE=faster-whisper
WHISPER_MODEL_PATH=base.en
```

**Model Options:**
| Model | Size | VRAM | Speed | Quality |
|-------|------|------|---------|---------|
| tiny.en | 75 MB | ~1 GB | Fastest | Basic |
| base.en | 142 MB | ~1 GB | Fast | Good |
| small.en | 466 MB | ~2 GB | Medium | Better |
| medium.en | 1.5 GB | ~5 GB | Slower | Best |

**Recommended**: `base.en` for balance of speed and accuracy

The model will **auto-download** the first time you use it. No manual download needed!

---

## 2. Google Cloud TTS Setup

### Step 1: Create Google Cloud Account

1. Go to https://console.cloud.google.com/
2. Sign in with your Google account (or create one)
3. Accept the terms of service

---

### Step 2: Create a New Project

1. Click the **project selector** dropdown at the top (or "Select a project")
2. Click **"New Project"**
3. Project name: `miniclaw-voice` (or whatever you prefer)
4. Click **"Create"**
5. Wait a few seconds, then select the new project from the dropdown

---

### Step 3: Enable Cloud Text-to-Speech API

1. In the Google Cloud Console, go to **"APIs & Services"** → **"Library"**
   - Or use this direct link: https://console.cloud.google.com/apis/library
2. Search for: **"Cloud Text-to-Speech API"**
3. Click on it, then click **"Enable"**
4. Wait for it to enable (~10 seconds)

---

### Step 4: Create Service Account

1. Go to **"APIs & Services"** → **"Credentials"**
   - Or: https://console.cloud.google.com/apis/credentials
2. Click **"Create Credentials"** → **"Service Account"**
3. Fill in:
   - **Service account name**: `miniclaw-tts`
   - **Service account ID**: (auto-filled, leave it)
   - **Description**: "TTS for MiniClaw voice chat" (optional)
4. Click **"Create and Continue"**
5. **Grant this service account access to project:**
   - Role: Select **"Cloud Text-to-Speech Admin"** (or just "Editor" for broader access)
   - Click **"Continue"**
6. Skip "Grant users access" (optional step)
7. Click **"Done"**

---

### Step 5: Generate JSON Key

1. You should now see your service account listed on the **Credentials** page
2. Click on the **service account email** (e.g., `miniclaw-tts@yourproject.iam.gserviceaccount.com`)
3. Go to the **"Keys"** tab
4. Click **"Add Key"** → **"Create New Key"**
5. Choose **JSON** format
6. Click **"Create"**
7. A JSON file will download automatically (e.g., `miniclaw-voice-abc123def456.json`)

---

### Step 6: Save the Key File

1. Create a folder for credentials (if you don't have one):
   ```powershell
   mkdir C:\Users\Rob\.credentials
   ```

2. Move the downloaded JSON file there and rename it for clarity:
   ```powershell
   move C:\Users\Rob\Downloads\miniclaw-voice-*.json C:\Users\Rob\.credentials\google-cloud-tts.json
   ```

3. **Verify the file exists:**
   ```powershell
   Test-Path C:\Users\Rob\.credentials\google-cloud-tts.json
   ```
   Should return: `True`

---

### Step 7: Add to .env File

Add this line to your **MiniClaw `.env` file** (use forward slashes even on Windows):

```env
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/Rob/.credentials/google-cloud-tts.json
```

**Important:** Use **forward slashes** (`/`), not backslashes (`\`), even on Windows!

---

### Step 8: Install Python Client Library

```powershell
pip install google-cloud-texttospeech
```

---

### Step 9: Test the Setup

```powershell
python -c "from google.cloud import texttospeech; client = texttospeech.TextToSpeechClient(); print('✓ Google Cloud TTS configured successfully')"
```

**Expected output:** `✓ Google Cloud TTS configured successfully`

If you get an error, double-check:
- The JSON file path in `.env` is correct (forward slashes!)
- The JSON file actually exists at that location
- You've enabled the Text-to-Speech API in Google Cloud Console

---

## 3. Environment Variables

Add these to your **MiniClaw `.env` file**:

```env
# Whisper (new)
WHISPER_ENGINE=faster-whisper
WHISPER_MODEL_PATH=base.en

# Google Cloud TTS (new)
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/Rob/.credentials/google-cloud-tts.json

# Voice channel (optional, can configure later)
VOICE_CHANNEL_ID=your_channel_id_here
```

**To get your Voice Channel ID:**
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click on "general voice" channel → Copy ID
3. Paste into `.env`

---

## 4. Install Discord Voice Dependencies

The voice-chat skill needs Discord voice libraries to connect to voice channels.

**Install for staging bot (PowerShell):**
```powershell
cd C:\Users\Rob\Desktop\MiniClaw\staging
npm install @discordjs/voice @discordjs/opus
```

**Also install for live bot:**
```powershell
cd C:\Users\Rob\Desktop\MiniClaw
npm install @discordjs/voice @discordjs/opus
```

---

## 5. Verify Installation

Once you've completed all steps above, test the setup in Discord:

**In #staging (after restarting Tester Bud):**
```
User: "Test my voice chat setup"
```

**Expected Output:**
```json
{
  "whisper": {
    "status": "ready",
    "engine": "faster-whisper",
    "model": "base.en"
  },
  "tts": {
    "status": "ready",
    "provider": "Google Cloud TTS"
  },
  "env": {
    "WHISPER_ENGINE": "faster-whisper",
    "WHISPER_MODEL_PATH": "base.en",
    "GOOGLE_APPLICATION_CREDENTIALS": "set",
    "VOICE_CHANNEL_ID": "set (or not set)"
  }
}
```

---

## 6. Usage Examples

Once setup is complete:

**Test TTS Generation:**
```
User: "Say 'G'day mate' in voice"
```

The bot will generate an audio file with high-quality Australian Neural2 voice and save it to `skills/voice-chat/data/audio/`.

**Test Transcription (once audio capture is wired up):**
```
User: "Transcribe this: [audio file]"
```

---

## Quick Setup Checklist

- [ ] Install `faster-whisper`: `pip install faster-whisper`
- [ ] Install Google TTS client: `pip install google-cloud-texttospeech`
- [ ] Create Google Cloud project and enable Text-to-Speech API
- [ ] Create service account and download JSON key
- [ ] Save JSON key to `C:\Users\Rob\.credentials\google-cloud-tts.json`
- [ ] Add `GOOGLE_APPLICATION_CREDENTIALS` to `.env` (with forward slashes!)
- [ ] Install Discord voice deps: `npm install @discordjs/voice @discordjs/opus`
- [ ] Add `WHISPER_ENGINE=faster-whisper` to `.env`
- [ ] Add `WHISPER_MODEL_PATH=base.en` to `.env`
- [ ] Get voice channel ID and add to `.env` (optional)
- [ ] Test setup: "Test my voice chat setup" in Discord

---

## Troubleshooting

### "ModuleNotFoundError: No module named 'faster_whisper'"
Run: `pip install faster-whisper`

### "torch.cuda.is_available() returns False"
Your GPU isn't accessible to PyTorch. Install CUDA toolkit: https://developer.nvidia.com/cuda-downloads

### "Could not automatically determine credentials"
- Check that `GOOGLE_APPLICATION_CREDENTIALS` is set in `.env`
- Verify the path uses **forward slashes** (`/` not `\`)
- Confirm the JSON file exists at that exact path
- Try restarting the bot after setting the env variable

### "google.auth.exceptions.DefaultCredentialsError"
The JSON key file is missing or invalid. Re-download from Google Cloud Console.

### "API has not been used in project before or it is disabled"
You forgot to enable the Cloud Text-to-Speech API. Go to APIs & Services → Library → enable it.

### "npm install fails"
Make sure you're in the correct directory (`staging/` or project root) and have Node.js installed.

---

## Performance Notes

**Expected Performance (base.en model on GPU):**
- Transcription: ~1-2 seconds for 5-10 seconds of audio
- TTS Generation: ~1 second for short phrases
- Total latency: 3-5 seconds (wake word → response)

**Memory Usage:**
- Whisper base.en: ~1 GB VRAM
- faster-whisper: ~200 MB RAM
- Google TTS: negligible

---

## Cost Considerations

**Local Whisper:**
- ✅ **FREE** — runs entirely on your GPU

**Google Cloud TTS:**
- **Free tier**: 0-4 million characters per month (depends on features used)
  - Standard voices: 4 million chars/month free
  - WaveNet/Neural2 voices: 1 million chars/month free
- **After free tier**: $4-16 per 1 million characters (varies by voice type)
- **Your expected usage**: 10k-50k chars/month for casual voice chat → **stays well within free tier**
- **Example**: "Hey, what's up?" = ~15 characters. You'd need ~66,000 responses to hit the free tier limit.

**Credit card required?** Yes, Google Cloud requires a payment method even for free tier, but you won't be charged unless you explicitly upgrade or exceed limits.

---

## What's Next?

Once setup is verified, the skill is ready to use for:
- ✅ TTS generation (working now)
- ✅ Whisper transcription (working now)
- ⏳ Voice channel integration (requires bot-level code changes)

The `.integration-notes.md` file has code examples for wiring up Discord voice channel audio capture and playback. That's the final step to get full voice chat working!

---

## System Requirements Summary

| Component | Requirement | Your Setup |
|-----------|-------------|------------|
| OS | Windows 10/11 | ✅ Windows |
| Python | 3.8+ | ✅ Installed (with conda) |
| GPU | CUDA-capable NVIDIA | ✅ You have this |
| RAM | 8 GB+ | ✅ Likely sufficient |
| Disk | ~5 GB (for models) | ✅ Should be fine |
| Node.js | 16+ | ✅ Installed |
| Discord | Bot with voice perms | ✅ Already configured |
| Google Cloud | Account + billing | ⚠️ Need to set up |

---

Ready to get started? Follow the checklist step-by-step and reach out if you hit any snags!