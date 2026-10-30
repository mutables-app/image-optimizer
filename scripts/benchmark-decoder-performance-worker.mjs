// Measure end-to-end response time and Cloudflare's per-invocation CPU time
// for representative 12, 24, and 48 MP decoder paths.
import {readFile, writeFile, rm} from 'node:fs/promises';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const node = process.execPath;
const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname;
const configPath = new URL('../examples/experiments/.wrangler-decoder-performance.jsonc', import.meta.url).pathname;
const baseConfigPath = new URL('../examples/experiments/wrangler.jsonc', import.meta.url);
const workerConfig = JSON.parse(await readFile(baseConfigPath, 'utf8'));
workerConfig.limits = {...workerConfig.limits, cpu_ms: 30000};
await writeFile(configPath, `${JSON.stringify(workerConfig, null, 2)}\n`);
const {BENCHMARK_TOKEN} = JSON.parse(await readFile('.build/benchmark-secrets.json', 'utf8'));
const fixtures = [
  {label:'Baseline JPEG',mp:12,file:'input-12mp-baseline.jpg'},
  {label:'Baseline JPEG',mp:24,file:'input-24mp-baseline.jpg'},
  {label:'Baseline JPEG',mp:48,file:'input-48mp-baseline.jpg'},
  {label:'Non-interlaced PNG',mp:12,file:'input-12mp-streaming.png'},
  {label:'Non-interlaced PNG',mp:24,file:'input-24mp-streaming.png'},
  {label:'Non-interlaced PNG',mp:48,file:'input-48mp-streaming.png'},
  {label:'Lowzag progressive JPEG',mp:12,file:'input-12mp-progressive.jpg'},
  {label:'Lowzag progressive JPEG',mp:24,file:'input-24mp-progressive.jpg'},
  {label:'Lowzag progressive JPEG',mp:48,file:'input-48mp-progressive.jpg'},
  {label:'Tiled/grid HEIC/HEIF',mp:12,file:'grid-12mp-512px-tiles.heic'},
  {label:'Tiled/grid HEIC/HEIF',mp:24,file:'input-24mp-grid.heic'},
  {label:'Tiled/grid HEIC/HEIF',mp:48,file:'input-48mp-grid.heic'},
];
const only = process.env.DECODER_BENCHMARK_ONLY?.split(',').map(value=>value.trim()).filter(Boolean);
const selectedFixtures = only ? fixtures.filter(item=>only.includes(item.file)) : fixtures;
if (only && selectedFixtures.length !== only.length) throw new Error(`Unknown benchmark fixture(s): ${only.filter(file=>!fixtures.some(item=>item.file===file)).join(', ')}`);
const rounds = Number(process.env.DECODER_BENCHMARK_ROUNDS ?? 3);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.ceil((sorted.length-1)/2)]) / 2 : null;
};
const results = [];
const createdWorkers = [];
const runWrangler = (args, options={}) => execFileSync(node,[wrangler,...args],{
  cwd:new URL('../examples/experiments/',import.meta.url),
  encoding:'utf8',stdio:['pipe','pipe','pipe'],...options,
});

