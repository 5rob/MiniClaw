# Voice Notify Bot

A Discord bot that reads messages from a specific user in a text channel and plays them as text-to-speech in a voice channel.

## Use Case

Rob wears an earbud and stays connected to a Discord voice channel. When Nicole messages in their private text channel, the bot plays a notification sound followed by TTS of her message — allowing Rob to hear messages while his hands are busy and his phone is locked.

## Features

- 🔊 **24/7 voice presence** — Bot stays connected to a voice channel
- 📢 **Notification + TTS** — Plays a chime before reading each message
- 📱 **Works with locked phone** — Discord voice channels stay active when phone is locked
- 🎯 **Filtered listening** — Only reads messages from specified user in specified channel
- 🔄 **Auto-reconnect** — Rejoins voice channel if disconnected
- 📋 **Message queue** — Handles multiple messages in sequence without overlap

## Requirements

- Python 3.8+
- FFmpeg (for audio playback)
- Discord bot token with:
  - Read Messages permission
  - Connect to Voice permission
  - Speak in Voice permission
  - Message Content Intent enabled

## Installation

### 1. Install FFmpeg

**Windows:**
```bash
# Using Chocolatey
choco install ffmpeg

# Or download from: https://ffmpeg.org/download.html
# Add FFmpeg to PATH
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg  # Debian/Ubuntu
sudo yum install ffmpeg  # CentOS/RHEL
```

### 2. Install Python Dependencies

```bash
cd apps/voice-notify
pip install -r requirements.txt
```

### 3. Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Go to "Bot" tab → "Add Bot"
4. Copy the bot token (you'll need this for .env)
5. Enable "Message Content Intent" under Privileged Gateway Intents
6. Go to "OAuth2" → "URL Generator"
   - Select scopes: `bot`
   - Select permissions: `Connect`, `Speak`, `Read Messages/View Channels`, `Read Message History`
7. Copy the generated URL and open it in your browser to invite the bot to your server

### 4. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your values
```

**How to get Discord IDs:**
1. Enable Developer Mode: User Settings → Advanced → Developer Mode
2. Right-click any channel/user → "Copy ID"

Fill in `.env`:
- `DISCORD_BOT_TOKEN` — from step 3 above
- `WATCH_CHANNEL_ID` — the text channel to monitor (your private channel with Nicole)
- `WATCH_USER_ID` — Nicole's Discord user ID
- `VOICE_CHANNEL_ID` — the voice channel where the bot should sit

### 5. Add Notification Sound (Optional)

Place a short audio file at `sounds/ding.mp3`. If you don't have one, the bot will skip the notification sound and just play TTS.

**Free notification sounds:**
- https://notificationsounds.com/
- https://freesound.org/

Pick something short (~0.5-1 second) and soft.

## Usage

### Start the bot

```bash
cd apps/voice-notify
python bot.py
```

You should see:
```
INFO - Logged in as YourBotName (ID: ...)
INFO - Connected to voice channel: YourVoiceChannel
INFO - Voice notify bot is ready!
```

### How to use

1. **Join the voice channel** — Connect to the same voice channel as the bot
2. **Lock your phone** (or minimize Discord) — Audio will keep playing
3. **When Nicole messages** — You'll hear a notification sound + her message read aloud
4. **Stay hands-free** — You can listen without looking at your phone

### Stopping the bot

Press `Ctrl+C` in the terminal. The bot will disconnect gracefully.

## Running 24/7

To keep the bot running continuously:

**Option 1: Screen/tmux (Linux/macOS)**
```bash
screen -S voice-notify
python bot.py
# Press Ctrl+A, then D to detach
# Reattach with: screen -r voice-notify
```

**Option 2: systemd service (Linux)**
Create `/etc/systemd/system/voice-notify.service`:
```ini
[Unit]
Description=Discord Voice Notify Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/apps/voice-notify
ExecStart=/usr/bin/python3 bot.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable voice-notify
sudo systemctl start voice-notify
```

**Option 3: Docker (future enhancement)**

## Troubleshooting

### "FFmpeg not found"
- Make sure FFmpeg is installed and in your PATH
- Test: `ffmpeg -version` should work

### "Voice channel not found"
- Make sure the bot is invited to your server
- Check that `VOICE_CHANNEL_ID` is correct
- Ensure the bot has "Connect" permission for that channel

### "Bot doesn't read messages"
- Check `WATCH_CHANNEL_ID` is correct
- Check `WATCH_USER_ID` is correct (Nicole's ID, not yours)
- Make sure "Message Content Intent" is enabled in Discord Developer Portal

### "No audio plays"
- Make sure you're in the same voice channel as the bot
- Check that FFmpeg is installed
- Try restarting the bot

### "Bot disconnects randomly"
- This can happen due to network issues
- The bot will auto-reconnect when disconnected
- If it doesn't, restart the bot

## Configuration

All configuration is in `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Your bot's token from Discord Developer Portal | `MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GhIjKl...` |
| `WATCH_CHANNEL_ID` | Text channel to monitor | `123456789012345678` |
| `WATCH_USER_ID` | User ID to listen for (Nicole) | `987654321098765432` |
| `VOICE_CHANNEL_ID` | Voice channel where bot sits | `111222333444555666` |
| `NOTIFICATION_SOUND` | Path to notification sound file | `sounds/ding.mp3` |

## Limitations

- **TTS quality** — Uses Google TTS (free tier), sounds robotic but clear
- **Latency** — 1-3 second delay between message send and audio playback
- **Battery usage** — Voice connection uses more battery than idle Discord
- **Rate limits** — Google TTS has rate limits (shouldn't be an issue for personal use)
- **No message filtering** — Reads ALL messages from watched user in watched channel (including emojis, links, etc.)

## Future Enhancements

- [ ] Customizable voice/accent
- [ ] Filter short messages (e.g., ignore "k" or single emoji)
- [ ] Pause/resume command
- [ ] Multiple watched users
- [ ] Wake word detection (e.g., "Hey bot, read messages")
- [ ] Web dashboard for configuration
- [ ] Docker image for easy deployment

## License

MIT — use however you like!
