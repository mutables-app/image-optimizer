// Measure end-to-end response time and Cloudflare per-invocation CPU for JPEG
// input converted to optimized JPEG at 800x600.
import {readFile, writeFile, rm} from 'node:fs/promises';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const node = process.execPath;
const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname;
const configPath = new URL('../examples/experiments/.wrangler-jpeg-output.jsonc', import.meta.url).pathname;
const workerConfig = JSON.parse(await readFile(new URL('../examples/experiments/wrangler.jsonc', import.meta.url), 'utf8'));
workerConfig.limits = {...workerConfig.limits, cpu_ms: 30000};
await writeFile(configPath, `${JSON.stringify(workerConfig, null, 2)}\n`);
const {BENCHMARK_TOKEN} = JSON.parse(await readFile(new URL('../.build/benchmark-secrets.json', import.meta.url), 'utf8'));
const fixtures = [
  {mp:12,file:'input-12mp-baseline.jpg'},
  {mp:24,file:'input-24mp-baseline.jpg'},
  {mp:48,file:'input-48mp-baseline.jpg'},
];
const modes = [{name:'default',scaled:false},{name:'fast',scaled:true}];
const rounds = 3;
const benchmarkStartedAt = new Date().toISOString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.ceil((sorted.length-1)/2)]) / 2 : null;
};
const runWrangler = (args, options={}) => execFileSync(node,[wrangler,...args],{
  cwd:new URL('../examples/experiments/',import.meta.url),
  encoding:'utf8',stdio:['pipe','pipe','pipe'],...options,
});
const results=[];
const createdWorkers=[];

