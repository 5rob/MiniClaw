import os
import asyncio
import logging
from pathlib import Path
from dotenv import load_dotenv
import discord
from discord.ext import commands
from gtts import gTTS
import tempfile

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('voice-notify')

# Load environment variables
load_dotenv()

# Configuration - REQUIRED variables
DISCORD_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
WATCH_CHANNEL_ID = os.getenv('WATCH_CHANNEL_ID')
WATCH_USER_ID = os.getenv('WATCH_USER_ID')
VOICE_CHANNEL_ID = os.getenv('VOICE_CHANNEL_ID')
YOUR_USER_ID = os.getenv('YOUR_USER_ID')

# Validate required env vars
required_vars = {
    'DISCORD_BOT_TOKEN': DISCORD_TOKEN,
    'WATCH_CHANNEL_ID': WATCH_CHANNEL_ID,
    'WATCH_USER_ID': WATCH_USER_ID,
    'VOICE_CHANNEL_ID': VOICE_CHANNEL_ID,
    'YOUR_USER_ID': YOUR_USER_ID
}

missing_vars = [name for name, value in required_vars.items() if not value]
if missing_vars:
    logger.error(f"Missing required environment variables: {', '.join(missing_vars)}")
    logger.error("Please check your .env file and ensure all required variables are set.")
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

# Optional configuration
NOTIFICATION_SOUND = os.getenv('NOTIFICATION_SOUND', 'sounds/notification.mp3')

# Convert IDs to integers
try:
    WATCH_CHANNEL_ID = int(WATCH_CHANNEL_ID)
    WATCH_USER_ID = int(WATCH_USER_ID)
    VOICE_CHANNEL_ID = int(VOICE_CHANNEL_ID)
    YOUR_USER_ID = int(YOUR_USER_ID)
except ValueError as e:
    logger.error(f"Invalid ID format in .env file: {e}")
    raise ValueError("Channel/User IDs must be valid integers")

# Bot setup
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
intents.guilds = True

bot = commands.Bot(command_prefix='!', intents=intents)

# Audio queue to prevent overlapping TTS
audio_queue = asyncio.Queue()
is_playing = False

def is_user_in_voice_channel(voice_channel):
    """Check if the target user (Rob) is in the voice channel."""
    for member in voice_channel.members:
        if member.id == YOUR_USER_ID:
            return True
    return False

async def generate_tts(text: str) -> str:
    """Generate TTS audio file and return path."""
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as tmp_file:
            tmp_path = tmp_file.name
        
        # Generate TTS
        tts = gTTS(text=text, lang='en', slow=False)
        tts.save(tmp_path)
        
        logger.info(f"Generated TTS for: {text[:50]}...")
        return tmp_path
    except Exception as e:
        logger.error(f"Error generating TTS: {e}")
        return None

async def play_audio_file(voice_client, file_path: str):
    """Play an audio file in the voice channel."""
    if not voice_client or not voice_client.is_connected():
        logger.warning("Not connected to voice channel, cannot play audio")
        return
    
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            logger.error(f"Audio file not found: {file_path}")
            return
        
        # Play audio
        audio_source = discord.FFmpegPCMAudio(file_path)
        
        # Wait for current audio to finish if playing
        while voice_client.is_playing():
            await asyncio.sleep(0.1)
        
        voice_client.play(audio_source)
        
        # Wait for playback to complete
        while voice_client.is_playing():
            await asyncio.sleep(0.1)
        
        logger.info(f"Finished playing: {file_path}")
    except Exception as e:
        logger.error(f"Error playing audio: {e}")

async def audio_player(voice_client):
    """Background task that processes the audio queue."""
    global is_playing
    
    while True:
        try:
            # Wait for audio file path from queue
            audio_data = await audio_queue.get()
            
            if audio_data is None:  # Shutdown signal
                break
            
            notification_path, tts_path = audio_data
            is_playing = True
            
            # Play notification sound if it exists
            if notification_path and os.path.exists(notification_path):
                await play_audio_file(voice_client, notification_path)
                await asyncio.sleep(0.3)  # Small gap between notification and TTS
            
            # Play TTS
            if tts_path:
                await play_audio_file(voice_client, tts_path)
                
                # Clean up TTS temp file
                try:
                    os.unlink(tts_path)
                except Exception as e:
                    logger.warning(f"Failed to delete temp file {tts_path}: {e}")
            
            is_playing = False
            audio_queue.task_done()
            
        except Exception as e:
            logger.error(f"Error in audio player: {e}")
            is_playing = False

