// Run after starting npm run dev. Uses real Computer SQLite storage via workerd.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const base = process.env.WORKER_URL ?? 'http://127.0.0.1:8787';
const input = await readFile(new URL('./fixtures/rgba.png',import.meta.url));
async function request(path, init) {
 const response = await fetch(base+path,init);
 if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
 return response;
}
const direct = await request('/optimize?width=8',{method:'POST',body:input});
assert.equal(direct.headers.get('content-type'),'image/webp');
await direct.arrayBuffer();
const fast = await request('/optimize?width=8&speed=fast',{method:'POST',body:input});
const fastBytes = new Uint8Array(await fast.arrayBuffer());
await request('/workspaces/integration/files/input.png',{method:'PUT',body:input});
const result = await request('/workspaces/integration/optimize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:'/input.png',output:'/output.webp',width:8,speed:'fast'})});
assert.equal((await result.json()).path,'/output.webp');
const stored = new Uint8Array(await (await request('/workspaces/integration/files/output.webp')).arrayBuffer());
assert.deepEqual(stored,fastBytes);
const checked = spawnSync('python3',['test/decode-webp.py'],{input:stored});
assert.equal(checked.status,0,checked.stderr.toString());
assert.deepEqual([JSON.parse(checked.stdout).width,JSON.parse(checked.stdout).height],[8,4]);
const invalid = await fetch(base+'/optimize',{method:'POST',body:'invalid image'});
assert.equal(invalid.status,400);
const invalidSpeed = await fetch(base+'/optimize?speed=slow',{method:'POST',body:input});
assert.equal(invalidSpeed.status,400);
console.log('PASS: default and fast-speed Worker conversion, Computer upload → optimize → download, independent WebP decode, invalid input/options');
