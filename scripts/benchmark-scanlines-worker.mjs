// Interleave the two pipelines on the SAME deployed test Worker. Tokens remain
// in the environment or the existing ignored local secret file, never results.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const directory=process.env.SCANLINE_WORKER_OUTPUT??'benchmarks/scanlines/worker';await mkdir(directory,{recursive:true});
const endpoint=process.env.EXPERIMENTS_WORKER_URL;if(!endpoint)throw new Error('Set EXPERIMENTS_WORKER_URL to your own test Worker');
const token=process.env.BENCHMARK_TOKEN??JSON.parse(await readFile('.build/benchmark-secrets.json','utf8')).BENCHMARK_TOKEN;
const inputs=(process.env.SCANLINE_INPUTS??'benchmarks/photo-1920.jpg,benchmarks/landscape-2400.jpg,benchmarks/food-2400.jpg,test/fixtures/input-4k.jpg,benchmarks/gradient-1920.png').split(',');
const widths=(process.env.SCANLINE_WIDTHS??'800,1600').split(',').map(Number);
const rounds=Number(process.env.SCANLINE_ROUNDS??8),results=[];
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length?(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2:null;};
for(const inputPath of inputs)for(const width of widths)for(const speed of ['default','fast']) {
 const input=await readFile(inputPath),image=inputPath.split('/').at(-1);
 const request=async(pipeline,phase,round)=>{
  const url=new URL(endpoint);
  for(const [k,v] of Object.entries({width,height:width,quality:80,scaled:speed==='fast',method:speed==='fast'?1:4,pipeline,phase,image,variant:'scanlines-ab'}))url.searchParams.set(k,String(v));
  const start=performance.now();
  try {
   const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`},body:input,signal:AbortSignal.timeout(45000)});
   const bytes=new Uint8Array(await response.arrayBuffer());
   const ok=response.ok && new TextDecoder().decode(bytes.subarray(0,4))==='RIFF' && new TextDecoder().decode(bytes.subarray(8,12))==='WEBP';
   results.push({image,inputBytes:input.length,width,speed,pipeline,phase,round,status:response.status,ok,roundTripMs:performance.now()-start,outputBytes:ok?bytes.length:null,outputDimensions:response.headers.get('x-output-dimensions'),decodedDimensions:response.headers.get('x-decoded-dimensions'),rowStorageEstimate:response.headers.get('x-row-storage-estimate'),codecBuffered:response.headers.get('x-codec-buffered'),colo:response.headers.get('x-worker-colo'),...(!ok?{error:new TextDecoder().decode(bytes).slice(0,300)}:{})});
   if(ok && round===1)await writeFile(`${directory}/${image}-${width}-${speed}-${pipeline}.webp`,bytes);
  }catch(e){results.push({image,width,speed,pipeline,phase,round,ok:false,error:String(e)});}
 };
 for(const pipeline of ['reference','scanlines'])await request(pipeline,'warmup',0);
 for(let r=1;r<=rounds;r++)for(const pipeline of (r%2?['reference','scanlines']:['scanlines','reference']))await request(pipeline,'sample',r);
 console.log(image,width,speed,results.filter(r=>r.image===image&&r.width===width&&r.speed===speed&&r.phase==='sample'&&r.ok).length,`/${rounds*2} successful`);
 await writeFile(`${directory}/results.json`,JSON.stringify({timestamp:new Date().toISOString(),rounds,note:'Matched codec settings, pipelines interleaved by round on the same test Worker. Round trip includes network and is not Worker CPU. CPU traces are collected separately. CPU limit remains 1000ms.',results},null,2)+'\n');
}
const summary=[];
for(const inputPath of inputs)for(const width of widths)for(const speed of ['default','fast'])for(const pipeline of ['reference','scanlines']) {
 const samples=results.filter(r=>r.image===inputPath.split('/').at(-1)&&r.width===width&&r.speed===speed&&r.pipeline===pipeline&&r.phase==='sample');
 summary.push({image:inputPath.split('/').at(-1),width,speed,pipeline,requests:samples.length,successes:samples.filter(r=>r.ok).length,medianRoundTripMs:median(samples.filter(r=>r.ok).map(r=>r.roundTripMs))});
}
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(results.some(r=>!r.ok))process.exitCode=1;
