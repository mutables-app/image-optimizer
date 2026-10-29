// Fresh Node processes isolate WASM high-water capacity for each variant.
// Compare matched codec settings; the legacy reference remains experimental.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const median=values=>{const s=[...values].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2};
if(process.argv[2]==='--case') {
 const [inputPath,widthText,kind,speed]=process.argv.slice(3);
 const input=await readFile(inputPath),width=Number(widthText);
 const {experiment,scanline_experiment,optimize_jpeg,linear_memory_bytes}=await import('../packages/optimizer/dist/optimizer.node.js');
 const initialWasmBytes=linear_memory_bytes();
 const scaled=speed==='fast',method=scaled?1:-1;
 let stats={};
 const transform=()=>{
  if(kind==='jpeg')return optimize_jpeg(input,width,width,true,true,80,16_000_000,scaled);
  const result=(kind==='reference'?experiment:scanline_experiment)(input,width,width,true,true,80,false,16_000_000,scaled,method,false);
  stats={source:[result.source_width,result.source_height],decoded:[result.decoded_width,result.decoded_height],output:[result.output_width,result.output_height],rowStorageEstimateBytes:result.peak_row_bytes,codecBuffered:result.codec_buffered};
  return result.take_bytes();
 };
 let bytes=transform();const firstTransformWasmBytes=linear_memory_bytes();
 const samples=[];
 for(let i=0;i<Number(process.env.SCANLINE_ROUNDS??5);i++) {
  const cpu=process.cpuUsage(),start=performance.now();bytes=transform();
  const cpuTime=process.cpuUsage(cpu);samples.push({wallMs:performance.now()-start,cpuMs:(cpuTime.user+cpuTime.system)/1000});
 }
 if(process.env.SCANLINE_SAVE_OUTPUT)await writeFile(process.env.SCANLINE_SAVE_OUTPUT,bytes);
 process.stdout.write(JSON.stringify({inputPath,width,kind,speed,inputBytes:input.length,outputBytes:bytes.length,initialWasmBytes,firstTransformWasmBytes,highWaterWasmBytes:linear_memory_bytes(),...stats,medianWallMs:median(samples.map(x=>x.wallMs)),medianCpuMs:median(samples.map(x=>x.cpuMs)),samples}));
} else {
 const directory=process.env.SCANLINE_OUTPUT??'benchmarks/scanlines/local';await mkdir(directory,{recursive:true});
 const inputs=(process.env.SCANLINE_INPUTS??'benchmarks/photo-1920.jpg,benchmarks/landscape-2400.jpg,benchmarks/food-2400.jpg,test/fixtures/input-4k.jpg,benchmarks/gradient-1920.png').split(',');
 const widths=(process.env.SCANLINE_WIDTHS??'320,800,1600').split(',').map(Number);
 const kinds=(process.env.SCANLINE_KINDS??'reference,scanlines,jpeg').split(',');
 const results=[];
 for(const input of inputs)for(const width of widths)for(const speed of ['default','fast'])for(const kind of kinds) {
  const output=`${directory}/${input.split('/').at(-1)}-${width}-${speed}-${kind}.${kind==='jpeg'?'jpg':'webp'}`;
  const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--case',input,String(width),kind,speed],{encoding:'utf8',env:{...process.env,SCANLINE_SAVE_OUTPUT:output},timeout:120000});
  if(result.status!==0)throw new Error(result.stderr||result.error||`Case failed ${input} ${width} ${kind}`);
  const row=JSON.parse(result.stdout);results.push(row);
  console.log(input,width,speed,kind,`${row.medianCpuMs.toFixed(1)}ms CPU`,`${(row.highWaterWasmBytes/1048576).toFixed(1)}MiB WASM`);
 }
 await writeFile(`${directory}/results.json`,JSON.stringify({timestamp:new Date().toISOString(),runtime:process.version,architecture:process.arch,notes:['One warmup, then repeated transforms in a fresh process per case.','CPU is local Node process CPU, not Cloudflare CPU.','WASM capacity is high-water linear-memory capacity, not live heap or whole-process memory.','Reference and scanline cases match quality, scaling and WebP encoder settings. JPEG has no legacy encoder baseline.','rowStorageEstimateBytes excludes coefficients, codec-internal buffers, input, encoded output and the WebP destination.'],results},null,2)+'\n');
}
