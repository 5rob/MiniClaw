"""
Optimized voice loop with persistent model loading.
Uses Qwen3-TTS Base model for voice cloning.
"""

from qwen_tts import Qwen3TTSModel
from qwen_asr import Qwen3ASRModel
import torch
import soundfile as sf
import numpy as np
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
_voice_prompt = None

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

def get_voice_prompt():
    """Extract and cache voice clone prompt from reference audio."""
    global _voice_prompt
    if _voice_prompt is None:
        print("Creating voice clone prompt (first time only)...")
        start = time.time()
        tts_model = get_tts_model()
        # The Base model uses create_voice_clone_prompt() for reusable prompts
        _voice_prompt = tts_model.create_voice_clone_prompt(
            ref_audio=REFERENCE_AUDIO,
            # ref_text is optional but improves quality - if you have the transcript, add it here:
            # ref_text="The exact transcript of companion_voice_test_v2.wav",
            x_vector_only_mode=True  # Use speaker embedding only (no ICL)
        )
        print(f"Voice clone prompt created in {time.time() - start:.2f}s")
    return _voice_prompt

def save_audio(audio_data, output_path):
    """
    Safely save audio data to WAV file.
    Handles various return formats from Qwen3-TTS.
    """
    # Extract waveform and sample rate
    if isinstance(audio_data, tuple):
        waveform, sample_rate = audio_data
    elif isinstance(audio_data, dict):
        waveform = audio_data.get('audio', audio_data.get('waveform'))
        sample_rate = audio_data.get('sample_rate', 12000)
    else:
        waveform = audio_data
        sample_rate = 12000
    
    # Convert to numpy if needed
    if isinstance(waveform, torch.Tensor):
        waveform = waveform.cpu().numpy()
    
    # Ensure proper shape and dtype
    waveform = np.array(waveform, dtype=np.float32)
    
    # Handle multi-dimensional arrays
    if len(waveform.shape) > 1:
        # If stereo or batch, take first channel
        waveform = waveform.squeeze()
        if len(waveform.shape) > 1:
            waveform = waveform[0]
    
    # Normalize to [-1, 1] if needed
    if waveform.max() > 1.0 or waveform.min() < -1.0:
        waveform = waveform / max(abs(waveform.max()), abs(waveform.min()))
    
    # Save
    sf.write(output_path, waveform, sample_rate)
    return output_path

def voice_loop_iteration(user_audio_path, response_text):
    """
    Single conversation loop iteration.
    - Transcribe user audio
    - Generate TTS response using voice cloning
    Returns transcription and timings.
    """
    loop_start = time.time()
    
    # ASR: Transcribe user speech
    asr_start = time.time()
    asr_model = get_asr_model()
    transcription = asr_model.transcribe(user_audio_path)
    
    # Extract text from ASRTranscription object
    if hasattr(transcription, 'text'):
        user_said = transcription.text
    elif isinstance(transcription, list):
        # List of ASRTranscription objects
        if len(transcription) > 0 and hasattr(transcription[0], 'text'):
            user_said = transcription[0].text
        else:
            user_said = str(transcription)
    else:
        user_said = str(transcription)
    
    asr_time = time.time() - asr_start
    
    # TTS: Generate response with cached voice prompt
    tts_start = time.time()
    tts_model = get_tts_model()
    voice_prompt = get_voice_prompt()
    
    # Use generate_voice_clone() with cached prompt
    audio_data = tts_model.generate_voice_clone(
        text=response_text,
        language="English",
        voice_clone_prompt=voice_prompt  # Use cached prompt
    )
    
    # Save audio with robust handling
    save_audio(audio_data, OUTPUT_AUDIO)
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
    get_voice_prompt()
    initial_time = time.time() - initial_start
    print(f"\nTotal initial load time: {initial_time:.2f}s")
    
    # Create test audio (synthesize "Hello, how are you?")
    print("\n[CREATING TEST AUDIO]")
    tts_model = get_tts_model()
    voice_prompt = get_voice_prompt()
    test_audio = tts_model.generate_voice_clone(
        text="Hello, how are you?",
        language="English",
        voice_clone_prompt=voice_prompt
    )
    
    save_audio(test_audio, TEST_AUDIO_PATH)
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
