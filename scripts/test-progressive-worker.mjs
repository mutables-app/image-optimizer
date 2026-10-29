// Send the 24MP progressive JPEG to the authenticated experiments Worker.
// Set EXPERIMENTS_WORKER_URL; the existing ignored benchmark secret is used
// unless BENCHMARK_TOKEN is supplied in the environment.
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const endpoint = process.env.EXPERIMENTS_WORKER_URL;
if (!endpoint) throw new Error('Set EXPERIMENTS_WORKER_URL to your test Worker');
const token = process.env.BENCHMARK_TOKEN ?? JSON.parse(await readFile('.build/benchmark-secrets.json', 'utf8')).BENCHMARK_TOKEN;
const fixturePath = process.env.PROGRESSIVE_FIXTURE ?? 'test/fixtures/input-24mp-progressive.jpg';
const sourceWidth = Number(process.env.PROGRESSIVE_WIDTH ?? 6000);
const sourceHeight = Number(process.env.PROGRESSIVE_HEIGHT ?? 4000);
const sourcePixels = sourceWidth * sourceHeight;
const input = await readFile(fixturePath);
const results = [];
const cases = (process.env.PROGRESSIVE_CASES ?? 'webp:default,webp:fast,jpeg:default,jpeg:fast').split(',').map(value => value.split(':'));
for (const [format, speed] of cases) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    width: 800,
    height: 800,
    quality: 80,
    pipeline: format === 'jpeg' ? 'jpeg' : 'scanlines',
    scaled: speed === 'fast',
    method: speed === 'fast' ? 1 : 4,
    image: fixturePath.split('/').at(-1),
    variant: 'progressive-24mp-memory',
    phase: speed,
  })) url.searchParams.set(key, String(value));
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: input,
    signal: AbortSignal.timeout(60_000),
  });
  const output = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${format}/${speed}: ${response.status} ${output.toString().slice(0, 300)}`);
  const decoded = spawnSync('python3', ['test/decode-image.py'], { input: output, maxBuffer: 64 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
  const image = JSON.parse(decoded.stdout);
  const scale = Math.min(800 / sourceWidth, 800 / sourceHeight);
  const expectedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const expectedHeight = Math.max(1, Math.round(sourceHeight * scale));
  if (image.width !== expectedWidth || image.height !== expectedHeight) throw new Error(`${format}/${speed}: unexpected output ${image.width}x${image.height}`);
  results.push({
    format,
    speed,
    status: response.status,
    sourcePixels,
    sourceBytes: input.length,
    outputBytes: output.length,
    outputDimensions: `${image.width}x${image.height}`,
    wasmLinearMemoryCapacityBytes: Number(response.headers.get('x-wasm-linear-memory-bytes')),
    codecBuffered: response.headers.get('x-codec-buffered'),
    colo: response.headers.get('x-worker-colo'),
    roundTripMs: performance.now() - started,
  });
}
const report = { timestamp: new Date().toISOString(), note: 'Successful deployed Worker conversions demonstrate compatibility; WASM linear-memory capacity is high-water capacity, not live allocation or total isolate RSS.', results };
const path = process.env.PROGRESSIVE_OUTPUT_PATH ?? 'benchmarks/scanlines/worker/progressive-memory.json';
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
