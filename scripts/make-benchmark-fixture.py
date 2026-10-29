import pathlib,struct,zlib
w,h=1920,1080
# Deterministic RGB gradients and edges; synthetic PNG, not a photo workload.
def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
rows=bytearray()
for y in range(h):
 rows.append(0)
 for x in range(w): rows.extend((x%256,y%256,((x//32)^(y//32))*17%256))
data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
pathlib.Path('benchmarks/gradient-1920.png').write_bytes(data)