@bot.event
async def on_ready():
    """Called when bot successfully connects to Discord."""
    logger.info(f'Logged in as {bot.user.name} ({bot.user.id})')
    
    # Join the voice channel
    try:
        voice_channel = bot.get_channel(VOICE_CHANNEL_ID)
        if voice_channel is None:
            logger.error(f"Voice channel {VOICE_CHANNEL_ID} not found!")
            return
        
        if not isinstance(voice_channel, discord.VoiceChannel):
            logger.error(f"Channel {VOICE_CHANNEL_ID} is not a voice channel!")
            return
        
        # Connect to voice
        voice_client = await voice_channel.connect()
        logger.info(f"Connected to voice channel: {voice_channel.name}")
        
        # Start audio player task
        bot.loop.create_task(audio_player(voice_client))
        
    except Exception as e:
        logger.error(f"Failed to join voice channel: {e}")

@bot.event
async def on_message(message):
    """Called when a message is sent in any channel the bot can see."""
    # Ignore bot's own messages
    if message.author.bot:
        return
    
    # Check if message is from the watched user in the watched channel
    if message.channel.id != WATCH_CHANNEL_ID:
        return
    
    if message.author.id != WATCH_USER_ID:
        return
    
    # Check if target user (Rob) is in the voice channel
    voice_channel = bot.get_channel(VOICE_CHANNEL_ID)
    if not voice_channel or not is_user_in_voice_channel(voice_channel):
        logger.info(f"Target user not in voice channel, skipping message: {message.content[:50]}")
        return
    
    logger.info(f"Processing message from {message.author.name}: {message.content}")
    
    # Generate TTS
    tts_path = await generate_tts(message.content)
    if not tts_path:
        logger.error("Failed to generate TTS")
        return
    
    # Get notification sound path (if exists)
    notification_path = NOTIFICATION_SOUND if os.path.exists(NOTIFICATION_SOUND) else None
    
    # Add to queue
    await audio_queue.put((notification_path, tts_path))
    logger.info("Added message to audio queue")

@bot.event
async def on_voice_state_update(member, before, after):
    """Handle voice channel disconnections and reconnect if needed."""
    # If bot was disconnected, try to reconnect
    if member.id == bot.user.id and after.channel is None:
        logger.warning("Bot was disconnected from voice, attempting reconnect...")
        await asyncio.sleep(2)  # Brief delay before reconnecting
        
        try:
            voice_channel = bot.get_channel(VOICE_CHANNEL_ID)
            if voice_channel:
                voice_client = await voice_channel.connect()
                logger.info(f"Reconnected to voice channel: {voice_channel.name}")
                # Restart audio player
                bot.loop.create_task(audio_player(voice_client))
        except Exception as e:
            logger.error(f"Failed to reconnect: {e}")

@bot.event
async def on_disconnect():
    """Called when bot disconnects from Discord."""
    logger.warning("Bot disconnected from Discord")

@bot.event
async def on_resumed():
    """Called when bot reconnects to Discord."""
    logger.info("Bot resumed connection to Discord")

async def shutdown():
    """Graceful shutdown."""
    logger.info("Shutting down...")
    
    # Signal audio player to stop
    await audio_queue.put(None)
    
    # Disconnect from voice
    for voice_client in bot.voice_clients:
        await voice_client.disconnect()
    
    await bot.close()

if __name__ == '__main__':
    try:
        logger.info("Starting Voice Notify Bot...")
        logger.info(f"Watching channel: {WATCH_CHANNEL_ID}")
        logger.info(f"Watching user: {WATCH_USER_ID}")
        logger.info(f"Voice channel: {VOICE_CHANNEL_ID}")
        logger.info(f"Target user (Rob): {YOUR_USER_ID}")
        logger.info(f"Notification sound: {NOTIFICATION_SOUND}")
        
        bot.run(DISCORD_TOKEN)
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
        bot.loop.run_until_complete(shutdown())
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise
