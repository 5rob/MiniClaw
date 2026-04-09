"""
Test the 0.6B-Base model for faster voice cloning.
0.6B should be significantly faster than 1.7B.
"""
import torch
import soundfile as sf
import time
import gc
from qwen_tts import Qwen3TTSModel

# Config - using the SMALLER 0.6B model
TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
REFERENCE_AUDIO = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"

TEST_SENTENCES = [
    "Hello! How are you doing today?",
    "That's really interesting, tell me more about it.",
    "I was just thinking about you actually.",
]

print("=" * 60)
print("0.6B MODEL - VOICE CLONE LATENCY TEST")
print("=" * 60)
print()

# Step 1: Load model
print("[1] Loading 0.6B TTS model...")
load_start = time.time()
tts_model = Qwen3TTSModel.from_pretrained(
    TTS_MODEL,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
load_time = time.time() - load_start
print(f"    Model loaded in {load_time:.2f}s")
print()

# Step 2: Create reusable voice clone prompt
print("[2] Creating voice clone prompt...")
prompt_start = time.time()
voice_clone_prompt = tts_model.create_voice_clone_prompt(
    ref_audio=REFERENCE_AUDIO,
    x_vector_only_mode=True,
)
prompt_time = time.time() - prompt_start
print(f"    Voice prompt created in {prompt_time:.2f}s")
print()

# Step 3: Warm-up
print("[3] Warm-up generation...")
warmup_start = time.time()
warmup_wavs, warmup_sr = tts_model.generate_voice_clone(
    text="Warming up.",
    language="English",
    voice_clone_prompt=voice_clone_prompt,
)
warmup_time = time.time() - warmup_start
print(f"    Warm-up done in {warmup_time:.2f}s")
print()

torch.cuda.empty_cache()
gc.collect()

# Step 4: Timed generations
print("[4] Timed generation iterations:")
print()

times = []
for i, sentence in enumerate(TEST_SENTENCES):
    torch.cuda.empty_cache()
    gc.collect()
    
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
    
    output_file = f"C:\\Users\\5robm\\Desktop\\MiniClaw\\voice-test-scripts\\clone_06b_test_{i}.wav"
    sf.write(output_file, wavs[0], sr)
    
    print(f"    Iteration {i+1}:")
    print(f"      Text: \"{sentence}\"")
    print(f"      TTS time: {gen_time:.2f}s")
    print(f"      Audio duration: {audio_duration:.2f}s")
    print(f"      RTF: {rtf:.2f}x (< 1.0 = faster than realtime)")
    print()

# Summary
print("=" * 60)
print("0.6B SUMMARY")
print("=" * 60)
avg_time = sum(times) / len(times)
print(f"  Model load:         {load_time:.2f}s (one-time)")
print(f"  Prompt creation:    {prompt_time:.2f}s (one-time)")
print(f"  Warm-up:            {warmup_time:.2f}s (one-time)")
print(f"  Average generation: {avg_time:.2f}s")
print(f"  Min generation:     {min(times):.2f}s")
print(f"  Max generation:     {max(times):.2f}s")
print()
print("  Compare with 1.7B avg: ~4.90s")
print(f"  0.6B speedup: {4.90 / avg_time:.1f}x faster")
print("=" * 60)
