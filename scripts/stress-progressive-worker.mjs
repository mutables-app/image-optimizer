// Bounded two-request burst using a progressive JPEG on the test Worker.
import { readFile, writeFile } from 'node:fs/promises';

const endpoint = process.env.EXPERIMENTS_WORKER_URL;
if (!endpoint) throw new Error('Set EXPERIMENTS_WORKER_URL to your test Worker');
const token = process.env.BENCHMARK_TOKEN ?? JSON.parse(await readFile('.build/benchmark-secrets.json', 'utf8')).BENCHMARK_TOKEN;
const fixturePath = process.env.PROGRESSIVE_FIXTURE ?? 'test/fixtures/input-24mp-progressive.jpg';
const sourceWidth = Number(process.env.PROGRESSIVE_WIDTH ?? 6000);
const sourceHeight = Number(process.env.PROGRESSIVE_HEIGHT ?? 4000);
const sourcePixels = sourceWidth * sourceHeight;
const input = await readFile(fixturePath);
function webpDimensions(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Output is not RIFF/WebP');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (kind === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
    }
    if (kind === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1], b2 = bytes[data + 2], b3 = bytes[data + 3], b4 = bytes[data + 4];
      return [1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))];
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error('WebP output has no recognized VP8 frame');
}
const started = performance.now();
const results = await Promise.all([0, 1].map(async index => {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({ width: 800, height: 800, quality: 80, pipeline: 'scanlines', scaled: true, method: 1, image: fixturePath.split('/').at(-1), variant: `progressive-${sourcePixels / 1_000_000}mp-concurrent`, phase: 'burst', index })) url.searchParams.set(key, String(value));
  const requestStarted = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: input, signal: AbortSignal.timeout(60_000) });
  const output = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`Request ${index} returned ${response.status}: ${output.toString().slice(0, 300)}`);
  const [outputWidth, outputHeight] = webpDimensions(output);
  const scale = Math.min(800 / sourceWidth, 800 / sourceHeight);
  const expectedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const expectedHeight = Math.max(1, Math.round(sourceHeight * scale));
  if (outputWidth !== expectedWidth || outputHeight !== expectedHeight) throw new Error(`Request ${index} produced ${outputWidth}x${outputHeight}`);
  return {
    index,
    status: response.status,
    outputBytes: output.length,
    outputDimensions: `${outputWidth}x${outputHeight}`,
    wasmLinearMemoryCapacityBytes: Number(response.headers.get('x-wasm-linear-memory-bytes')),
    colo: response.headers.get('x-worker-colo'),
    isolateMarker: response.headers.get('x-worker-isolate-marker'),
    roundTripMs: performance.now() - requestStarted,
  };
}));
const report = {
  timestamp: new Date().toISOString(),
  concurrency: 2,
  inputPixels: sourcePixels,
  inputBytes: input.length,
  totalRoundTripMs: performance.now() - started,
  sharedIsolate: results.every(result => result.isolateMarker === results[0].isolateMarker),
  note: 'Two independent outputs passed RIFF/WebP signature and frame-dimension checks. Equal isolate markers prove the pair shared an isolate; different markers prove they did not.',
  results,
};
const outputPath = process.env.PROGRESSIVE_OUTPUT_PATH ?? 'benchmarks/scanlines/worker/progressive-concurrency.json';
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
