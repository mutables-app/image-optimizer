import {image} from '@mutables.app/image-optimizer';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const rows=[];
for (const file of ['benchmarks/photo-1920.jpg','benchmarks/gradient-1920.png']) {
 const input=await readFile(file);
 for(const width of [320,800,1600]) {
  const samples=[];let bytes;
  for(let i=0;i<6;i++) {const t=performance.now();bytes=await image(input).resize(width,width,{fit:'inside',withoutEnlargement:true}).webp({quality:80}).bytes();samples.push(performance.now()-t);}
  const sorted=samples.slice(1).sort((a,b)=>a-b);
  rows.push({file,width,inputBytes:input.length,outputBytes:bytes.length,firstMs:samples[0],warmMedianMs:sorted[2],samplesMs:samples});
 }
}
await writeFile('benchmarks/local-wasm.json',JSON.stringify({runtime:process.version,architecture:process.arch,rows,note:'Local ARM64 Node WASM timings; no network, not native Bun or production Worker CPU timings.'},null,2));
console.table(rows.map(({samplesMs,...row})=>row));
