// Bounded stress test of the authenticated account-owned experiments Worker.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const base=process.env.EXPERIMENTS_WORKER_URL;if(!base)throw new Error('Set EXPERIMENTS_WORKER_URL');
const token=process.env.BENCHMARK_TOKEN??JSON.parse(await readFile('.build/benchmark-secrets.json','utf8')).BENCHMARK_TOKEN;
const directory=process.env.SCANLINE_WORKER_OUTPUT??'benchmarks/scanlines/worker';await mkdir(directory,{recursive:true});
const input=await readFile('test/fixtures/input-4k.jpg');
const levels=(process.env.STRESS_CONCURRENCIES??'8,16,32,64').split(',').map(Number);
const waves=Number(process.env.STRESS_WAVES??2),results=[];
if(levels.some(n=>!Number.isInteger(n)||n<1||n>64)||!Number.isInteger(waves)||waves<1||waves>4)throw new Error('Bound stress to concurrency 1–64 and 1–4 waves');
const configurations=[{format:'webp',speed:'fast'},{format:'webp',speed:'default'},{format:'jpeg',speed:'default'}];
for(const {format,speed} of configurations)for(const concurrency of levels) {
 const url=new URL(base);for(const [k,v] of Object.entries({width:800,height:800,quality:80,pipeline:format==='jpeg'?'jpeg':'scanlines',scaled:speed==='fast',method:speed==='fast'?1:4,variant:'scanlines-stress',phase:'stress',image:'input-4k.jpg',concurrency}))url.searchParams.set(k,String(v));
 const started=performance.now(),samples=[];let sampleOutput;
 for(let wave=0;wave<waves;wave++) {
  const waveStarted=performance.now();
  await Promise.all(Array.from({length:concurrency},async(_,index)=>{
   const start=performance.now();
   try {
    const r=await fetch(url,{method:'POST',body:input,headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)}),bytes=new Uint8Array(await r.arrayBuffer());
    const validSignature=format==='jpeg'?bytes[0]===255&&bytes[1]===216:new TextDecoder().decode(bytes.subarray(8,12))==='WEBP';
    const ok=r.ok&&validSignature;
    samples.push({wave,index,ok,status:r.status,latencyMs:performance.now()-start,bytes:bytes.length,...(!ok?{error:new TextDecoder().decode(bytes).slice(0,200)}:{})});
    if(ok&&!sampleOutput)sampleOutput=bytes;
   }catch(e){samples.push({wave,index,ok:false,error:String(e),latencyMs:performance.now()-start});}
  }));
  console.log(format,speed,`concurrency=${concurrency} wave=${wave+1}/${waves}`,`${samples.filter(x=>x.wave===wave&&x.ok).length}/${concurrency} in ${((performance.now()-waveStarted)/1000).toFixed(2)}s`);
 }
 const elapsedMs=performance.now()-started,latencies=samples.filter(x=>x.ok).map(x=>x.latencyMs).sort((a,b)=>a-b);
 let independentlyValidated=false;
 if(sampleOutput) {
  const decoded=spawnSync('python3',['test/decode-image.py'],{input:sampleOutput,encoding:null,maxBuffer:64*1024*1024});
  if(decoded.status!==0)throw new Error(decoded.stderr.toString());
  const info=JSON.parse(decoded.stdout);if(info.width!==800||info.height!==450)throw new Error('Unexpected output dimensions');
  independentlyValidated=true;
 }
 results.push({image:'input-4k.jpg',inputBytes:input.length,width:800,height:450,format,speed,concurrency,waves,requests:samples.length,successes:samples.filter(x=>x.ok).length,elapsedMs,completedRequestsPerSecond:samples.filter(x=>x.ok).length/(elapsedMs/1000),p50LatencyMs:latencies[Math.ceil(.5*latencies.length)-1]??null,p95LatencyMs:latencies[Math.ceil(.95*latencies.length)-1]??null,maxLatencyMs:latencies.at(-1)??null,independentlyValidated,samples});
 await writeFile(`${directory}/stress.json`,JSON.stringify({timestamp:new Date().toISOString(),note:'Bounded burst stress from one client, one deployment. Concurrent incoming requests are not proof of parallel execution inside one isolate. Two waves per level; this does not establish sustained/global capacity. Every successful response is checked for its format signature and one output per configuration/level is independently decoded.',results},null,2)+'\n');
 if(samples.some(x=>!x.ok)) {console.log('Stopping ramp for this configuration after a failed request.');break;}
}
if(results.some(x=>x.successes<x.requests))process.exitCode=1;
