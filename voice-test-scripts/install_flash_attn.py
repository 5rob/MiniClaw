# Quick FlashAttention installer check
# Run this to see if we can install flash-attn for 30-40% speedup

import subprocess
import sys

print("=" * 60)
print("FLASH ATTENTION INSTALLER CHECK")
print("=" * 60)
print()

print("Checking if flash-attn is already installed...")
try:
    import flash_attn
    print("✅ flash-attn is already installed!")
    print(f"Version: {flash_attn.__version__}")
    sys.exit(0)
except ImportError:
    print("❌ flash-attn not found")
    print()

print("Attempting to install flash-attn...")
print("This will give 30-40% speed improvement for TTS")
print()
print("Installing with: pip install -U flash-attn --no-build-isolation")
print()

# Try to install
try:
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-U", "flash-attn", "--no-build-isolation"],
        capture_output=True,
        text=True,
        timeout=600  # 10 minute timeout
    )
    
    if result.returncode == 0:
        print("✅ flash-attn installed successfully!")
        print()
        print("Speed improvement expected: 30-40%")
        print("Run the voice loop test again to see the difference")
    else:
        print("❌ Installation failed")
        print()
        print("This is common on Windows - flash-attn requires:")
        print("  - CUDA toolkit")
        print("  - Visual Studio Build Tools")
        print("  - Compatible CUDA version")
        print()
        print("STDERR:")
        print(result.stderr)
        print()
        print("You can still use Qwen3-TTS without flash-attn,")
        print("it will just be slower (~30-40% slower)")
        
except subprocess.TimeoutExpired:
    print("⏱️ Installation timed out (>10 minutes)")
    print("flash-attn compilation can take a very long time")
    print()
    print("You can continue without it - TTS will work, just slower")
