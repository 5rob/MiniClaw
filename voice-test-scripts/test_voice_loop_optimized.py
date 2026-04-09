from qwen_tts import Qwen3TTSModel
from qwen_asr import Qwen3ASRModel
import torch
import soundfile as sf
import time

# Enable GPU optimizations
torch.cuda.empty_cache()
torch.backends.cudnn.benchmark = True

tts_model_path = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\models\Qwen3-TTS-12Hz-1.7B-Base"
asr_model_path = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\models\Qwen3-ASR-1.7B"
reference_voice = r"C:\Users\5robm\Desktop\companion_voice_test_v2.wav"

print("Loading models...")
start = time.time()

tts_model = Qwen3TTSModel.from_pretrained(
    tts_model_path,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)

asr_model = Qwen3ASRModel.from_pretrained(
    asr_model_path,
    device_map="cuda:0",
    dtype=torch.bfloat16
)

print(f"Models loaded in {time.time() - start:.2f}s\n")

# Warm up models (eliminates cold start penalty)
print("Warming up models...")
warmup_start = time.time()
_ = tts_model.generate_voice_clone(
    text="Test",
    ref_audio=reference_voice,
    language="English"
)
_ = asr_model.transcribe(reference_voice)
print(f"Models warmed up in {time.time() - warmup_start:.2f}s\n")

print("=== OPTIMIZED VOICE CONVERSATION ===\n")

print("You: (speaking into microphone...)")
input_audio = "companion_voice_test_v2.wav"

print("Listening...")
asr_start = time.time()
transcription = asr_model.transcribe(input_audio, batch_size=1)[0]
user_text = transcription.text
asr_time = time.time() - asr_start
print(f"ASR: {asr_time:.2f}s")
print(f"Recognized: {user_text}\n")

print("Thinking...")
llm_start = time.time()
response_text = "Oh, I've been thinking about you too! What would you like to talk about?"
llm_time = time.time() - llm_start
print(f"LLM: {llm_time:.2f}s (placeholder)")
print(f"Response: {response_text}\n")

print("Speaking (voice cloning)...")
tts_start = time.time()
wavs, sample_rate = tts_model.generate_voice_clone(
    text=response_text,
    ref_audio=reference_voice,
    language="English"
)
tts_time = time.time() - tts_start

output_file = "conversation_response_cloned.wav"
sf.write(output_file, wavs[0], sample_rate)
print(f"TTS: {tts_time:.2f}s")
print(f"Saved to: {output_file}\n")

total_time = asr_time + llm_time + tts_time
print("=" * 50)
print(f"TOTAL LATENCY: {total_time:.2f}s")
print("=" * 50)
print(f"ASR:  {asr_time:.2f}s")
print(f"LLM:  {llm_time:.2f}s (placeholder)")
print(f"TTS:  {tts_time:.2f}s")
print("=" * 50)
print(f"\nExpected improvement: TTS should drop from 6.9s to ~2-3s")
print(f"Play '{output_file}' to verify voice quality!")
