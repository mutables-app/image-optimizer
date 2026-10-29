// Measure peak process RSS and WASM linear-memory capacity on the 24MP
// progressive-JPEG fixture. RSS is a process high-water mark; the WASM value
// is linear-memory capacity, not live allocations.
import { readFile } from 'node:fs/promises';
import { image } from '../packages/optimizer/node.js';
import { linear_memory_bytes } from '../packages/optimizer/dist/optimizer.node.js';

const input = await readFile('test/fixtures/input-24mp-progressive.jpg');
const results = [];
for (const format of ['webp', 'jpeg']) {
  const pipeline = image(input).resize(800);
  const output = format === 'webp'
    ? await pipeline.webp({ speed: 'fast' }).bytes()
    : await pipeline.jpeg({ speed: 'fast' }).bytes();
  results.push({
    format,
    inputBytes: input.byteLength,
    inputPixels: 24_000_000,
    outputBytes: output.byteLength,
    wasmLinearMemoryCapacityBytes: linear_memory_bytes(),
    processPeakRssKiB: process.resourceUsage().maxRSS,
  });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
