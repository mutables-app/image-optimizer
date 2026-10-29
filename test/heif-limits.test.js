import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {image} from '@mutables.app/image-optimizer';
import {scanline_experiment,linear_memory_bytes} from '../packages/optimizer/dist/optimizer.node.js';
const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
function decode(bytes) {
 const p=spawnSync('python3',['test/decode-image.py'],{input:bytes,maxBuffer:64*1024*1024});
 assert.equal(p.status,0,p.stderr.toString());return JSON.parse(p.stdout);
}
test('8MP non-grid HEIC decodes and resizes as a full source image',async()=>{
 const input=await fixture('input-8mp-single.heic');
 const result=scanline_experiment(input,800,0,false,false,80,false,8_000_000,false,-1,false);
 assert.equal(result.codec_buffered,true);
 assert.deepEqual([result.source_width,result.source_height],[4000,2000]);
 assert.deepEqual([result.output_width,result.output_height],[800,400]);
 const webp=decode(result.take_bytes());assert.deepEqual([webp.format,webp.width,webp.height],['WEBP',800,400]);
 const jpeg=decode(await image(input).resize(800).jpeg({speed:'fast'}).bytes());
 assert.deepEqual([jpeg.format,jpeg.width,jpeg.height],['JPEG',800,400]);
 assert.ok(linear_memory_bytes()<=128*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 128 MiB`);
});
test('16MP and 24MP non-grid HEIC remain above the single-image source limit',async()=>{
 for(const name of ['input-16mp-single.heic','input-24mp-single.heic']) {
  const input=await fixture(name);
  await assert.rejects(image(input).resize(800).webp().bytes(),/pixel or dimension limit/);
 }
});
