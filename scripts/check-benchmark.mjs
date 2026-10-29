import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {BENCHMARK_TOKEN}=JSON.parse(await readFile('.build/benchmark-secrets.json','utf8'));
const base=process.argv[2];
if(!base)throw new Error('Usage: node scripts/check-benchmark.mjs WORKER_URL');
for(const [label,path,auth,status] of [['unauthorized','/',false,401],['invalid image','/',true,400],['invalid dimensions','/?width=0',true,400]]) {
 const r=await fetch(base+path,{method:'POST',headers:auth?{authorization:`Bearer ${BENCHMARK_TOKEN}`}:{},body:'bad'});
 assert.equal(r.status,status,`${label}: ${await r.text()}`);console.log(label,r.status,'PASS');
}
