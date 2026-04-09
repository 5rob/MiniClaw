"""Check flash-attention installation and compatibility."""
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    cap = torch.cuda.get_device_capability(0)
    print(f"Compute capability: {cap[0]}.{cap[1]}")
    print(f"flash-attn requires compute capability >= 8.0 (Ampere+)")
    print(f"Your GPU: {'COMPATIBLE' if cap[0] >= 8 else 'NOT COMPATIBLE'}")

try:
    import flash_attn
    print(f"\nflash-attn version: {flash_attn.__version__}")
    
    # Try a simple test
    from flash_attn import flash_attn_func
    q = torch.randn(1, 1, 8, 64, dtype=torch.float16, device='cuda')
    k = torch.randn(1, 1, 8, 64, dtype=torch.float16, device='cuda')
    v = torch.randn(1, 1, 8, 64, dtype=torch.float16, device='cuda')
    out = flash_attn_func(q, k, v)
    print(f"flash-attn functional test: PASSED (output shape: {out.shape})")
except ImportError:
    print("\nflash-attn: NOT INSTALLED")
except Exception as e:
    print(f"\nflash-attn test FAILED: {e}")
