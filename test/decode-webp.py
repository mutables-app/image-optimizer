# Independent native libwebp decode of outputs produced by the WASM encoder.
import ctypes, json, sys
lib = ctypes.CDLL('libwebp.so.7')
lib.WebPDecodeRGBA.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
lib.WebPDecodeRGBA.restype = ctypes.c_void_p
lib.WebPFree.argtypes = [ctypes.c_void_p]
data = sys.stdin.buffer.read(); w = ctypes.c_int(); h = ctypes.c_int()
p = lib.WebPDecodeRGBA(data, len(data), ctypes.byref(w), ctypes.byref(h))
if not p: raise RuntimeError('Independent WebP decode failed')
pixels = ctypes.string_at(p, w.value*h.value*4)
lib.WebPFree(p)
print(json.dumps({'width':w.value, 'height':h.value, 'alpha':list(pixels[3:w.value*4:4])}))
