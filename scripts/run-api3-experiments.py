import os,json,subprocess,pathlib
root=pathlib.Path('benchmarks/experiments/api3');root.mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env.update(json.load(open('.build/benchmark-secrets.json')))
node=os.environ.get('NODE','node')
worker=os.environ.get('EXPERIMENTS_WORKER_URL')
if not worker: raise SystemExit('Set EXPERIMENTS_WORKER_URL to your own test Worker URL')
cases=[]
for kind,file,width,variants in [
 ('jpeg','benchmarks/photo-1920.jpg',320,[(False,4),(True,4),(True,2),(True,0)]),
 ('jpeg','benchmarks/photo-1920.jpg',800,[(False,4),(True,4),(True,2)]),
 ('jpeg','benchmarks/photo-1920.jpg',1600,[(False,4),(True,4),(True,2)]),
 ('png','benchmarks/gradient-1920.png',800,[(False,4),(False,2)]),
 ('png','benchmarks/gradient-1920.png',1600,[(False,4),(False,2)]),
]:
 for scaled,method in variants:
  label=f'{kind}-{width}-scaled{int(scaled)}-m{method}';directory=root/label;directory.mkdir(exist_ok=True)
  env['BENCHMARK_OUTPUT_DIR']=str(directory)
  url=f'{worker.rstrip("/")}/?case={kind}&scaled={str(scaled).lower()}&method={method}'
  with open(directory/'run.log','w') as log:subprocess.run([node,'scripts/benchmark.mjs',url,file,str(width),'3'],env=env,stdout=log,stderr=log,check=True)
  p=directory/(pathlib.Path(file).name+f'-{width}.json');report=json.loads(p.read_text());output=p.with_suffix('.webp');metrics=None
  if output.exists():
   reference=f'benchmarks/experiments/{kind}-{width}-reference.webp'
   metrics=json.loads(subprocess.check_output(['.build/compare-webp',reference,str(output)],text=True))
  item={'input':kind,'width':width,'scaled':scaled,'method':method,'requests':len(report['results']),'successes':sum(r['ok'] for r in report['results']),'p50RoundTripMs':report['p50Ms'],'bytes':report['outputBytes'],'dimensions':metrics and [metrics['width'],metrics['height']],'rgbPsnrDb':metrics and metrics['rgbPsnrDb'],'report':str(p)}
  cases.append(item);(root/'summary.json').write_text(json.dumps(cases,indent=2)+'\n');print(label,item['successes'],'/',item['requests'],flush=True)
