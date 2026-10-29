"""Strip all request headers/hosts from private tail logs and aggregate CPU."""
import json,pathlib,sys,urllib.parse,statistics,math
source=pathlib.Path(sys.argv[1]);root=pathlib.Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True)
s=source.read_text();decoder=json.JSONDecoder();pos=0;events=[]
while pos<len(s):
 start=s.find('{',pos)
 if start<0:break
 try:obj,end=decoder.raw_decode(s,start);pos=end
 except json.JSONDecodeError:pos=start+1;continue
 if not isinstance(obj,dict) or 'outcome' not in obj:continue
 req=obj.get('event',{}).get('request',{});query=urllib.parse.parse_qs(urllib.parse.urlsplit(req.get('url','')).query)
 if query.get('variant',[''])[0] not in ['scanlines-ab','scanlines-concurrency','scanlines-stress']:continue
 safe={k:query.get(k,[None])[0] for k in ['variant','image','width','scaled','pipeline','phase','concurrency']}
 safe.update({k:obj.get(k) for k in ['outcome','cpuTime','wallTime','eventTimestamp']});events.append(safe)
(root/'cpu-events.json').write_text(json.dumps(events,indent=2)+'\n')
groups={}
for event in events:
 if event['phase']!='sample' or event['variant']!='scanlines-ab':continue
 key=(event['image'],int(event['width']),'fast' if event['scaled']=='true' else 'default',event['pipeline'])
 groups.setdefault(key,[]).append(event)
rows=[]
for key,items in sorted(groups.items()):
 cpus=sorted(e['cpuTime'] for e in items if e['outcome']=='ok' and isinstance(e['cpuTime'],(float,int)))
 rows.append(dict(zip(['image','width','speed','pipeline'],key))|{'traceCount':len(items),'successfulTraces':len(cpus),'outcomes':{outcome:sum(e['outcome']==outcome for e in items) for outcome in {e['outcome'] for e in items}},'medianCpuMs':statistics.median(cpus) if cpus else None,'p95CpuMs':cpus[math.ceil(.95*len(cpus))-1] if cpus else None,'maxCpuMs':max(cpus) if cpus else None})
(root/'cpu-summary.json').write_text(json.dumps({'note':'Trace samples may be missing or uneven. CPU is Cloudflare CPU, not request round trip. p95 with small sample counts is descriptive only. Headers and deployment hostnames are excluded.', 'groups':rows},indent=2)+'\n')
for row in rows:print(row['image'],row['width'],row['speed'],row['pipeline'],row['traceCount'],'traces; median CPU',row['medianCpuMs'])
