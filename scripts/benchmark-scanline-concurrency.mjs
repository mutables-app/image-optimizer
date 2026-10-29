import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base=process.env.EXPERIMENTS_WORKER_URL;if(!base)throw new Error('Set EXPERIMENTS_WORKER_URL');
const token=process.env.BENCHMARK_TOKEN??JSON.parse(await readFile('.build/benchmark-secrets.json','utf8')).BENCHMARK_TOKEN;
const directory=process.env.SCANLINE_WORKER_OUTPUT??'benchmarks/scanlines/worker';await mkdir(directory,{recursive:true});
const results=[];
for(const inputPath of ['benchmarks/photo-1920.jpg','test/fixtures/input-4k.jpg'])for(const speed of ['default','fast'])for(const format of ['webp','jpeg'])for(const concurrency of [1,2,4,8]) {
 const input=await readFile(inputPath),image=inputPath.split('/').at(-1),samples=[];
 const url=new URL(base);for(const [k,v] of Object.entries({width:800,height:800,quality:80,pipeline:format==='jpeg'?'jpeg':'scanlines',scaled:speed==='fast',method:speed==='fast'?1:4,variant:'scanlines-concurrency',phase:'burst',image,concurrency}))url.searchParams.set(k,String(v));
 const started=performance.now();
 // Two waves are exploratory and cannot establish sustained platform capacity.
 for(let wave=0;wave<2;wave++)await Promise.all(Array.from({length:concurrency},async()=>{
  const start=performance.now();
  try {
   const r=await fetch(url,{method:'POST',body:input,headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)}),bytes=new Uint8Array(await r.arrayBuffer());
   const ok=r.ok&&(format==='jpeg'?bytes[0]===255&&bytes[1]===216:new TextDecoder().decode(bytes.subarray(8,12))==='WEBP');
   samples.push({ok,status:r.status,latencyMs:performance.now()-start,bytes:bytes.length});
  }catch(e){samples.push({ok:false,error:String(e),latencyMs:performance.now()-start});}
 }));
 const elapsedMs=performance.now()-started,latencies=samples.map(x=>x.latencyMs).sort((a,b)=>a-b);
 results.push({image,width:800,speed,format,concurrency,requests:samples.length,successes:samples.filter(x=>x.ok).length,elapsedMs,completedRequestsPerSecond:samples.filter(x=>x.ok).length/(elapsedMs/1000),p50LatencyMs:latencies[Math.floor(latencies.length/2)],p95LatencyMs:latencies[Math.ceil(.95*latencies.length)-1],samples});
 console.log(image,speed,format,`concurrency ${concurrency}: ${samples.filter(x=>x.ok).length}/${samples.length}`);
 await writeFile(`${directory}/concurrency.json`,JSON.stringify({timestamp:new Date().toISOString(),note:'Two waves per concurrency, one client, one deployment. This measures incoming concurrent requests, not simultaneous CPU work within one isolate, sustained capacity or global scaling limits.',results},null,2)+'\n');
}
if(results.some(x=>x.successes<x.requests))process.exitCode=1;
