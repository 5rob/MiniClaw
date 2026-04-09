"""
Benchmark TTS WITHOUT flash-attn for comparison.
Disables flash-attn import to force SDPA/default attention.
"""
import os
import sys
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
# Block flash_attn from loading
os.environ['ATTN_BACKEND'] = 'sdpa'

import torch
import time

# Try to prevent flash_attn from being used
# Monkey-patch: pretend flash_attn doesn't exist
import importlib
_original_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__

def patched_import(name, *args, **kwargs):
    if 'flash_attn' in name:
        raise ImportError("Blocked for benchmarking")
    return _original_import(name, *args, **kwargs)

import builtins
builtins.__import__ = patched_import

import soundfile as sf
from qwen_tts import Qwen3TTSModel

VOICE_REF = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"
OUTPUT_DIR = r"C:\Users\5robm\Desktop\MiniClaw\voice-test-scripts"
MODEL_PATH = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\models\Qwen3-TTS-12Hz-1.7B-Base\snapshots\fd4b254389122332181a7c3db7f27e918eec64e3"

def p(msg):
    print(msg, flush=True)

phrase = "Hey there, how's your evening going?"

p(f"CUDA: {torch.cuda.is_available()} | GPU: {torch.cuda.get_device_name(0)}")
p("flash-attn: BLOCKED (testing without)")

p(f"\nLoading model...")
t0 = time.time()
model = Qwen3TTSModel.from_pretrained(MODEL_PATH, attn_implementation="sdpa")
p(f"Loaded in {time.time()-t0:.2f}s")

# x_vector mode only (simpler)
p(f"\n--- x_vector mode (no flash-attn) ---")
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
sf.write(os.path.join(OUTPUT_DIR, "bench_xvec_noflash.wav"), audio, sr)

p(f"\nDone. Time={gen_time:.2f}s")

del model
torch.cuda.empty_cache()
