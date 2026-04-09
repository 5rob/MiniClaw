"""
0.6B model with torch.compile() for potential JIT speedup.
Also tries float16 instead of bfloat16.
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
]

print("=" * 60)
print("0.6B FLOAT16 TEST")
print("=" * 60)

# Try float16 instead of bfloat16
print("\n[1] Loading model with float16...")
load_start = time.time()
tts_model = Qwen3TTSModel.from_pretrained(
    TTS_MODEL,
    device_map="cuda:0",
    dtype=torch.float16,
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

# Warm-up
print("[3] Warm-up...")
for j in range(2):
    torch.cuda.empty_cache()
    ws = time.time()
    tts_model.generate_voice_clone(
        text="Quick warmup.",
        language="English",
        voice_clone_prompt=voice_clone_prompt,
    )
    print(f"    Pass {j+1}: {time.time()-ws:.2f}s")

print("\n[4] FLOAT16 TEST:")
print()

times = []
for i, sentence in enumerate(TEST_SENTENCES):
    torch.cuda.empty_cache()
    
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
    
    sf.write(f"C:\\Users\\5robm\\Desktop\\MiniClaw\\voice-test-scripts\\fp16_{i}.wav", wavs[0], sr)
    print(f"  [{i+1}] {gen_time:.2f}s | audio: {audio_duration:.1f}s | RTF: {rtf:.2f}x")

avg = sum(times) / len(times)
print(f"\n  Float16 average: {avg:.2f}s (vs bfloat16: ~3.49s)")
print("=" * 60)
