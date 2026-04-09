"""
Optimized voice loop with persistent model loading.
Uses Hugging Face repo IDs instead of local paths.
"""

from qwen_tts import Qwen3TTSModel
from qwen_asr import Qwen3ASRModel
import torch
import soundfile as sf
import time
import os

# Use Hugging Face repo IDs (models should be in HF cache)
TTS_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
ASR_MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
REFERENCE_AUDIO = r"C:\Users\5robm\Desktop\MiniClaw\skills\voice-chat\companion_voice_test_v2.wav"
TEST_AUDIO_PATH = r"C:\Users\5robm\Desktop\MiniClaw\voice-test-scripts\test_loop_audio.wav"
OUTPUT_AUDIO = r"C:\Users\5robm\Desktop\MiniClaw\voice-test-scripts\test_loop_response.wav"

# Global model storage
_tts_model = None
_asr_model = None
_voice_embedding = None

def get_tts_model():
    """Load TTS model once and cache it."""
    global _tts_model
    if _tts_model is None:
        print("Loading TTS model (first time only)...")
        start = time.time()
        _tts_model = Qwen3TTSModel.from_pretrained(TTS_MODEL_ID)
        print(f"TTS model loaded in {time.time() - start:.2f}s")
    return _tts_model

def get_asr_model():
    """Load ASR model once and cache it."""
    global _asr_model
    if _asr_model is None:
        print("Loading ASR model (first time only)...")
        start = time.time()
        _asr_model = Qwen3ASRModel.from_pretrained(ASR_MODEL_ID)
        print(f"ASR model loaded in {time.time() - start:.2f}s")
    return _asr_model

def get_voice_embedding():
    """Extract and cache voice embedding from reference audio."""
    global _voice_embedding
    if _voice_embedding is None:
        print("Extracting voice embedding (first time only)...")
        start = time.time()
        tts_model = get_tts_model()
        _voice_embedding = tts_model.extract_voice_embedding(REFERENCE_AUDIO)
        print(f"Voice embedding extracted in {time.time() - start:.2f}s")
    return _voice_embedding

def voice_loop_iteration(user_audio_path, response_text):
    """
    Single conversation loop iteration.
    - Transcribe user audio
    - Generate TTS response
    Returns transcription and timings.
    """
    loop_start = time.time()
    
    # ASR: Transcribe user speech
    asr_start = time.time()
    asr_model = get_asr_model()
    transcription = asr_model.transcribe(user_audio_path)
    if hasattr(transcription, 'text'):
        user_said = transcription.text
    elif isinstance(transcription, list) and len(transcription) > 0:
        user_said = transcription[0].get('text', str(transcription))
    else:
        user_said = str(transcription)
    asr_time = time.time() - asr_start
    
    # TTS: Generate response with cached embedding
    tts_start = time.time()
    tts_model = get_tts_model()
    voice_embedding = get_voice_embedding()
    
    audio_data = tts_model.generate_custom_voice(
        text=response_text,
        reference_audio=REFERENCE_AUDIO,
        voice_embedding=voice_embedding  # Use cached embedding
    )
    
    # Save audio
    if isinstance(audio_data, tuple):
        waveform, sample_rate = audio_data
    else:
        waveform = audio_data
        sample_rate = 12000
    
    if isinstance(waveform, torch.Tensor):
        waveform = waveform.cpu().numpy()
    
    sf.write(OUTPUT_AUDIO, waveform, sample_rate)
    tts_time = time.time() - tts_start
    
    total_time = time.time() - loop_start
    
    return {
        'transcription': user_said,
        'asr_time': asr_time,
        'tts_time': tts_time,
        'total_time': total_time
    }

def main():
    print("=" * 60)
    print("VOICE LOOP TEST - PERSISTENT MODEL LOADING")
    print("=" * 60)
    
    # Pre-load all models
    print("\n[INITIAL LOAD]")
    initial_start = time.time()
    get_tts_model()
    get_asr_model()
    get_voice_embedding()
    initial_time = time.time() - initial_start
    print(f"\nTotal initial load time: {initial_time:.2f}s")
    
    # Create test audio (synthesize "Hello, how are you?")
    print("\n[CREATING TEST AUDIO]")
    tts_model = get_tts_model()
    voice_embedding = get_voice_embedding()
    test_audio = tts_model.generate_custom_voice(
        text="Hello, how are you?",
        reference_audio=REFERENCE_AUDIO,
        voice_embedding=voice_embedding
    )
    
    if isinstance(test_audio, tuple):
        waveform, sample_rate = test_audio
    else:
        waveform = test_audio
        sample_rate = 12000
    
    if isinstance(waveform, torch.Tensor):
        waveform = waveform.cpu().numpy()
    
    sf.write(TEST_AUDIO_PATH, waveform, sample_rate)
    print(f"Test audio created: {TEST_AUDIO_PATH}")
    
    # Run conversation loop 3 times to measure cached performance
    print("\n[CONVERSATION LOOP TESTS]")
    for i in range(3):
        print(f"\n--- Iteration {i+1} ---")
        result = voice_loop_iteration(
            TEST_AUDIO_PATH,
            f"That's great! This is response number {i+1}."
        )
        
        print(f"User said: \"{result['transcription']}\"")
        print(f"ASR time: {result['asr_time']:.2f}s")
        print(f"TTS time: {result['tts_time']:.2f}s")
        print(f"Total: {result['total_time']:.2f}s")
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)
    print(f"\nInitial load: {initial_time:.2f}s (one-time cost)")
    print("Subsequent iterations should be fast (~2-4s total)")
    print(f"\nOutput audio: {OUTPUT_AUDIO}")

if __name__ == "__main__":
    main()
