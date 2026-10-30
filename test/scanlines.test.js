import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {crc32} from 'node:zlib';
import {image} from '@mutables.app/image-optimizer';
import {optimizeWorkspaceImage} from '@mutables.app/image-computer';
import {scanline_experiment,experiment,linear_memory_bytes} from '../packages/optimizer/dist/optimizer.node.js';
import {rgbaPng,specialPng} from './helpers/png.js';
const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
function decode(bytes) {
 const p=spawnSync('python3',['test/decode-image.py'],{input:bytes,maxBuffer:64*1024*1024});
 assert.equal(p.status,0,p.stderr.toString());
 const out=JSON.parse(p.stdout);out.pixels=Buffer.from(out.pixels,'base64');return out;
}
function scan(input,w,h,scaled=false,lossless=true) {
 return scanline_experiment(input,w,h,false,false,80,lossless,8_000_000,scaled,-1,false);
}
const color=(x,y)=>[(x*13+y*2)%256,(x*3+y*11)%256,(x*7+y*5)%256,255];
const png=rgbaPng(97,65,color);
test('scanline Lanczos3 closely matches the full-buffer reference for shrinking, enlarging and stretching',()=>{
 for(const [w,h] of [[31,19],[131,89],[97,19],[31,65],[1,1],[1,121],[121,1]]) {
  const out=decode(scan(png,w,h).take_bytes());
  const ref=decode(experiment(png,w,h,false,false,80,true,8_000_000,false,-1,false).take_bytes());
  assert.deepEqual([out.width,out.height],[w,h]);
  let squared=0;for(let i=0;i<out.pixels.length;i++) squared+=(out.pixels[i]-ref.pixels[i])**2;
  const rmse=Math.sqrt(squared/out.pixels.length);
  assert.ok(rmse<3,`${w}x${h} RMSE ${rmse}`);
 }
});
test('alpha is premultiplied across both resize passes and transparent colors cannot bleed',()=>{
 const source=rgbaPng(73,57,(x)=>x<36?[0,0,255,255]:[255,0,0,0]);
 for(const [w,h] of [[29,23],[117,91]]) {
  const out=decode(scan(source,w,h).take_bytes());
  let partial=0;
  for(let i=0;i<out.pixels.length;i+=4) {
   if(out.pixels[i+3]>8) {assert.equal(out.pixels[i],0);assert.equal(out.pixels[i+2],255);}
   if(out.pixels[i+3]>0&&out.pixels[i+3]<255) partial++;
  }
  assert.ok(partial>0);
 }
});
test('unresized lossless PNG preserves visible pixels exactly',async()=>{
 const out=decode(await image(png).webp({lossless:true}).bytes());
 assert.deepEqual(out.pixels,Buffer.from(Array.from({length:97*65},(_,i)=>color(i%97,Math.floor(i/97))).flat()));
});
test('Adam7 downscales use callbacks while enlargements keep the fallback',()=>{
 const adam7=rgbaPng(97,65,color,true);
 for(const [w,h] of [[97,65],[29,23],[117,91]]) {
  const result=scan(adam7,w,h);assert.equal(result.codec_buffered,w>97||h>65);
  const actual=decode(result.take_bytes()),reference=decode(scan(png,w,h).take_bytes());
  assert.deepEqual([actual.width,actual.height],[w,h]);
  let squared=0;for(let i=0;i<actual.pixels.length;i++) squared+=(actual.pixels[i]-reference.pixels[i])**2;
  assert.ok(Math.sqrt(squared/actual.pixels.length)<1.5,`${w}x${h} Lanczos RMSE exceeds tolerance`);
 }
 assert.equal(scan(png,29,23).codec_buffered,false);
});
test('Adam7 Lanczos accumulation premultiplies transparent pixels',()=>{
 const adam7=rgbaPng(97,65,x=>x<48?[0,0,255,255]:[255,0,0,0],true);
 const output=decode(scan(adam7,29,23).take_bytes());let partial=0;
 for(let i=0;i<output.pixels.length;i+=4) {
  if(output.pixels[i+3]>8) {assert.equal(output.pixels[i],0);assert.equal(output.pixels[i+2],255);}
  if(output.pixels[i+3]>0&&output.pixels[i+3]<255) partial++;
 }
 assert.ok(partial>0);
});
test('24MP Adam7 PNG resizes within a bounded WASM memory budget',async()=>{
 const input=await fixture('adam7-24mp.png');
 const result=scan(input,800,0,false,false);
 assert.equal(result.codec_buffered,false);
 assert.deepEqual([result.source_width,result.source_height],[6000,4000]);
 assert.deepEqual([result.output_width,result.output_height],[800,533]);
 const output=decode(result.take_bytes());assert.deepEqual([output.width,output.height],[800,533]);
 assert.ok(linear_memory_bytes()<=32*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 32 MiB`);
});
test('baseline, progressive, grayscale and CMYK JPEGs decode consistently',async()=>{
 for(const name of ['rows-baseline.jpg','rows-progressive.jpg','rows-gray.jpg','rows-cmyk.jpg']) {
  const input=await fixture(name), native=decode(input);
  const result=scan(input,97,65);
  assert.equal(result.codec_buffered,name==='rows-progressive.jpg');
  const out=decode(result.take_bytes());
  let max=0;for(let i=0;i<out.pixels.length;i++)max=Math.max(max,Math.abs(out.pixels[i]-native.pixels[i]));
  assert.ok(max<=2,`${name}: largest decoder difference ${max}`);
  for(const speed of [undefined,'fast']) {
   const resized=decode(await image(input).resize(31,19).webp({speed}).bytes());
   assert.deepEqual([resized.width,resized.height],[31,19]);
  }
 }
});
test('4K JPEG avoids full source pixels in both speed settings',async()=>{
 const input=await fixture('input-4k.jpg');
 for(const scaled of [false,true]) {
  const result=scan(input,800,450,scaled,false);
  assert.equal(result.codec_buffered,false);
  assert.ok(result.peak_row_bytes<1024*1024,`row estimate ${result.peak_row_bytes}`);
  assert.deepEqual([result.output_width,result.output_height],[800,450]);
  if(scaled) assert.ok(result.decoded_width<result.source_width);
  else assert.equal(result.decoded_width,result.source_width);
  assert.equal(decode(result.take_bytes()).width,800);
 }
});
test('tiled HEIC grid decodes incrementally within a small WASM memory budget',async()=>{
 const input=await fixture('grid-12mp-512px-tiles.heic');
 const result=scanline_experiment(input,800,600,false,false,80,false,16_000_000,false,-1,false);
 assert.equal(result.codec_buffered,false);
 assert.deepEqual([result.source_width,result.source_height],[4032,3024]);
 assert.deepEqual([result.output_width,result.output_height],[800,600]);
 const output=decode(result.take_bytes());assert.deepEqual([output.width,output.height],[800,600]);
 assert.ok(linear_memory_bytes()<=32*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 32 MiB`);
});
test('24MP progressive JPEG converts through reduced coefficient decoding',async()=>{
 const input=await fixture('input-24mp-progressive.jpg');
 const webp=await image(input).resize(800).webp({speed:'fast'}).bytes();
 const jpeg=await image(input).resize(800).jpeg({speed:'fast'}).bytes();
 const defaultSpeed=await image(input).resize(800).webp().bytes();
 assert.ok(webp.byteLength>0); assert.ok(jpeg.byteLength>0); assert.ok(defaultSpeed.byteLength>0);
 const memory=linear_memory_bytes();
 assert.ok(memory<=48*1024*1024,`WASM linear memory ${memory} exceeds 48 MiB`);
});
test('32MP progressive JPEG converts at reduced scale within a small WASM memory budget',async()=>{
 const input=await fixture('input-32mp-progressive.jpg');
 const result=scanline_experiment(input,800,0,false,false,80,false,8_000_000,true,-1,false);
 assert.equal(result.codec_buffered,true);
 assert.deepEqual([result.source_width,result.source_height],[8000,4000]);
 assert.deepEqual([result.decoded_width,result.decoded_height],[1000,500]);
 assert.deepEqual([result.output_width,result.output_height],[800,400]);
 const output=decode(result.take_bytes());assert.deepEqual([output.width,output.height],[800,400]);
 assert.ok(linear_memory_bytes()<=48*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 48 MiB`);
});
test('extreme aspect ratios keep the row window bounded',()=>{
 for(const [sw,sh,ow,oh] of [[1,16000,16000,1],[16000,1,1,16000],[31,127,127,1],[31,1,1,127]]) {
  const result=scan(rgbaPng(sw,sh,color),ow,oh);
  assert.ok(result.peak_row_bytes<5*1024*1024);
  const out=decode(result.take_bytes());assert.deepEqual([out.width,out.height],[ow,oh]);
 }
});
test('JPEG output encodes scanlines at both speeds and composites alpha onto white',async()=>{
 const transparent=rgbaPng(32,24,()=>[255,0,0,0]);
 for(const speed of [undefined,'fast']) {
  const result=decode(await image(png).resize(31,19).jpeg({quality:85,speed}).bytes());
  assert.deepEqual([result.width,result.height,result.format,result.progressive],[31,19,'JPEG',false]);
  const white=decode(await image(transparent).resize(16).jpeg({quality:100,speed}).bytes());
  assert.ok(white.pixels.every(v=>v===255));
 }
 const pipeline=image(png).resize(16);
 assert.equal((await pipeline.jpeg().blob()).type,'image/jpeg');
 assert.equal((await pipeline.webp().blob()).type,'image/webp');
 assert.throws(()=>pipeline.jpeg({quality:NaN}),/quality/);
 assert.throws(()=>pipeline.jpeg({speed:'slow'}),/speed/);
});
test('workspace adapter supports JPEG output and reports its content type',async()=>{
 const files=new Map([['/input.png',png]]);
 const ws={fs:{async readFile(p){return files.get(p)},async writeFile(p,b){files.set(p,b)}}};
 const result=await optimizeWorkspaceImage(ws,'/input.png','/output.jpg',{width:31,format:'jpeg'});
 assert.equal(result.contentType,'image/jpeg');assert.equal(decode(files.get('/output.jpg')).width,31);
 await assert.rejects(optimizeWorkspaceImage(ws,'/input.png','/output.avif',{format:'avif'}),/format/);
});
test('truncated JPEGs and PNGs fail cleanly, including after rows have already been processed',async()=>{
 const jpeg=await fixture('rows-baseline.jpg');
 for(const input of [jpeg.subarray(0,jpeg.length-10),png.subarray(0,png.length-20),new Uint8Array([0xff,0xd8,1,2])]) {
  for(const format of ['webp','jpeg']) await assert.rejects(image(input).resize(16)[format]().bytes(),/decode failed/);
 }
 await assert.rejects(image(png,{maxPixels:10}).resize(20).bytes(),/limit/);
 // A source header above the new 48MP ceiling must fail before pixel allocation.
 const oversized=Buffer.from(png);oversized.writeUInt32BE(8001,16);oversized.writeUInt32BE(6000,20);oversized.writeUInt32BE(crc32(oversized.subarray(12,29)),29);
 await assert.rejects(image(oversized).resize(16).bytes(),/limit/);
 const tooWide=Buffer.from(png);tooWide.writeUInt32BE(16384,16);tooWide.writeUInt32BE(1,20);tooWide.writeUInt32BE(crc32(tooWide.subarray(12,29)),29);
 await assert.rejects(image(tooWide).resize(16).bytes(),/decode failed|limit/);
 assert.equal(decode(await image(png).resize(16).bytes()).width,16);
});

test('16-bit grayscale and palette transparency retain PNG decoder compatibility',async()=>{
 for(const kind of ['gray16','palette']) {
  const input=specialPng(kind),expected=kind==='gray16'?{pixels:Buffer.from([0,0,0,255,128,128,128,255,255,255,255,255,0,0,0,255,128,128,128,255,255,255,255,255])}:decode(input),actual=decode(await image(input).webp({lossless:true}).bytes());
  for(let i=0;i<actual.pixels.length;i+=4) {
   assert.equal(actual.pixels[i+3],expected.pixels[i+3]);
   if(actual.pixels[i+3]>0) for(let c=0;c<3;c++) assert.ok(Math.abs(actual.pixels[i+c]-expected.pixels[i+c])<=1);
  }
  assert.equal(decode(await image(input).resize(6).bytes()).width,6);
 }
});
