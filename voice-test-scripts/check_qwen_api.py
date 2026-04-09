"""Check correct Qwen3TTSModel API"""
import inspect
from qwen_tts import Qwen3TTSModel

# Check constructor signature
sig = inspect.signature(Qwen3TTSModel.__init__)
print(f"__init__ params: {sig}")

# Check all public methods
for name in dir(Qwen3TTSModel):
    if not name.startswith('_'):
        attr = getattr(Qwen3TTSModel, name)
        if callable(attr):
            try:
                sig = inspect.signature(attr)
                print(f"{name}{sig}")
            except:
                print(f"{name} (no signature)")
