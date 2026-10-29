import {experiment} from '../packages/optimizer/dist/optimizer.node.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
const directory='benchmarks/experiments';await mkdir(directory,{recursive:true});
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const stages=['decodeMs','decodedCopyMs','resizeMs','encodeMs','encodedCopyMs'];
const rows=[];
// Alternate the direction of each repetition to reduce ordering bias.
for(const file of ['benchmarks/photo-1920.jpg','benchmarks/gradient-1920.png']) {
 const input=await readFile(file);const label=file.includes('.jpg')?'jpeg':'png';
 for(const width of [320,800,1600]) {
  const reference=experiment(input,width,width,true,true,80,true,8_000_000,false,-1,false);
  const referencePath=`${directory}/${label}-${width}-reference.webp`;
  await writeFile(referencePath,reference.take_bytes());
  const variants=[];
  for(const scaled of label==='jpeg'?[false,true]:[false])for(const method of [0,2,4,6])variants.push({scaled,method,samples:[]});
  for(let repetition=0;repetition<6;repetition++) {
   for(const variant of repetition%2?[...variants].reverse():variants) {
    const start=performance.now();
    const result=experiment(input,width,width,true,true,80,false,8_000_000,variant.scaled,variant.method,true);
    const timing=Array.from(result.stages_ms());
    const dimensions=[result.decoded_width,result.decoded_height];
    const bytes=result.take_bytes();const outerMs=performance.now()-start;
    if(repetition>0)variant.samples.push({outerMs,...Object.fromEntries(stages.map((key,i)=>[key,timing[i]]))});
    variant.bytes=bytes;variant.decodedDimensions=dimensions;
   }
  }
  for(const variant of variants) {
   const path=`${directory}/${label}-${width}-scaled${Number(variant.scaled)}-method${variant.method}.webp`;
   await writeFile(path,variant.bytes);
   const metrics=JSON.parse(execFileSync('.build/compare-webp',[referencePath,path],{encoding:'utf8'}));
   rows.push({input:file,width,scaled:variant.scaled,method:variant.method,inputBytes:input.length,decodedDimensions:variant.decodedDimensions,decodedRgbaBytes:variant.decodedDimensions[0]*variant.decodedDimensions[1]*4,outputBytes:variant.bytes.length,samples:variant.samples,medians:Object.fromEntries(['outerMs',...stages].map(key=>[key,median(variant.samples.map(s=>s[key]))])),metrics,path});
  }
  // Lossless scaled output isolates pixel changes from JPEG scaled decode/resize.
  if(label==='jpeg') {
   const result=experiment(input,width,width,true,true,80,true,8_000_000,true,-1,false);
   const path=`${directory}/${label}-${width}-scaled-lossless.webp`;await writeFile(path,result.take_bytes());
   const metrics=JSON.parse(execFileSync('.build/compare-webp',[referencePath,path],{encoding:'utf8'}));
   await writeFile(`${directory}/${label}-${width}-scaled-pixel-difference.json`,JSON.stringify(metrics,null,2)+'\n');
  }
  await writeFile(`${directory}/local-profile.json`,JSON.stringify({timestamp:new Date().toISOString(),runtime:process.version,architecture:process.arch,repetitions:6,warmSamplesPerVariant:5,rows,note:'Local Node ARM64 WASM host wall-clock durations, not deployed Worker per-stage CPU. Timed stages exclude JS/WASM boundary copies; outerMs includes result extraction. References are full-resolution decode + resize encoded losslessly. RGB PSNR is not a perceptual-quality guarantee; null PSNR with identicalRgb means zero RGB error.'},null,2)+'\n');
  console.log(label,width,'completed',variants.length,'variants');
 }
}
