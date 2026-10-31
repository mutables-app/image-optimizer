import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {image} from '@mutables.app/image-optimizer';
import {scanline_experiment} from '../packages/optimizer/dist/optimizer.node.js';
const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url));
test('single-image HEIC/HEIF is rejected while tiled HEIC/HEIF remains supported',async()=>{
 const input=await fixture('input-12mp-single.heic');
 assert.throws(()=>scanline_experiment(input,800,600,false,false,80,false,8_000_000,false,-1,false),/Non-grid HEIC\/HEIF input is not supported/);
 await assert.rejects(image(input).resize(800).webp().bytes(),/Non-grid HEIC\/HEIF input is not supported/);
 const tiled=await fixture('grid-12mp-512px-tiles.heic');
 assert.ok(scanline_experiment(tiled,800,600,false,false,80,false,8_000_000,false,-1,false).take_bytes().length>0);
});
test('libavif/libgav1 converts 2, 6, and 12 MP still AVIF to WebP and JPEG',async()=>{
 for (const [mp,name] of [[2,'input-2mp.avif'],[6,'input-6mp.avif'],[12,'input-12mp-single.avif']]) {
  const input=await fixture(name);
  const output=await image(input).resize(800).webp().bytes();
  assert.equal(Buffer.from(output.subarray(0,4)).toString(),'RIFF',`${mp} MP WebP signature`);
  assert.equal(Buffer.from(output.subarray(8,12)).toString(),'WEBP');
  const jpeg=await image(input).resize(800).jpeg().bytes();
  assert.equal(jpeg[0],0xff);assert.equal(jpeg[1],0xd8);
 }
 const oversized=await fixture('input-48mp-grid.avif');
 await assert.rejects(image(oversized).resize(800).webp().bytes(),/12 MP source limit/i);
});
