"""
Simple test to verify voice cloning works with the Base model
"""
from qwen_tts import Qwen3TTSModel
import torch
import soundfile as sf
import time
import os

# Use forward slashes or os.path.join for cross-platform compatibility
reference_voice = os.path.join("C:", os.sep, "Users", "5robm", "Desktop", "MiniClaw", "skills", "voice-chat", "companion_voice_test_v2.wav")

# Verify file exists
if not os.path.exists(reference_voice):
    print(f"ERROR: Reference audio not found at: {reference_voice}")
    exit(1)

print(f"Reference audio found: {reference_voice}\n")

print("Loading TTS model...")
print("Using Hugging Face repo: Qwen/Qwen3-TTS-12Hz-1.7B-Base")
start = time.time()

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    device_map="cuda:0"
)

load_time = time.time() - start
print(f"Model loaded in {load_time:.2f}s\n")

# Test voice cloning
test_text = "Hey there, I'm testing out my new voice! How do I sound?"

print(f"Generating speech: \"{test_text}\"")
print("Using voice cloning from reference audio...")

tts_start = time.time()
wavs, sample_rate = model.generate_voice_clone(
    text=test_text,
    ref_audio=reference_voice,
    language="English"
)
tts_time = time.time() - tts_start

output_file = "test_cloned_voice.wav"
sf.write(output_file, wavs[0], sample_rate)

print(f"\nTTS generation time: {tts_time:.2f}s")
print(f"Saved to: {output_file}")
print("\nPlay the file to verify the voice sounds like the reference!")
