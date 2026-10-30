import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const { BENCHMARK_TOKEN } = JSON.parse(await readFile('.build/benchmark-secrets.json', 'utf8'));
const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname;
const node = process.execPath;
const workerConfig = new URL('../examples/experiments/.wrangler-memory-benchmark.jsonc', import.meta.url).pathname;
const baseConfigPath = new URL('../examples/experiments/wrangler.jsonc', import.meta.url);
const workerConfigObject = JSON.parse(await readFile(baseConfigPath, 'utf8'));
workerConfigObject.limits = { ...workerConfigObject.limits, cpu_ms: 30000 };
await writeFile(workerConfig, `${JSON.stringify(workerConfigObject, null, 2)}\n`);
const allCases = [
  { label: 'Baseline JPEG', file: 'input-48mp-baseline.jpg' },
  { label: 'Non-interlaced PNG', file: 'input-48mp-streaming.png' },
  { label: 'Lowzag progressive JPEG', file: 'input-48mp-progressive.jpg' },
  { label: 'CMYK progressive JPEG', file: 'input-12mp-cmyk-progressive.jpg' },
  { label: 'YCCK progressive JPEG', file: 'input-12mp-ycck-progressive.jpg' },
  { label: 'CMYK progressive JPEG over limit', file: 'input-48mp-cmyk-progressive.jpg' },
  { label: 'Adam7 PNG', file: 'adam7-48mp.png' },
  { label: 'Single-image HEIC', file: 'input-12mp-single.heic' },
  { label: 'Single-image AVIF', file: 'input-12mp-single.avif' },
  { label: 'Tiled HEIC', file: 'input-48mp-grid.heic' },
  { label: 'Tiled/grid AVIF', file: 'input-48mp-grid.avif' },
  { label: 'Other progressive/multi-scan JPEG (arithmetic-coded)', file: 'input-12mp-arithmetic-progressive.jpg' },
  { label: '64MP HEIC grid over limit', file: 'input-64mp-grid.heic' },
  { label: '64MP progressive JPEG over limit', file: 'input-64mp-progressive.jpg' },
];
const selectedFixtures = process.env.BENCHMARK_FIXTURES?.split(',');
const cases = selectedFixtures ? allCases.filter(item => selectedFixtures.includes(item.file)) : allCases;
const results = [];
const createdWorkers = [];
try {
  for (const [index, item] of cases.entries()) {
    if (!item.file) {
      results.push(item);
      continue;
    }
    const input = await readFile(`test/fixtures/${item.file}`);
    const workerName = `image-opt-bench-${index}-${randomUUID().slice(0, 8)}`;
    const endpoint = `https://${workerName}.ted3.workers.dev/`;
    const runWrangler = (args, options = {}) => execFileSync(node, [wrangler, ...args], {
      cwd: new URL('../examples/experiments/', import.meta.url),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    runWrangler(['deploy', '--config', workerConfig, '--name', workerName]);
    createdWorkers.push(workerName);
    runWrangler(['secret', 'put', 'BENCHMARK_TOKEN', '--config', workerConfig, '--name', workerName], { input: `${BENCHMARK_TOKEN}\n` });
    await new Promise(resolve => setTimeout(resolve, 1500));
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries({ width: 800, height: 600, quality: 80, scaled: true, method: 1, pipeline: 'scanlines', variant: 'readme-max-limit-benchmark', phase: 'single', image: item.file })) {
      url.searchParams.set(key, String(value));
    }
    const start = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${BENCHMARK_TOKEN}` },
      body: input,
      signal: AbortSignal.timeout(90000),
    });
    const output = new Uint8Array(await response.arrayBuffer());
    const result = {
      ...item,
      inputBytes: input.length,
      status: response.status,
      ok: response.ok,
      roundTripMs: Math.round(performance.now() - start),
      outputBytes: response.ok ? output.length : null,
      wasmMemoryBytes: response.headers.get('x-wasm-linear-memory-bytes'),
      decoded: response.headers.get('x-decoded-dimensions'),
      output: response.headers.get('x-output-dimensions'),
      codecBuffered: response.headers.get('x-codec-buffered'),
      colo: response.headers.get('x-worker-colo'),
      error: response.ok ? null : new TextDecoder().decode(output).slice(0, 1500),
    };
    results.push(result);
    console.log(JSON.stringify(result));
    runWrangler(['delete', '--config', workerConfig, '--name', workerName, '--force']);
    createdWorkers.pop();
  }
} finally {
  for (const workerName of createdWorkers.reverse()) {
    try {
      execFileSync(node, [wrangler, 'delete', '--config', workerConfig, '--name', workerName, '--force'], { stdio: 'ignore' });
    } catch (error) {
      console.error(`Could not delete temporary benchmark Worker ${workerName}: ${error.message}`);
    }
  }
  await rm(workerConfig, { force: true });
}
const report = {
  timestamp: new Date().toISOString(),
  worker: 'Temporary per-case Workers, deleted after each measurement.',
  measurement: 'x-wasm-linear-memory-bytes reports Wasm linear-memory capacity, not Worker isolate RSS; one request in a fresh isolate per case, 800x600 WebP output; fixtures are synthetic. Temporary benchmark Workers used a 30,000 ms CPU ceiling; this measures memory capacity and does not imply the default 1,000 ms experiment Worker can complete every case.',
  results,
};
const reportPath = process.env.BENCHMARK_OUTPUT ?? 'benchmarks/decoder-memory-worker.json';
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
