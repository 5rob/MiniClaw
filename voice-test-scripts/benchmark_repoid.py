"""
Benchmark using HuggingFace repo ID (auto-resolves cache).
Compare with direct snapshot path approach.
"""
import os
import sys
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import torch
import time
import soundfile as sf
from qwen_tts import Qwen3TTSModel

VOICE_REF = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"
OUTPUT_DIR = r"C:\Users\5robm\Desktop\MiniClaw\voice-test-scripts"

def p(msg):
    print(msg, flush=True)

phrase = "Hey there, how's your evening going?"

p(f"CUDA: {torch.cuda.is_available()} | GPU: {torch.cuda.get_device_name(0)}")

try:
    import flash_attn
    p(f"flash-attn: {flash_attn.__version__}")
except Exception as e:
    p(f"flash-attn: {e}")

# Try loading with repo ID (how HF cache works)
p(f"\nLoading with repo ID 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'...")
t0 = time.time()
model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base")
p(f"Loaded in {time.time()-t0:.2f}s")

# Check what device the model is on
p(f"Model device: {next(model.model.parameters()).device}")

# x_vector mode
p(f"\n--- x_vector mode ---")
t0 = time.time()
vp = model.create_voice_clone_prompt(VOICE_REF, x_vector_only_mode=True)
p(f"Voice cached: {time.time()-t0:.2f}s")

torch.cuda.empty_cache()
p(f"Generating...")
t0 = time.time()
audios, sr = model.generate_voice_clone(text=phrase, voice_clone_prompt=vp)
gen_time = time.time() - t0
audio = audios[0]
dur = len(audio) / sr
p(f"Time: {gen_time:.2f}s | Audio: {dur:.2f}s | RTF: {gen_time/dur:.2f}x")
sf.write(os.path.join(OUTPUT_DIR, "bench_repoid.wav"), audio, sr)

# Second generation (warm)
torch.cuda.empty_cache()
p(f"\nGenerating (warm)...")
t0 = time.time()
audios2, sr2 = model.generate_voice_clone(text="I've been thinking about what you said earlier.", voice_clone_prompt=vp)
gen_time2 = time.time() - t0
audio2 = audios2[0]
dur2 = len(audio2) / sr2
p(f"Time: {gen_time2:.2f}s | Audio: {dur2:.2f}s | RTF: {gen_time2/dur2:.2f}x")

p(f"\nDone.")

del model
torch.cuda.empty_cache()
