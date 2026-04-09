"""
0.6B model - maximum speed test.
No cache clearing between iterations, no gc.
Tests rapid-fire generation like a real conversation.
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
print("0.6B RAPID-FIRE VOICE CLONE TEST")
print("=" * 60)
print()

# Load model
print("[1] Loading 0.6B model...")
load_start = time.time()
tts_model = Qwen3TTSModel.from_pretrained(
    TTS_MODEL,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
load_time = time.time() - load_start
print(f"    Loaded in {load_time:.2f}s")

# Create voice prompt
print("[2] Creating voice prompt...")
prompt_start = time.time()
voice_clone_prompt = tts_model.create_voice_clone_prompt(
    ref_audio=REFERENCE_AUDIO,
    x_vector_only_mode=True,
)
prompt_time = time.time() - prompt_start
print(f"    Created in {prompt_time:.2f}s")

# Warm-up (2 passes)
print("[3] Warm-up (2 passes)...")
for j in range(2):
    ws = time.time()
    tts_model.generate_voice_clone(
        text="Test warmup pass.",
        language="English",
        voice_clone_prompt=voice_clone_prompt,
    )
    print(f"    Pass {j+1}: {time.time()-ws:.2f}s")

# Rapid-fire test - NO cache clearing
print()
print("[4] RAPID-FIRE TEST (no cleanup between iterations):")
print()

times = []
for i, sentence in enumerate(TEST_SENTENCES):
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
    
    sf.write(f"C:\\Users\\5robm\\Desktop\\MiniClaw\\voice-test-scripts\\rapid_{i}.wav", wavs[0], sr)
    
    print(f"  [{i+1}] {gen_time:.2f}s | audio: {audio_duration:.1f}s | RTF: {rtf:.2f}x | \"{sentence[:40]}...\"")

print()
print("=" * 60)
avg = sum(times) / len(times)
print(f"  Average: {avg:.2f}s")
print(f"  Min:     {min(times):.2f}s")
print(f"  Max:     {max(times):.2f}s")
print(f"  Trend:   {'DEGRADING' if times[-1] > times[0] * 1.3 else 'STABLE'}")
print()
print("  Comparison table:")
print(f"    1.7B default:    ~4.90s")
print(f"    1.7B SDPA:       ~5.16s")
print(f"    0.6B default:    ~3.49s")
print(f"    0.6B rapid-fire: {avg:.2f}s")
print("=" * 60)
