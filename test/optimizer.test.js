import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {image} from '@mutables.app/image-optimizer';
import {optimizeWorkspaceImage} from '@mutables.app/image-computer';
const png = await readFile(new URL('./fixtures/rgba.png', import.meta.url));
const jpeg = await readFile(new URL('./fixtures/input.jpg', import.meta.url));
const jpeg4k = await readFile(new URL('./fixtures/input-4k.jpg', import.meta.url));
function decode(bytes) {
 const p = spawnSync('python3', ['test/decode-webp.py'], {input: bytes});
 assert.equal(p.status, 0, p.stderr.toString()); return JSON.parse(p.stdout);
}
test('PNG → lossless WebP preserves dimensions and alpha', async () => {
 const out = decode(await image(png).webp({lossless:true}).bytes());
 assert.equal(out.width,32); assert.equal(out.height,16);
 assert.deepEqual(out.alpha, [...Array(8).fill(0),...Array(8).fill(128),...Array(16).fill(255)]);
});
test('JPEG → fit inside → lossy WebP', async () => {
 const out = decode(await image(jpeg).resize(40,40,{fit:'inside'}).webp({quality:75}).bytes());
 assert.ok(out.width <= 40 && out.height <= 40); assert.ok(out.width === 40 || out.height === 40);
});
test('fast speed selects the internal fast encoder while omission keeps the existing default', async () => {
 const pipeline = () => image(jpeg).resize(40,40,{fit:'inside'});
 const defaultBytes = await pipeline().webp({quality:75}).bytes();
 const fastBytes = await pipeline().webp({quality:75,speed:'fast'}).bytes();
 assert.notDeepEqual(fastBytes,defaultBytes);
 const fast = decode(fastBytes);
 assert.ok(fast.width <= 40 && fast.height <= 40);
 assert.throws(()=>pipeline().webp({speed:'slow'}),/speed/);
 assert.throws(()=>pipeline().webp({method:1}),/method/);
});
test('scanlines resize a 4K JPEG above the default output pixel cap at either speed', async () => {
 const normal = decode(await image(jpeg4k).resize(800).webp().bytes());
 assert.deepEqual([normal.width,normal.height],[800,450]);
 await assert.rejects(image(jpeg4k).webp().bytes(), /pixel or dimension limit/);
 const out = decode(await image(jpeg4k).resize(800).webp({speed:'fast'}).bytes());
 assert.deepEqual([out.width,out.height],[800,450]);
});
test('width-only, fill, and withoutEnlargement', async () => {
 let out = decode(await image(png).resize(8).bytes()); assert.deepEqual([out.width,out.height],[8,4]);
 out = decode(await image(png).resize(10,10).bytes()); assert.deepEqual([out.width,out.height],[10,10]);
 out = decode(await image(png).resize(100,100,{fit:'inside',withoutEnlargement:true}).bytes()); assert.deepEqual([out.width,out.height],[32,16]);
});
test('invalid and oversized images reject; subsequent conversion still works', async () => {
 await assert.rejects(image(new Uint8Array([1,2,3])).bytes(), /Expected JPEG or PNG/);
 await assert.rejects(image(png.subarray(0,40)).bytes(), /decode failed/);
 await assert.rejects(image(png,{maxPixels:10}).bytes(), /limit/);
 assert.throws(()=>image(png).resize(0), /Dimensions/);
 assert.throws(()=>image(png).webp({quality:101}), /quality/);
 assert.equal(decode(await image(png).bytes()).width,32);
});
test('Blob output and snapshot input', async () => {
 const input = Uint8Array.from(png); const pipeline = image(input); input.fill(0);
 const blob = await pipeline.blob(); assert.equal(blob.type,'image/webp'); assert.ok(blob.size>0);
});
test('workspace adapter reads a stream and writes optimized bytes', async () => {
 const files = new Map([['/input.png',png]]);
 const ws = {fs:{async readFile(path){return new Blob([files.get(path)]).stream();},async writeFile(path,bytes){files.set(path,bytes);}}};
 const result = await optimizeWorkspaceImage(ws,'/input.png','/output.webp',{width:8,speed:'fast'});
 assert.equal(result.bytes,files.get('/output.webp').length);
 assert.equal(decode(files.get('/output.webp')).width,8);
 await assert.rejects(optimizeWorkspaceImage(ws,'/input.png','/input.png'),/must differ/);
});
