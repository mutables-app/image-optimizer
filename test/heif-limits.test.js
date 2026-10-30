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
test('AVIF input is rejected',async()=>{
 const input=await fixture('input-12mp-single.avif');
 await assert.rejects(image(input).resize(800).webp().bytes(),/Expected JPEG, PNG, WebP or HEIC\/HEIF/);
});
