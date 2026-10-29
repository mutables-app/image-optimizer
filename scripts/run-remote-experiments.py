import os,json,subprocess,pathlib
root=pathlib.Path('benchmarks/experiments/remote');root.mkdir(exist_ok=True)
node=os.environ.get('NODE','node');env=os.environ.copy();env.update(json.load(open('.build/benchmark-secrets.json')))
worker=os.environ.get('EXPERIMENTS_WORKER_URL')
if not worker: raise SystemExit('Set EXPERIMENTS_WORKER_URL to your own test Worker URL')
cases=[]
for kind,file,widths,variants in [('jpeg','benchmarks/photo-1920.jpg',[320,800,1600],[(False,4),(True,4),(True,0)]),('png','benchmarks/gradient-1920.png',[800,1600],[(False,4),(False,0)])]:
 for width in widths:
  for scaled,method in variants:
   label=f'{kind}-{width}-scaled{int(scaled)}-m{method}';directory=root/label;directory.mkdir(exist_ok=True)
   env['BENCHMARK_OUTPUT_DIR']=str(directory)
   url=f'{worker.rstrip("/")}/?case={kind}&scaled={str(scaled).lower()}&method={method}'
   with open(directory/'run.log','w') as log: subprocess.run([node,'scripts/benchmark.mjs',url,file,str(width),'5'],env=env,stdout=log,stderr=log,check=True)
   p=directory/(pathlib.Path(file).name+f'-{width}.json');report=json.loads(p.read_text())
   successful=sum(r['ok'] for r in report['results'])
   output=p.with_suffix('.webp');metrics=None
   if output.exists():
    reference=f'benchmarks/experiments/{kind}-{width}-reference.webp'
    metrics=json.loads(subprocess.check_output(['.build/compare-webp',reference,str(output)],text=True))
   cases.append({'case':kind,'width':width,'scaled':scaled,'method':method,'requests':len(report['results']),'successes':successful,'p50Ms':report['p50Ms'],'outputBytes':report['outputBytes'],'metrics':metrics,'report':str(p)})
   (root/'summary.json').write_text(json.dumps(cases,indent=2)+'\n')
   print(label,f'{successful}/{len(report["results"])}',flush=True)
