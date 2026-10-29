import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const token=JSON.parse(await readFile('.build/benchmark-secrets.json','utf8')).BENCHMARK_TOKEN;
const output=process.env.METHOD_AB_OUTPUT??'benchmarks/experiments/method-ab';
await mkdir(output,{recursive:true});
const methods=[1,2,3,4];
const widths=[800,1600];
const measuredRounds=Number(process.env.METHOD_AB_ROUNDS??12);
const samplePhase=process.env.METHOD_AB_PHASE??'sample';
const variant=process.env.METHOD_AB_VARIANT??'methods-ab';
const workerUrl=process.env.EXPERIMENTS_WORKER_URL;
if(!workerUrl)throw new Error('Set EXPERIMENTS_WORKER_URL to your own test Worker URL');
const results=[];

for(const width of widths) {
 const input=await readFile('benchmarks/photo-1920.jpg');
 const outputs=new Map();
 const request=async(method,phase,round)=>{
  const endpoint=new URL(workerUrl);
  for(const [key,value] of Object.entries({width,height:width,quality:80,scaled:'true',method,variant,phase})) endpoint.searchParams.set(key,String(value));
  const started=performance.now();
  try {
   const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`},body:input,signal:AbortSignal.timeout(30000)});
   const bytes=new Uint8Array(await response.arrayBuffer());
   const valid=response.ok&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
   const item={width,method,phase,round,status:response.status,ok:valid,roundTripMs:performance.now()-started,outputBytes:valid?bytes.length:null,decoded:response.headers.get('x-decoded-dimensions'),output:response.headers.get('x-output-dimensions'),colo:response.headers.get('x-worker-colo')};
   if(valid&&phase.startsWith('sample'))outputs.set(method,bytes);
   if(!valid)item.error=new TextDecoder().decode(bytes).slice(0,180);
   results.push(item);
  } catch(error) { results.push({width,method,phase,round,ok:false,roundTripMs:performance.now()-started,error:String(error)}); }
 };
 // Warm each method before the first measured run only; tag these separately.
 if(process.env.METHOD_AB_SKIP_WARMUP!=='true')for(const method of methods) await request(method,'warmup',0);
 for(let round=0;round<measuredRounds;round++) {
  const order=round%2===0?methods:[...methods].reverse();
  for(const method of order) await request(method,samplePhase,round+1);
 }
 for(const [method,bytes] of outputs) await writeFile(`${output}/jpeg-${width}-method${method}.webp`,bytes);
 console.log(`width ${width}:`,methods.map(method=>`${method}=${results.filter(r=>r.width===width&&r.method===method&&r.phase===samplePhase&&r.ok).length}/${measuredRounds}`).join(' '));
}

const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length?(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2:null;};
const percentile=(xs,p)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.ceil(p*s.length)-1]:null;};
const summary=[];
for(const width of widths)for(const method of methods) {
 const samples=results.filter(r=>r.width===width&&r.method===method&&r.phase===samplePhase);
 const successful=samples.filter(r=>r.ok);
 summary.push({width,method,sampleRequests:samples.length,successes:successful.length,failures:samples.length-successful.length,p50RoundTripMs:median(successful.map(r=>r.roundTripMs)),p95RoundTripMs:percentile(successful.map(r=>r.roundTripMs),.95),medianOutputBytes:median(successful.map(r=>r.outputBytes))});
}
await writeFile(`${output}/summary.json`,JSON.stringify({timestamp:new Date().toISOString(),measuredRounds,warmupsPerMethodPerWidth:process.env.METHOD_AB_SKIP_WARMUP==='true'?0:1,note:'Methods are interleaved by round on the same deployed Worker and JPEG fixture. Client round trips include network and are not CPU timings; Cloudflare trace CPU is recorded separately.',summary,results},null,2)+'\n');
