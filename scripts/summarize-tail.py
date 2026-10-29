"""Keep only non-secret CPU evidence from Wrangler's JSON tail output."""
import json,pathlib,sys,statistics,urllib.parse
source=pathlib.Path(sys.argv[1]);destination=pathlib.Path(sys.argv[2]);s=source.read_text();decoder=json.JSONDecoder();pos=0;events=[]
while pos<len(s):
 start=s.find('{',pos)
 if start<0:break
 try:obj,end=decoder.raw_decode(s,start);pos=end
 except json.JSONDecodeError:pos=start+1;continue
 if isinstance(obj,dict) and 'outcome' in obj:
  req=obj.get('event',{}).get('request',{});headers={k.lower():v for k,v in req.get('headers',{}).items()}
  events.append({k:obj.get(k) for k in ['outcome','cpuTime','wallTime','eventTimestamp']}|{'url':req.get('url'),'inputBytes':headers.get('content-length')})
destination.write_text(json.dumps(events,indent=2)+'\n')
groups={}
for e in events:
 query=urllib.parse.parse_qs(urllib.parse.urlsplit(e['url']or'').query)
 width=query.get('width',[None])[0];scaled=query.get('scaled',['0'])[0];method=query.get('method',['-1'])[0];variant=query.get('variant',['baseline'])[0];phase=query.get('phase',['sample'])[0]
 if width and e['outcome']=='ok':groups.setdefault((variant,phase,e['inputBytes'],width,scaled,method),[]).append(e['cpuTime'])
for key,values in sorted(groups.items(),key=str):print(key,len(values),'samples; median CPU',statistics.median(values),'ms')