try {
  for (const [index,item] of selectedFixtures.entries()) {
    const input = await readFile(new URL(`../test/fixtures/${item.file}`,import.meta.url));
    const workerName = `image-opt-perf-${index}-${randomUUID().slice(0,8)}`;
    const endpoint = `https://${workerName}.ted3.workers.dev/`;
    const startedAt = new Date(Date.now()-120000).toISOString();
    runWrangler(['deploy','--config',configPath,'--name',workerName]);
    createdWorkers.push(workerName);
    runWrangler(['secret','put','BENCHMARK_TOKEN','--config',configPath,'--name',workerName],{input:`${BENCHMARK_TOKEN}\n`});
    await delay(1800);

    let tailText = '';
    const tail = spawn(node,[wrangler,'tail',workerName,'--config',configPath,'--format','json'],{
      cwd:new URL('../examples/experiments/',import.meta.url),stdio:['ignore','pipe','pipe'],
    });
    tail.stdout.setEncoding('utf8');
    tail.stdout.on('data',chunk=>{tailText+=chunk;});
    tail.stderr.setEncoding('utf8');
    tail.stderr.on('data',chunk=>{tailText+=chunk;});
    await delay(2200);
    if (tail.exitCode !== null) throw new Error(`Wrangler tail exited for ${workerName}`);

    const samples=[];
    const send = async phase => {
      const url = new URL(endpoint);
      for (const [key,value] of Object.entries({width:800,height:600,quality:80,scaled:true,method:1,pipeline:'scanlines',variant:'decoder-performance',phase,image:item.file}))
        url.searchParams.set(key,String(value));
      const start = performance.now();
      const response = await fetch(url,{method:'POST',headers:{authorization:`Bearer ${BENCHMARK_TOKEN}`},body:input,signal:AbortSignal.timeout(90000)});
      const bytes = new Uint8Array(await response.arrayBuffer());
      const webp = bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0,4))==='RIFF' && new TextDecoder().decode(bytes.subarray(8,12))==='WEBP';
      const ok = item.expectReject ? response.status===400 : response.ok && webp;
      samples.push({phase,status:response.status,ok,roundTripMs:performance.now()-start,
        wasmMemoryBytes:response.headers.get('x-wasm-linear-memory-bytes'),decoded:response.headers.get('x-decoded-dimensions'),
        error:response.ok?null:new TextDecoder().decode(bytes).slice(0,300)});
      if (!ok) throw new Error(`${item.label} ${item.mp} MP (${item.file}) returned ${response.status}: ${samples.at(-1).error ?? 'invalid WebP'}`);
    };
    await send('warmup');
    for (let round=1;round<=rounds;round++) await send(`sample-${round}`);
    await delay(1800);
    tail.kill('SIGINT');
    await Promise.race([new Promise(resolve=>tail.once('close',resolve)),delay(3000)]);
    if (tail.exitCode === null) tail.kill('SIGKILL');

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
        if(event.outcome==='ok'&&query.get('variant')==='decoder-performance'&&Number.isFinite(event.cpuTime))
          events.push({phase:query.get('phase'),cpuTimeMs:event.cpuTime});
      }catch{}
    }
    const measured=samples.filter(sample=>sample.phase.startsWith('sample-'));
    const cpu=events.filter(event=>event.phase?.startsWith('sample-')).map(event=>event.cpuTimeMs);
    const summary={...item,inputBytes:input.length,expected:item.expectReject?'rejection':'success',successes:measured.filter(x=>x.ok).length,
      responseP50Ms:Math.round(median(measured.map(x=>x.roundTripMs))),workerCpuMedianMs:cpu.length?Number(median(cpu).toFixed(2)):null,
      workerCpuSamples:cpu,wasmMemoryBytes:samples.at(-1)?.wasmMemoryBytes,decoded:samples.at(-1)?.decoded,
      responseSamplesMs:measured.map(x=>Number(x.roundTripMs.toFixed(2)))};
    results.push(summary);
    console.log(JSON.stringify(summary));
    runWrangler(['delete','--config',configPath,'--name',workerName,'--force']);
    createdWorkers.pop();
  }
} finally {
  for (const workerName of createdWorkers.reverse()) {
    try { execFileSync(node,[wrangler,'delete','--config',configPath,'--name',workerName,'--force'],{stdio:'ignore'}); }
    catch (error) { console.error(`Could not delete temporary Worker ${workerName}: ${error.message}`); }
  }
  await rm(configPath,{force:true});
}

const report={timestamp:new Date().toISOString(),rounds,output:'800x600 WebP',
  responseTime:'Client-observed round trip, p50 of warm requests; includes network latency.',
  cpuTime:'Per-invocation CPU time from Wrangler tail; median of warm requests.',
  note:'Synthetic fixtures for currently supported paths. Adam7 PNG and non-grid HEIC/HEIF are unsupported. Cloudflare tail may omit events; null CPU means no matching tail samples were captured.',results};
const path=process.env.DECODER_PERFORMANCE_OUTPUT??'benchmarks/decoder-performance-worker.json';
let previous;
try { previous=JSON.parse(await readFile(path,'utf8')); } catch {}
const unsupported=previous?.results.filter(item=>/^Adam7 PNG|^Non-grid HEIC\/HEIF|^Other progressive JPEG|^CMYK progressive JPEG|^YCCK progressive JPEG/.test(item.label))??[];
report.historicalUnsupportedResults=[...(previous?.historicalUnsupportedResults??[]),...unsupported.map(item=>({...item,historical:true,note:'Historical measurement only; this input path is no longer supported.'}))];
if (only && previous) {
  const replaced=new Set(results.map(item=>item.file));
  report.results=[...previous.results.filter(item=>!replaced.has(item.file)&&!unsupported.includes(item)),...results];
}
await writeFile(path,`${JSON.stringify(report,null,2)}\n`);