try {
  for (const fixture of fixtures) for (const mode of modes) {
    const input=await readFile(new URL(`../test/fixtures/${fixture.file}`,import.meta.url));
    const workerName=`image-opt-jpeg-out-${fixture.mp}-${mode.name}-${randomUUID().slice(0,8)}`;
    const endpoint=`https://${workerName}.ted3.workers.dev/`;
    runWrangler(['deploy','--config',configPath,'--name',workerName]);
    createdWorkers.push(workerName);
    runWrangler(['secret','put','BENCHMARK_TOKEN','--config',configPath,'--name',workerName],{input:`${BENCHMARK_TOKEN}\n`});
    await delay(1800);

    let tailText='';
    const tail=spawn(node,[wrangler,'tail',workerName,'--config',configPath,'--format','json'],{
      cwd:new URL('../examples/experiments/',import.meta.url),stdio:['ignore','pipe','pipe'],
    });
    tail.stdout.setEncoding('utf8'); tail.stdout.on('data',chunk=>{tailText+=chunk;});
    tail.stderr.setEncoding('utf8'); tail.stderr.on('data',chunk=>{tailText+=chunk;});
    await delay(2200);
    if(tail.exitCode!==null) throw new Error(`Wrangler tail exited for ${workerName}`);

    const samples=[];
    const send=async phase=>{
      const url=new URL(endpoint);
      for(const [key,value] of Object.entries({width:800,height:600,quality:80,scaled:mode.scaled,pipeline:'jpeg',variant:'jpeg-output-benchmark',phase,image:fixture.file})) url.searchParams.set(key,String(value));
      const requestStartedAt=new Date().toISOString();
      const start=performance.now();
      const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${BENCHMARK_TOKEN}`},body:input,signal:AbortSignal.timeout(90000)});
      const bytes=new Uint8Array(await response.arrayBuffer());
      const jpeg=bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
      const ok=response.ok&&jpeg;
      samples.push({phase,status:response.status,ok,requestStartedAt,roundTripMs:performance.now()-start,
        outputBytes:bytes.length,wasmMemoryBytes:response.headers.get('x-wasm-linear-memory-bytes'),
        error:response.ok?null:new TextDecoder().decode(bytes).slice(0,300)});
      if(!ok) throw new Error(`${fixture.mp} MP JPEG ${mode.name} returned ${response.status}: ${samples.at(-1).error??'invalid JPEG output'}`);
    };
    await send('warmup');
    for(let round=1;round<=rounds;round++) await send(`sample-${round}`);
    await delay(1800);
    tail.kill('SIGINT');
    await Promise.race([new Promise(resolve=>tail.once('close',resolve)),delay(3000)]);
    if(tail.exitCode===null) tail.kill('SIGKILL');

    const events=[];
    for(let cursor=0;cursor<tailText.length;){
      const start=tailText.indexOf('{',cursor);if(start<0)break;
      let depth=0,inString=false,escaped=false,end=-1;
      for(let i=start;i<tailText.length;i++){
        const ch=tailText[i];
        if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
        if(ch==='"'){inString=true;continue;}
        if(ch==='{')depth++;else if(ch==='}'&&--depth===0){end=i+1;break;}
      }
      if(end<0)break;
      cursor=end;
      try{
        const event=JSON.parse(tailText.slice(start,end));
        const query=new URL(event.event?.request?.url??'https://invalid').searchParams;
        if(event.outcome==='ok'&&query.get('variant')==='jpeg-output-benchmark'&&Number.isFinite(event.cpuTime))
          events.push({phase:query.get('phase'),cpuTimeMs:event.cpuTime});
      }catch{}
    }
    const measured=samples.filter(sample=>sample.phase.startsWith('sample-'));
    const cpu=events.filter(event=>event.phase?.startsWith('sample-')).map(event=>event.cpuTimeMs);
    const summary={source:`Baseline JPEG, ${fixture.mp} MP`,file:fixture.file,inputBytes:input.length,
      mode:mode.name,output:'800x600 JPEG, quality 80',successes:measured.filter(x=>x.ok).length,
      responseP50Ms:Math.round(median(measured.map(x=>x.roundTripMs))),
      workerCpuMedianMs:cpu.length?Number(median(cpu).toFixed(2)):null,workerCpuSamples:cpu,
      wasmMemoryBytes:samples.at(-1)?.wasmMemoryBytes,
      outputBytesMedian:Math.round(median(measured.map(x=>x.outputBytes))),
      isolateMemoryMaxBytes:null,isolateMemoryMaxMiB:null,isolateMemorySampleCount:0,
      wranglerTailCpuSamples:cpu,
      workerName,requestSamples:samples.map(({phase,requestStartedAt,roundTripMs,outputBytes,wasmMemoryBytes})=>({phase,requestStartedAt,roundTripMs:Number(roundTripMs.toFixed(2)),outputBytes,wasmMemoryBytes})),
      responseSamplesMs:measured.map(x=>Number(x.roundTripMs.toFixed(2)))};
    results.push(summary);console.log(JSON.stringify(summary));
    runWrangler(['delete','--config',configPath,'--name',workerName,'--force']);createdWorkers.pop();
  }
} finally {
  for(const workerName of createdWorkers.reverse()){
    try{execFileSync(node,[wrangler,'delete','--config',configPath,'--name',workerName,'--force'],{stdio:'ignore'});}
    catch(error){console.error(`Could not delete temporary benchmark Worker ${workerName}: ${error.message}`);}
  }
  await rm(configPath,{force:true});
}

const report={timestamp:new Date().toISOString(),rounds,output:'800x600 JPEG, quality 80',
  responseTime:'Client-observed round trip, p50 of warm requests; includes network latency.',
  cpuTime:'Per-invocation CPU time from Wrangler tail; median of captured warm-request samples.',
  note:'Synthetic baseline JPEG fixtures. Each size and decode mode ran in a fresh Worker, with one warm-up and three measured requests. Wrangler tail may omit CPU events; null CPU means no matching samples were captured.',results};
const wranglerAuth=await readFile(`${process.env.HOME}/.config/.wrangler/config/default.toml`,'utf8');
const wranglerToken=wranglerAuth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!wranglerToken)throw new Error('Wrangler OAuth credentials are unavailable for isolate-memory analytics');
const accountId=workerConfig.account_id;
const analyticsQuery=`query($accountTag:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end}){dimensions{datetime coloCode status}sum{requests errors}quantiles{cpuTimeP99 memoryUsageBytesP99}}}}}`;
const analyticsStart=new Date(Date.parse(benchmarkStartedAt)-60000).toISOString();
let analyticsRows=[],analyticsErrors=[];
for(let attempt=1;attempt<=10;attempt++){
  const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:`Bearer ${wranglerToken}`,'content-type':'application/json'},body:JSON.stringify({query:analyticsQuery,variables:{accountTag:accountId,start:analyticsStart,end:new Date(Date.now()+30000).toISOString()}})});
  const data=await response.json();analyticsRows=data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive??[];analyticsErrors=data.errors??[];
  const matched=analyticsRows.filter(row=>row.dimensions?.coloCode==='WAW'&&results.some(item=>item.requestSamples.some(sample=>Math.floor(Date.parse(sample.requestStartedAt)/1000)===Date.parse(row.dimensions.datetime)/1000)));
  const covered=results.filter(item=>item.requestSamples.some(sample=>matched.some(row=>Math.floor(Date.parse(sample.requestStartedAt)/1000)===Date.parse(row.dimensions.datetime)/1000))).length;
  if(covered===results.length||attempt===10)break;
  await delay(10000);
}
const matchedAnalytics=analyticsRows.filter(row=>row.dimensions?.coloCode==='WAW'&&results.some(item=>item.requestSamples.some(sample=>Math.floor(Date.parse(sample.requestStartedAt)/1000)===Date.parse(row.dimensions.datetime)/1000)));
for(const item of results){
  const matched=matchedAnalytics.filter(row=>item.requestSamples.some(sample=>Math.floor(Date.parse(sample.requestStartedAt)/1000)===Date.parse(row.dimensions.datetime)/1000));
  const warmSeconds=new Set(item.requestSamples.filter(sample=>sample.phase.startsWith('sample-')).map(sample=>Math.floor(Date.parse(sample.requestStartedAt)/1000)));
  const measured=matched.filter(row=>warmSeconds.has(Date.parse(row.dimensions.datetime)/1000));
  const cpu=measured.map(row=>row.quantiles?.cpuTimeP99/1000).filter(Number.isFinite);
  const memory=matched.map(row=>row.quantiles?.memoryUsageBytesP99).filter(Number.isFinite);
  item.workerCpuSamples=cpu.length?cpu:item.wranglerTailCpuSamples;
  item.workerCpuMedianMs=item.workerCpuSamples.length?Number(median(item.workerCpuSamples).toFixed(2)):null;
  item.workerCpuSampleCount=item.workerCpuSamples.length;
  item.workerCpuSource=cpu.length?'Cloudflare invocation analytics':'Wrangler tail';
  item.isolateMemoryMaxBytes=memory.length?Math.max(...memory):null;
  item.isolateMemoryMaxMiB=item.isolateMemoryMaxBytes?Number((item.isolateMemoryMaxBytes/1048576).toFixed(2)):null;
  item.isolateMemorySampleCount=memory.length;
}
report.analytics={dataset:'workersInvocationsAdaptive',colo:'WAW',note:'Temporary Worker names may appear as __unknown__; analytics rows are correlated to request timestamps. cpuTimeP99 and memoryUsageBytesP99 are sampled per invocation, not exact peaks.',rows:matchedAnalytics,errors:analyticsErrors};
await writeFile(new URL('../benchmarks/jpeg-output-worker.json', import.meta.url),`${JSON.stringify(report,null,2)}\n`);
