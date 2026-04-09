"""
Optimized voice cloning test - measures latency with cached voice prompt.
Uses the CORRECT Qwen3-TTS API from official docs.
"""
import torch
import soundfile as sf
import time
import gc
from qwen_tts import Qwen3TTSModel

# Config
TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
REFERENCE_AUDIO = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"

# Test sentences (short for latency testing)
TEST_SENTENCES = [
    "Hello! How are you doing today?",
    "That's really interesting, tell me more about it.",
    "I was just thinking about you actually.",
]

print("=" * 60)
print("OPTIMIZED VOICE CLONE - LATENCY TEST")
print("=" * 60)
print()

# Step 1: Load model (without flash_attention_2 to avoid CUDA error)
print("[1] Loading TTS model...")
load_start = time.time()
tts_model = Qwen3TTSModel.from_pretrained(
    TTS_MODEL,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
load_time = time.time() - load_start
print(f"    Model loaded in {load_time:.2f}s")
print()

# Step 2: Create reusable voice clone prompt (ONE TIME COST)
print("[2] Creating voice clone prompt from reference audio...")
prompt_start = time.time()
voice_clone_prompt = tts_model.create_voice_clone_prompt(
    ref_audio=REFERENCE_AUDIO,
    x_vector_only_mode=True,  # Skip ref_text, use speaker embedding only
)
prompt_time = time.time() - prompt_start
print(f"    Voice prompt created in {prompt_time:.2f}s")
print()

# Step 3: Warm-up generation
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

# Clear CUDA cache
torch.cuda.empty_cache()
gc.collect()

# Step 4: Timed generation iterations
print("[4] Timed generation iterations:")
print()

times = []
for i, sentence in enumerate(TEST_SENTENCES):
    # Clear cache between iterations
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
    
    # Calculate audio duration
    audio_duration = len(wavs[0]) / sr
    rtf = gen_time / audio_duration  # Real-time factor
    
    output_file = f"C:\\Users\\5robm\\Desktop\\MiniClaw\\voice-test-scripts\\clone_test_{i}.wav"
    sf.write(output_file, wavs[0], sr)
    
    print(f"    Iteration {i+1}:")
    print(f"      Text: \"{sentence}\"")
    print(f"      TTS time: {gen_time:.2f}s")
    print(f"      Audio duration: {audio_duration:.2f}s")
    print(f"      RTF: {rtf:.2f}x (< 1.0 = faster than realtime)")
    print(f"      Saved: clone_test_{i}.wav")
    print()

# Step 5: Summary
print("=" * 60)
print("SUMMARY")
print("=" * 60)
avg_time = sum(times) / len(times)
print(f"  Model load:         {load_time:.2f}s (one-time)")
print(f"  Prompt creation:    {prompt_time:.2f}s (one-time)")
print(f"  Warm-up:            {warmup_time:.2f}s (one-time)")
print(f"  Average generation: {avg_time:.2f}s")
print(f"  Min generation:     {min(times):.2f}s")
print(f"  Max generation:     {max(times):.2f}s")
print()
print("  Per-iteration breakdown:")
for i, t in enumerate(times):
    print(f"    Iteration {i+1}: {t:.2f}s")
print()
print(f"  Output files in: voice-test-scripts/")
print("=" * 60)
