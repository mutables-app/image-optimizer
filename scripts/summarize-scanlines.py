"""Independent native pixel comparisons and readable local A/B results."""
import json,pathlib,math,statistics,sys
from PIL import Image
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'benchmarks/scanlines/local')
data=json.loads((root/'results.json').read_text());groups={}
for r in data['results']:groups.setdefault((r['inputPath'],r['width'],r['speed']),{})[r['kind']]=r
rows=[]
for (path,width,speed),variants in groups.items():
 a,b=variants['reference'],variants['scanlines'];base=pathlib.Path(path).name
 with Image.open(root/f'{base}-{width}-{speed}-reference.webp') as im:ref=im.convert('RGBA').tobytes();dimensions=im.size
 with Image.open(root/f'{base}-{width}-{speed}-scanlines.webp') as im:
  if im.size!=dimensions:raise ValueError('Dimension mismatch')
  actual=im.convert('RGBA').tobytes()
 rgb_error=sum((ref[i]-actual[i])**2 for i in range(len(ref)) if i%4!=3)
 rmse=math.sqrt(rgb_error/(len(ref)*3/4));psnr=None if not rmse else 20*math.log10(255/rmse)
 rows.append({'input':path,'width':width,'speed':speed,'referenceCpuMs':a['medianCpuMs'],'scanlineCpuMs':b['medianCpuMs'],
 'cpuChangePercent':(b['medianCpuMs']/a['medianCpuMs']-1)*100,
 'referenceWasmBytes':a['highWaterWasmBytes'],'scanlineWasmBytes':b['highWaterWasmBytes'],
 'memoryChangePercent':(b['highWaterWasmBytes']/a['highWaterWasmBytes']-1)*100,
 'referenceOutputBytes':a['outputBytes'],'scanlineOutputBytes':b['outputBytes'],
 'outputSizeChangePercent':(b['outputBytes']/a['outputBytes']-1)*100,
 'rgbRmseVsReference':rmse,'rgbPsnrVsReferenceDb':psnr,
 'maxAlphaDifference':max(abs(ref[i]-actual[i]) for i in range(3,len(ref),4)),
 'rowStorageEstimateBytes':b['rowStorageEstimateBytes'],'codecBuffered':b['codecBuffered']})
(root/'comparison.json').write_text(json.dumps({'note':'PSNR compares decoded encoded outputs, not ground truth or perceptual equivalence. WASM bytes measure capacity high-water, not live allocations or whole-Worker memory. Local process CPU includes runtime activity.', 'comparisons':rows},indent=2)+'\n')
for speed in ['default','fast']:
 group=[r for r in rows if r['speed']==speed]
 print(speed, 'median CPU change', round(statistics.median(r['cpuChangePercent'] for r in group),1),'%', 'median WASM capacity change',round(statistics.median(r['memoryChangePercent'] for r in group),1),'%', 'lowest final-output PSNR',round(min(r['rgbPsnrVsReferenceDb'] for r in group if r['rgbPsnrVsReferenceDb'] is not None),2))
print('All',len(rows)*2,'A/B outputs independently decoded; dimensions match.')
