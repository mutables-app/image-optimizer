import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scanline_experiment,linear_memory_bytes} from '../packages/optimizer/dist/optimizer.node.js';

const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));

test('12MP CMYK progressive JPEG uses reduced coefficient decoding',async()=>{
 const input=await fixture('input-12mp-cmyk-progressive.jpg');
 // scaled=false makes the fallback decode all 12 MP. A 1000x750 decoded
 // surface proves Lowzag's reduced-coefficient path handled this 800x600 resize.
 const result=scanline_experiment(input,800,0,false,false,80,false,8_000_000,false,-1,false);
 assert.equal(result.codec_buffered,true);
 assert.deepEqual([result.source_width,result.source_height],[4000,3000]);
 assert.deepEqual([result.decoded_width,result.decoded_height],[1000,750]);
 assert.deepEqual([result.output_width,result.output_height],[800,600]);
 assert.ok(result.take_bytes().length>0);
 assert.ok(linear_memory_bytes()<=64*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 64 MiB`);
});

test('12MP YCCK progressive JPEG uses the buffered compatibility path',async()=>{
 const input=await fixture('input-12mp-ycck-progressive.jpg');
 const result=scanline_experiment(input,800,0,false,false,80,false,8_000_000,true,-1,false);
 assert.equal(result.codec_buffered,true);
 assert.deepEqual([result.source_width,result.source_height],[4000,3000]);
 assert.deepEqual([result.decoded_width,result.decoded_height],[1000,750]);
 assert.deepEqual([result.output_width,result.output_height],[800,600]);
 assert.ok(result.take_bytes().length>0);
 assert.ok(linear_memory_bytes()<=80*1024*1024,`WASM linear memory ${linear_memory_bytes()} exceeds 80 MiB`);
});

test('CMYK progressive JPEG above its 12MP limit is rejected before coefficient allocation',async()=>{
 const input=await fixture('input-48mp-cmyk-progressive.jpg');
 assert.throws(()=>scanline_experiment(input,800,0,false,false,80,false,8_000_000,false,-1,false),/limit/i);
});
