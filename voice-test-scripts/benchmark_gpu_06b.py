"""
Benchmark 0.6B model on GPU with flash-attn.
"""
import os
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

phrases = [
    "Hey there, how's your evening going?",
    "I've been thinking about what you said earlier, and I think you're absolutely right.",
    "Oh come on, you can't be serious right now!",
]

p(f"CUDA: {torch.cuda.is_available()} | GPU: {torch.cuda.get_device_name(0)}")

try:
    import flash_attn
    p(f"flash-attn: {flash_attn.__version__}")
except Exception as e:
    p(f"flash-attn: {e}")

p(f"\nLoading 0.6B model on GPU...")
t0 = time.time()
model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    device_map="auto",
    dtype=torch.bfloat16,
)
load_time = time.time() - t0
p(f"Loaded in {load_time:.2f}s")
p(f"Model device: {next(model.model.parameters()).device}")

p(f"\nCaching voice embedding...")
t0 = time.time()
vp = model.create_voice_clone_prompt(VOICE_REF, x_vector_only_mode=True)
cache_time = time.time() - t0
p(f"Voice cached: {cache_time:.2f}s")

times = []
for i, phrase in enumerate(phrases):
    torch.cuda.empty_cache()
    p(f"\nGenerating [{i+1}/{len(phrases)}]: \"{phrase[:50]}\"")
    
    t0 = time.time()
    audios, sr = model.generate_voice_clone(text=phrase, voice_clone_prompt=vp)
    gen_time = time.time() - t0
    
    audio = audios[0]
    dur = len(audio) / sr
    rtf = gen_time / dur if dur > 0 else 0
    times.append(gen_time)
    
    outfile = os.path.join(OUTPUT_DIR, f"bench_gpu_06b_{i}.wav")
    sf.write(outfile, audio, sr)
    p(f"  Time: {gen_time:.2f}s | Audio: {dur:.2f}s | RTF: {rtf:.2f}x")

avg = sum(times) / len(times)
p(f"\n{'='*60}")
p(f"GPU RESULTS (0.6B + flash-attn + bfloat16)")
p(f"{'='*60}")
p(f"Average: {avg:.2f}s")
p(f"Min: {min(times):.2f}s | Max: {max(times):.2f}s")
p(f"Voice cache: {cache_time:.2f}s")
p(f"Model load: {load_time:.2f}s")
p(f"VRAM: {torch.cuda.max_memory_allocated()/1024**3:.2f} GB")

del model
torch.cuda.empty_cache()
