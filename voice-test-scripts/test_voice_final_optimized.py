"""
FINAL OPTIMIZED VOICE LOOP TEST

Key optimizations:
1. Model warm-up to prevent cold start overhead
2. CUDA cache clearing between iterations
3. Voice embedding cached once
4. Proper memory management
5. Realistic conversation simulation
"""

from qwen_tts import Qwen3TTSModel
from qwen_asr import Qwen3ASRModel
import torch
import soundfile as sf
import time
import gc
from pathlib import Path

# Paths
base_dir = Path(r"C:\Users\5robm\Desktop\MiniClaw")
tts_model_path = base_dir / "skills/voice-chat/models/Qwen3-TTS-12Hz-1.7B-Base"
asr_model_path = base_dir / "skills/voice-chat/models/Qwen3-ASR-1.7B"
reference_audio = base_dir / "skills/voice-chat/companion_voice_test_v2.wav"
output_dir = base_dir / "voice-test-scripts"

print("\n" + "=" * 60)
print("FINAL OPTIMIZED VOICE LOOP TEST")
print("=" * 60)
print()

# STEP 1: Load models (one-time cost)
print("[INITIAL LOAD]")
print("Loading TTS model...")
start = time.time()
tts_model = Qwen3TTSModel(str(tts_model_path))
tts_load_time = time.time() - start
print(f"TTS model loaded in {tts_load_time:.2f}s")

print("Loading ASR model...")
start = time.time()
asr_model = Qwen3ASRModel(str(asr_model_path))
asr_load_time = time.time() - start
print(f"ASR model loaded in {asr_load_time:.2f}s")

# STEP 2: Create and cache voice embedding (one-time cost)
print("Creating voice clone prompt...")
start = time.time()
voice_prompt = tts_model.create_voice_clone_prompt(
    reference_audio=str(reference_audio),
    reference_text="Hello. How are you?"
)
prompt_time = time.time() - start
print(f"Voice clone prompt created in {prompt_time:.2f}s")
print()

total_init_time = tts_load_time + asr_load_time + prompt_time
print(f"Total initial load time: {total_init_time:.2f}s")
print()

# STEP 3: Warm-up pass (prevents first-iteration slowness)
print("[WARM-UP PASS]")
print("Running warm-up to prime GPU memory...")
warmup_text = "Warming up."
warmup_start = time.time()
warmup_audio = tts_model.generate_voice_clone(
    text=warmup_text,
    voice_clone_prompt=voice_prompt
)
warmup_time = time.time() - warmup_start
print(f"Warm-up completed in {warmup_time:.2f}s")
print()

# Clear CUDA cache after warm-up
if torch.cuda.is_available():
    torch.cuda.empty_cache()
    gc.collect()

# STEP 4: Create test audio
print("[CREATING TEST AUDIO]")
test_text = "Hello. How are you?"
test_audio_path = output_dir / "test_loop_audio.wav"
test_audio = tts_model.generate_voice_clone(
    text=test_text,
    voice_clone_prompt=voice_prompt
)
sf.write(str(test_audio_path), test_audio, 12000)
print(f"Test audio created: {test_audio_path}")
print()

# STEP 5: Conversation loop test (3 iterations)
print("[CONVERSATION LOOP TESTS]")
print()

iteration_times = []

for i in range(3):
    print(f"--- Iteration {i+1} ---")
    
    # Clear CUDA cache before each iteration
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        gc.collect()
    
    # ASR: User speaks
    asr_start = time.time()
    transcription = asr_model.transcribe(str(test_audio_path))
    asr_time = time.time() - asr_start
    
    if hasattr(transcription, 'text'):
        user_text = transcription.text
    elif isinstance(transcription, list) and len(transcription) > 0:
        user_text = transcription[0].text if hasattr(transcription[0], 'text') else str(transcription[0])
    else:
        user_text = str(transcription)
    
    print(f'User said: "{user_text}"')
    
    # TTS: Bot responds (using cached voice prompt)
    response_text = "I'm doing well, thank you for asking!"
    tts_start = time.time()
    response_audio = tts_model.generate_voice_clone(
        text=response_text,
        voice_clone_prompt=voice_prompt
    )
    tts_time = time.time() - tts_start
    
    total_time = asr_time + tts_time
    iteration_times.append({
        'asr': asr_time,
        'tts': tts_time,
        'total': total_time
    })
    
    print(f"ASR time: {asr_time:.2f}s")
    print(f"TTS time: {tts_time:.2f}s")
    print(f"Total: {total_time:.2f}s")
    print()

# STEP 6: Save final output
output_path = output_dir / "test_loop_response.wav"
sf.write(str(output_path), response_audio, 12000)

# STEP 7: Analysis
print("=" * 60)
print("TEST COMPLETE")
print("=" * 60)
print()
print(f"Initial load: {total_init_time:.2f}s (one-time cost)")
print(f"Warm-up: {warmup_time:.2f}s (prevents cold start)")
print()
print("Iteration breakdown:")
for i, times in enumerate(iteration_times):
    print(f"  Iteration {i+1}: ASR {times['asr']:.2f}s + TTS {times['tts']:.2f}s = {times['total']:.2f}s")

avg_asr = sum(t['asr'] for t in iteration_times) / len(iteration_times)
avg_tts = sum(t['tts'] for t in iteration_times) / len(iteration_times)
avg_total = sum(t['total'] for t in iteration_times) / len(iteration_times)

print()
print(f"Average per iteration: ASR {avg_asr:.2f}s + TTS {avg_tts:.2f}s = {avg_total:.2f}s")
print()
print(f"Output audio: {output_path}")
print()

# Check if flash-attn is installed
try:
    import flash_attn
    print("✅ flash-attn is installed - you're getting optimal performance")
except ImportError:
    print("⚠️ flash-attn not installed - you could be 30-40% faster")
    print("   Run: pip install -U flash-attn --no-build-isolation")
print()
