"""Check environment details for flash-attn compatibility."""
import torch
import sys
print(f"Python: {sys.version}")
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version (PyTorch): {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    cap = torch.cuda.get_device_capability(0)
    print(f"Compute capability: {cap[0]}.{cap[1]}")

# Check pip packages
import subprocess
result = subprocess.run([sys.executable, '-m', 'pip', 'show', 'flash-attn'], capture_output=True, text=True)
if result.returncode == 0:
    print(f"\nflash-attn pip info:")
    print(result.stdout)
else:
    print("\nflash-attn NOT installed via pip")

# Check torch SDPA as alternative
print("\nTesting torch.nn.functional.scaled_dot_product_attention...")
try:
    q = torch.randn(1, 8, 4, 64, dtype=torch.float16, device='cuda')
    k = torch.randn(1, 8, 4, 64, dtype=torch.float16, device='cuda')
    v = torch.randn(1, 8, 4, 64, dtype=torch.float16, device='cuda')
    out = torch.nn.functional.scaled_dot_product_attention(q, k, v)
    print(f"SDPA test: PASSED (output shape: {out.shape})")
    print("PyTorch native SDPA is available as an alternative to flash-attn")
except Exception as e:
    print(f"SDPA test FAILED: {e}")
