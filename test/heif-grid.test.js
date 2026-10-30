import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {scanline_experiment,linear_memory_bytes} from '../packages/optimizer/dist/optimizer.node.js';
const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
function decode(bytes) {
 const p=spawnSync('python3',['test/decode-image.py'],{input:bytes,maxBuffer:64*1024*1024});
 assert.equal(p.status,0,p.stderr.toString());return JSON.parse(p.stdout);
}
test('48MP tiled HEIC decodes tile rows within the 100 MiB memory target',async()=>{
 const input=await fixture('input-48mp-grid.heic');
 const result=scanline_experiment(input,2828,2828,false,false,80,false,8_000_000,false,-1,false);
 assert.equal(result.codec_buffered,false);
 assert.deepEqual([result.source_width,result.source_height],[8000,6000]);
 assert.deepEqual([result.output_width,result.output_height],[2828,2828]);
 const output=decode(result.take_bytes());assert.deepEqual([output.width,output.height],[2828,2828]);
 assert.ok(linear_memory_bytes()<=100*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 100 MiB`);
 const overLimit=await fixture('input-64mp-grid.heic');
 assert.throws(()=>scanline_experiment(overLimit,800,0,false,false,80,false,8_000_000,false,-1,false),/limit/i);
});

test('48MP tiled AVIF decodes tile rows within a 64 MiB WASM budget',async()=>{
 const input=await fixture('input-48mp-grid.avif');
 const result=scanline_experiment(input,800,600,false,false,80,false,8_000_000,true,1,false);
 assert.equal(result.codec_buffered,false);
 assert.deepEqual([result.source_width,result.source_height],[8000,6000]);
 assert.deepEqual([result.output_width,result.output_height],[800,600]);
 const output=decode(result.take_bytes());assert.deepEqual([output.format,output.width,output.height],['WEBP',800,600]);
 assert.ok(linear_memory_bytes()<=64*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 64 MiB`);
});
