"""
0.6B model - optimal configuration.
Cache clearing with torch only (no gc.collect), 
measures realistic conversation latency.
"""
import torch
import soundfile as sf
import time
from qwen_tts import Qwen3TTSModel

TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
REFERENCE_AUDIO = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"

TEST_SENTENCES = [
    "Hello! How are you doing today?",
    "That's really interesting, tell me more about it.",
    "I was just thinking about you actually.",
    "Oh definitely, I'd love to hear your thoughts on that.",
    "Hmm, that's a good point, let me think about it.",
]

print("=" * 60)
print("0.6B OPTIMAL CONFIG TEST")
print("=" * 60)

# Load
print("\n[1] Loading model...")
load_start = time.time()
tts_model = Qwen3TTSModel.from_pretrained(
    TTS_MODEL,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
print(f"    Loaded in {time.time()-load_start:.2f}s")

# Prompt
print("[2] Creating voice prompt...")
ps = time.time()
voice_clone_prompt = tts_model.create_voice_clone_prompt(
    ref_audio=REFERENCE_AUDIO,
    x_vector_only_mode=True,
)
print(f"    Created in {time.time()-ps:.2f}s")

# 3 warm-up passes
print("[3] Warm-up (3 passes)...")
for j in range(3):
    torch.cuda.empty_cache()
    ws = time.time()
    tts_model.generate_voice_clone(
        text="Quick warmup test.",
        language="English",
        voice_clone_prompt=voice_clone_prompt,
    )
    print(f"    Pass {j+1}: {time.time()-ws:.2f}s")

print("\n[4] OPTIMAL TEST (torch.cuda.empty_cache between each):")
print()

times = []
for i, sentence in enumerate(TEST_SENTENCES):
    torch.cuda.empty_cache()  # Just CUDA cache, no gc
    
    gen_start = time.time()
    wavs, sr = tts_model.generate_voice_clone(
        text=sentence,
        language="English",
        voice_clone_prompt=voice_clone_prompt,
    )
    gen_time = time.time() - gen_start
    times.append(gen_time)
    
    audio_duration = len(wavs[0]) / sr
    rtf = gen_time / audio_duration
    
    sf.write(f"C:\\Users\\5robm\\Desktop\\MiniClaw\\voice-test-scripts\\optimal_{i}.wav", wavs[0], sr)
    print(f"  [{i+1}] {gen_time:.2f}s | audio: {audio_duration:.1f}s | RTF: {rtf:.2f}x | \"{sentence[:40]}\"")

print()
print("=" * 60)
avg = sum(times) / len(times)
print(f"  Average: {avg:.2f}s")
print(f"  Min:     {min(times):.2f}s")
print(f"  Max:     {max(times):.2f}s")
print(f"  Trend:   {'DEGRADING' if times[-1] > times[0] * 1.3 else 'STABLE'}")
print()

# VRAM usage
if torch.cuda.is_available():
    allocated = torch.cuda.memory_allocated() / 1024**3
    reserved = torch.cuda.memory_reserved() / 1024**3
    print(f"  VRAM allocated: {allocated:.2f} GB")
    print(f"  VRAM reserved:  {reserved:.2f} GB")

print("=" * 60)
