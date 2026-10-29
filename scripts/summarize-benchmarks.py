"""Summarize HTTP benchmarks and independently decode successful WebP outputs."""
import ctypes,json,pathlib,sys
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'benchmarks/output')
lib=ctypes.CDLL('libwebp.so.7')
lib.WebPDecodeRGBA.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_int),ctypes.POINTER(ctypes.c_int)]
lib.WebPDecodeRGBA.restype=ctypes.c_void_p
lib.WebPFree.argtypes=[ctypes.c_void_p]
rows=[]
for p in sorted(root.glob('*-*.json')):
 d=json.loads(p.read_text())
 if not isinstance(d,dict) or 'warmSuccesses' not in d:continue
 dimensions=None
 if d['outputBytes'] is not None:
  data=p.with_suffix('.webp').read_bytes();w=ctypes.c_int();h=ctypes.c_int()
  pixels=lib.WebPDecodeRGBA(data,len(data),ctypes.byref(w),ctypes.byref(h))
  assert pixels,f'WebP decode failed: {p}'
  lib.WebPFree(pixels);dimensions=[w.value,h.value]
  assert max(dimensions)<=int(p.stem.rsplit('-',1)[1])
 row={'input':pathlib.Path(d['input']).name,'box':int(p.stem.rsplit('-',1)[1]),'successes':sum(r['ok'] for r in d['results']),'requests':len(d['results']),'p50Ms':round(d['p50Ms'],1) if d['p50Ms'] is not None else None,'p95Ms':round(d['p95Ms'],1) if d['p95Ms'] is not None else None,'outputBytes':d['outputBytes'],'decodedDimensions':dimensions}
 rows.append(row);print(row)
(root/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
