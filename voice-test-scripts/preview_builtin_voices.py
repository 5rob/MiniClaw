from qwen_tts import Qwen3TTSModel
import torch
import soundfile as sf
from pathlib import Path
import os

# Force offline mode - don't hit HuggingFace servers
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

# Model configuration
model_id = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"

# Supported voices
VOICES = ['aiden', 'dylan', 'eric', 'ono_anna', 'ryan', 'serena', 'sohee', 'uncle_fu', 'vivian']

# Test phrase
test_text = "Hey there. I'm here to help with whatever you need. How's your day going?"

print(f"Loading Qwen3-TTS CustomVoice model from HuggingFace cache...")
print(f"Model ID: {model_id}")
print("Offline mode: ENABLED\n")

# Load model from HuggingFace cache - fully offline
model = Qwen3TTSModel.from_pretrained(
    model_id,
    device_map="cuda:0",
    dtype=torch.bfloat16,
    local_files_only=True,
    trust_remote_code=True,
)

print("Model loaded successfully!\n")

# Create output directory
script_dir = Path(__file__).parent
output_dir = script_dir / "voice-samples"
output_dir.mkdir(exist_ok=True)

print(f"Generating audio samples for {len(VOICES)} voices...")
print(f"Output directory: {output_dir}\n")

# Generate samples
for i, speaker in enumerate(VOICES, 1):
    print(f"[{i}/{len(VOICES)}] Generating {speaker}...")
    try:
        wavs, sr = model.generate_custom_voice(
            text=test_text,
            language="English",
            speaker=speaker,
        )
        
        # Save to file
        output_file = output_dir / f"{i:02d}_{speaker}.wav"
        sf.write(output_file, wavs[0], sr)
        print(f"    ✓ Saved: {output_file.name}")
        
    except Exception as e:
        print(f"    ✗ Failed: {e}")

print(f"\nDone! All voice samples saved to: {output_dir}")
print("\nListen to the samples and pick your favorite speaker name!")
