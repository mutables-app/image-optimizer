# Scanline validation and benchmarks

Measurements for v0.2.0, 2026-10-29. These changes are not present in v0.1.0.

The scanline path applies in both speed modes. Baseline JPEG and non-interlaced PNG are decoded sequentially, then resized with premultiplied-alpha Lanczos3 using SIMD128. JPEG output is encoded directly from resized rows. WebP retains a complete resized RGBA destination. Compressed input and encoded output remain buffered by the API.

Progressive/multi-scan JPEG requires codec coefficient storage. Adam7 PNG uses a bounded complete-image decode for compatibility. The 16MP source ceiling remains in force; `maxPixels` now bounds output pixels independently (8MP default).

## Correctness and integration

- 23 Node tests pass, including downscaling, enlargement, nonuniform resizing, extreme aspect ratios, transparent edges, 16-bit grayscale PNG, palette transparency, Adam7, baseline/progressive/grayscale/CMYK JPEG, truncated files, source/output limits and recovery after errors.
- Independent native decoding verifies dimensions, alpha handling, JPEG white compositing and comparisons against the old full-buffer resizer. Resized bytes can change because float convolution and intermediate rounding differ from the old fixed-point path.
- Local workerd integration passes for direct WebP/JPEG conversion and Computer upload → conversion → download. Both speed settings accept a 4K JPEG resized below the output cap. Worker bundling passes; the Wasm file is approximately 1.8 MiB.

## Local A/B

See [raw measurements](local/results.json) and [pixel/size comparisons](local/comparison.json).

Five inputs: three photos, a generated 3840×2160 JPEG and a synthetic 1920px PNG. Three targets (320, 800, 1600), both speed settings, reference WebP, scanline WebP and scanline JPEG: 90 configurations. Each uses a fresh Node 24 ARM64 process, one warmup and five measured transformations. Reference and scanline WebP match quality, decoder scaling and WebP effort settings.

| Across 15 image/size cases per mode | Default | Fast |
| --- | ---: | ---: |
| Median change in local process CPU | +4.1% | +11.6% |
| Median change in high-water WASM capacity | −61.1% | 0.0% |

The generated 4K → 800×450 default case changed from 81 MiB to 16 MiB high-water WASM capacity, with approximately +1.2% local CPU. Its fast case stayed at 16 MiB and used approximately +9.7% CPU. The row-storage estimates were 182,400 and 124,800 bytes respectively, excluding all codec, filter-coefficient and input/output storage.

**WASM capacity is not live allocation size or total Worker memory.** Linear memory grows in pages and does not shrink, so fresh processes are necessary for useful comparisons. Local process CPU also includes runtime activity and does not substitute for Cloudflare CPU.

All 60 WebP A/B outputs independently decode with matching dimensions. The lowest decoded RGB PSNR relative to the reference output was 37.17 dB (default) and 37.83 dB (fast). These compare two encoded outputs, not ground truth or perceptual equivalence. They do not establish which resizer looks better.

## Deployed A/B

See [request results](worker/results.json), [request summary](worker/summary.json), [sanitized CPU events](worker/cpu-events.json) and [CPU summary](worker/cpu-summary.json).

Both pipelines ran on the same authenticated account-owned experiments Worker with unchanged 1000ms CPU configuration. Five inputs × two sizes (800, 1600) × two speed settings × two pipelines. For each image/size/speed, one warmup per pipeline was followed by eight measured rounds, alternating pipeline order.

**360/360 successful responses**, including 320 measured requests and 40 warmups. All 40 saved image/size/speed/pipeline outputs independently decode. Trace CPU samples are missing or uneven in some groups; use each group's recorded sample count. Small-sample p95 is descriptive only.

Across ten paired image/size comparisons, the median of per-case median-CPU changes was approximately **+14.9% default** and **+19.5% fast**. For 4K → 800px, sampled median CPU was 339.5 → 396ms in default mode and 106.5 → 124ms in fast mode. These are memory improvements with a CPU trade-off, not a speedup claim.

A/B deployment version: `6463989b-eaef-4aae-a881-89c7e95bed87`. Final integration/stress deployment: `1c19e22a-d083-449d-a7a5-995e8c80dc42`. The latter moves PNG decode initialization behind output-limit validation; resizing and codec settings are unchanged. Deployment URLs and credentials are intentionally absent from these reports.

## Concurrent requests and bounded stress

The initial ramp used two input photos (including 4K), both speeds and both outputs at concurrency 1, 2, 4 and 8: **240/240 successful requests**. See [concurrency results](worker/concurrency.json).

The subsequent stress ramp used the 4K JPEG resized to 800×450 at quality 80. Fast WebP, default WebP and default JPEG were each tested with **8, 16, 32 and 64 concurrent incoming requests**, with two waves at every level: **720/720 successful requests**. All successful responses passed format-signature checks; one output per configuration/level was independently decoded with matching dimensions. See [full stress results](worker/stress.json).

At 64 concurrent incoming requests (128 requests per configuration):

| Output | Successes | Median request latency | p95 request latency | Observed completed requests/s |
| --- | ---: | ---: | ---: | ---: |
| WebP, fast | 128/128 | 502ms | 819ms | 73.0 |
| WebP, default | 128/128 | 772ms | 1268ms | 44.0 |
| JPEG, default | 128/128 | 549ms | 922ms | 59.4 |

Latencies and throughput include the client network and uploads. Two waves per level from one client do not establish sustained throughput, global capacity, maximum concurrency or production p95. The Worker deployment can distribute requests across isolates. Processing remains synchronous within each isolate; 64 concurrent incoming requests does not mean 64 simultaneous image computations within one isolate. Cloudflare's [memory limit applies per isolate, including JS and WASM](https://developers.cloudflare.com/workers/platform/limits/#memory), not separately per request.

## Reproduce

Build with the pinned toolchain, install Pillow for native image validation, then run:

```sh
npm test
npm run check:worker
node scripts/benchmark-scanlines.mjs
python3 scripts/summarize-scanlines.py
```

For an authenticated test deployment that you own, set `EXPERIMENTS_WORKER_URL` and `BENCHMARK_TOKEN`. Capture private Wrangler JSON tail output locally, then run:

```sh
node scripts/benchmark-scanlines-worker.mjs
node scripts/benchmark-scanline-concurrency.mjs
node scripts/stress-scanlines-worker.mjs
python3 scripts/summarize-scanlines-worker.py .build/scanline-tail.log benchmarks/scanlines/worker
```

The sanitizer excludes request headers and deployment hostnames. Raw tail logs can contain sensitive request data and belong in the ignored `.build` directory.
