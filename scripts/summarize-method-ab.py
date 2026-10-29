"""Combine sanitized Cloudflare CPU events from interleaved method A/B runs."""
import json, math, pathlib, statistics, urllib.parse

root=pathlib.Path('benchmarks/experiments')
files=[root/'method-ab/cloudflare-cpu-events.json',root/'method-ab-recheck/cloudflare-cpu-events.json']
groups={}
for path in files:
    for event in json.loads(path.read_text()):
        query=urllib.parse.parse_qs(urllib.parse.urlsplit(event.get('url') or '').query)
        if query.get('phase',[''])[0] not in ('sample','sample2') or event.get('outcome')!='ok':
            continue
        key=(int(query['width'][0]),int(query['method'][0]))
        groups.setdefault(key,[]).append(event['cpuTime'])
rows=[]
for (width,method),values in sorted(groups.items()):
    ordered=sorted(values)
    rows.append({'width':width,'method':method,'traceSamples':len(ordered),
        'medianCpuMs':statistics.median(ordered),
        'p95CpuMs':ordered[math.ceil(.95*len(ordered))-1],
        'minCpuMs':ordered[0],'maxCpuMs':ordered[-1]})
report={'runs':[str(p) for p in files],
    'percentiles':'median uses midpoint average; p95 uses nearest rank',
    'note':'Wrangler tail events are a sampled subset of successful HTTP requests, especially at 800px.',
    'results':rows}
target=root/'method-ab/combined-cpu-summary.json'
target.write_text(json.dumps(report,indent=2)+'\n')
print(target)
for row in rows: print(row)
