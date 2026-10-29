import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {experiment,optimize} from '../packages/optimizer/dist/optimizer.node.js';
const png=await readFile(new URL('./fixtures/rgba.png',import.meta.url));
const jpeg=await readFile(new URL('../benchmarks/photo-1920.jpg',import.meta.url));
const args=(bytes,w=320,h=320)=>[bytes,w,h,true,true,80,false,8_000_000];
test('experimental default and explicit method 4 preserve existing output',()=>{
 const parameters=args(png,16,16);
 assert.deepEqual(experiment(...parameters,false,-1,false).take_bytes(),optimize(...parameters,-1,false));
 assert.deepEqual(experiment(...parameters,false,4,false).take_bytes(),optimize(...parameters,-1,false));
});
test('scaled JPEG keeps exact target geometry and reduces the decoded buffer',()=>{
 const result=experiment(...args(jpeg),true,4,true);
 assert.deepEqual([result.output_width,result.output_height],[213,320]);
 assert.ok(result.decoded_width>=213&&result.decoded_height>=320);
 assert.ok(result.decoded_width<1920&&result.decoded_height<2880);
 const timing=Array.from(result.stages_ms());assert.equal(timing.length,5);assert.ok(timing[0]>0);assert.ok(timing[3]>0);
 assert.ok(result.take_bytes().length>0);
});
test('scaled JPEG handles width-only, stretch, and original pixel limits',()=>{
 let result=experiment(jpeg,320,0,true,true,80,false,8_000_000,true,0,false);
 assert.deepEqual([result.output_width,result.output_height],[320,480]);result.free();
 result=experiment(jpeg,320,100,false,true,80,false,8_000_000,true,2,false);
 assert.deepEqual([result.output_width,result.output_height],[320,100]);result.free();
 assert.throws(()=>experiment(jpeg,32,32,true,true,80,false,100,true,4,false),/limit/);
 assert.throws(()=>experiment(...args(png),false,7,false),/method/);
});
test('scaled flag does not change PNGs or full-size JPEG output',()=>{
 assert.deepEqual(experiment(...args(png,16,16),true,4,false).take_bytes(),optimize(...args(png,16,16),-1,false));
 assert.deepEqual(experiment(...args(jpeg,0,0),true,4,false).take_bytes(),optimize(...args(jpeg,0,0),-1,false));
});
