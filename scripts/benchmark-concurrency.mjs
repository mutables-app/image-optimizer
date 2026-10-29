import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const [base,file,concurrency='4',count='8']=process.argv.slice(2);
const parallel=Number(concurrency),total=Number(count);
if(!base||!file||!Number.isInteger(parallel)||parallel<1||parallel>8||!Number.isInteger(total)||total<1||total>100)throw new Error('Usage: URL IMAGE [CONCURRENCY 1–8] [REQUESTS 1–100]');
const body=await readFile(file);const url=new URL(base);url.searchParams.set('width','800');url.searchParams.set('height','800');
let next=0;const results=[];const started=performance.now();
await Promise.all(Array.from({length:parallel},async()=>{
 while(next<total){const id=next++;const t=performance.now();try{
  const r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.BENCHMARK_TOKEN??''}`},body,signal:AbortSignal.timeout(30000)});
  const bytes=new Uint8Array(await r.arrayBuffer());
  results.push({id,status:r.status,ok:r.ok&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP',bytes:bytes.length,roundTripMs:performance.now()-t});
 }catch(error){results.push({id,ok:false,error:String(error.message),roundTripMs:performance.now()-t});}}
}));
const elapsedMs=performance.now()-started;
const report={timestamp:new Date().toISOString(),url:url.toString(),file,concurrency:parallel,requests:total,successes:results.filter(r=>r.ok).length,elapsedMs,completedRequestsPerSecond:results.filter(r=>r.ok).length/(elapsedMs/1000),results,note:'Small exploratory client-side burst, not a sustained throughput or capacity benchmark.'};
const path=(process.env.BENCHMARK_OUTPUT_DIR??'benchmarks/output')+'/concurrency.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
