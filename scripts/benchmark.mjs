import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const [url, file, width='800', count='10'] = process.argv.slice(2);
if (!url || !file) throw new Error('Usage: node scripts/benchmark.mjs URL IMAGE [WIDTH=800] [RUNS=10]; set BENCHMARK_TOKEN');
const runs=Number(count);
if (!Number.isInteger(runs)||runs<1||runs>100) throw new Error('RUNS must be 1–100');
const input=await readFile(file);
const endpoint=new URL(url);endpoint.searchParams.set('width',width);endpoint.searchParams.set('height',width);
const results=[];let output;
for(let i=0;i<runs+1;i++) {
 const start=performance.now();
 try {
  const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${process.env.BENCHMARK_TOKEN??''}`},body:input,signal:AbortSignal.timeout(30000)});
  const bytes=new Uint8Array(await r.arrayBuffer());
  const signature=new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  const result={run:i,status:r.status,ok:r.ok&&signature,roundTripMs:performance.now()-start,colo:r.headers.get('x-worker-colo')};
  if(result.ok) {output=bytes;result.outputBytes=bytes.length;result.observedTransformMs=Number(r.headers.get('x-observed-transform-ms'));}
  else {result.error=new TextDecoder().decode(bytes).includes('1102')?'Cloudflare 1102: resource limits exceeded':new TextDecoder().decode(bytes).slice(0,200);}
  results.push(result);
 } catch(error) {results.push({run:i,ok:false,roundTripMs:performance.now()-start,error:String(error.message)});}
}
const warm=results.slice(1).filter(x=>x.ok).map(x=>x.roundTripMs).sort((a,b)=>a-b);
const percentile=p=>warm.length?warm[Math.min(warm.length-1,Math.ceil(p*warm.length)-1)]:null;
const report={timestamp:new Date().toISOString(),url:endpoint.toString(),input:file,inputBytes:input.length,firstRequest:results[0],warmRuns:runs,warmSuccesses:warm.length,failures:results.filter(x=>!x.ok).length,p50Ms:percentile(.5),p95Ms:percentile(.95),outputBytes:output?.length??null,results,note:'Sequential HTTP round trips include upload/download and network latency. First request is not proof of a cold start. Worker timers are not CPU measurements. Percentiles include successful warm requests only; compare failure counts too.'};
const directory=process.env.BENCHMARK_OUTPUT_DIR??'benchmarks';
await mkdir(directory,{recursive:true});
const name=`${directory}/${file.split('/').pop()}-${width}`;
await writeFile(name+'.json',JSON.stringify(report,null,2)+'\n');if(output) await writeFile(name+'.webp',output);else await rm(name+'.webp',{force:true});
console.log(JSON.stringify(report,null,2));
