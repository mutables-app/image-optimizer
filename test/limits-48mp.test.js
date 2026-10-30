import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {image} from '@mutables.app/image-optimizer';
import {scanline_experiment,linear_memory_bytes} from '../packages/optimizer/dist/optimizer.node.js';
import {rgbaPng} from './helpers/png.js';

const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
function decode(bytes) {
 const p=spawnSync('python3',['test/decode-image.py'],{input:bytes,maxBuffer:64*1024*1024});
 assert.equal(p.status,0,p.stderr.toString());return JSON.parse(p.stdout);
}

test('48MP baseline JPEG and non-interlaced PNG stay within the 100 MiB target',async()=>{
 for(const name of ['input-48mp-baseline.jpg','input-48mp-streaming.png']) {
  const input=await fixture(name);
  const result=scanline_experiment(input,2828,2828,false,false,80,false,8_000_000,false,-1,false);
  assert.equal(result.codec_buffered,false,`${name} unexpectedly buffers the codec`);
  assert.deepEqual([result.source_width,result.source_height],[8000,6000]);
  assert.deepEqual([result.output_width,result.output_height],[2828,2828]);
  assert.ok(result.take_bytes().length>0);
  assert.ok(linear_memory_bytes()<=100*1024*1024,`${name}: WASM linear memory ${linear_memory_bytes()} exceeds 100 MiB`);
 }
});

test('48MP lowzag-compatible progressive JPEG converts at the 8MP output ceiling',async()=>{
 const input=await fixture('input-48mp-progressive.jpg');
 const result=scanline_experiment(input,1200,1200,false,false,80,false,1_440_000,true,-1,false);
 assert.equal(result.codec_buffered,true);
 assert.deepEqual([result.source_width,result.source_height],[8000,6000]);
 assert.deepEqual([result.output_width,result.output_height],[1200,1200]);
 assert.ok(result.take_bytes().length>0);
 for(const format of ['webp','jpeg']) {
  const bytes=await image(input).resize(800)[format]({speed:'fast'}).bytes();
  assert.deepEqual([decode(bytes).width,decode(bytes).height],[800,600]);
 }
 assert.ok(linear_memory_bytes()<=100*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 100 MiB`);
 const overLimit=await fixture('input-64mp-progressive.jpg');
 assert.throws(()=>scanline_experiment(overLimit,800,800,false,false,80,false,8_000_000,true,-1,false),/limit/i);
});

test('Adam7 PNG is rejected explicitly before decode',async()=>{
 const input=rgbaPng(97,65,(x,y)=>[x%256,y%256,128,255],true);
 assert.throws(()=>scanline_experiment(input,800,600,false,false,80,false,8_000_000,false,-1,false),/Interlaced PNG input is not supported/);
});
