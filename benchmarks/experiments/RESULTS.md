# Optimizer experiments — 29 October 2026

These historical measurements were collected on separate test Workers in the maintainer's Cloudflare account. They are benchmark evidence only: this repository does not deploy, control, or offer those endpoints. Endpoint URLs and account-specific deployment data are omitted from committed artifacts. The fixture was a 1920×2880 JPEG (1,063,708 bytes) and a generated 1920×1080 RGB PNG (5,065,643 bytes). JPEG outputs used aspect-preserving resize, no enlargement, and WebP quality 80. Four requests per case (one initial plus three warm) succeeded; output was validated as WebP and compared against lossless references. The CPU figures below are sampled Cloudflare trace events, not client round-trip time.

## JPEG scaling and encoder effort

In the API3 run, scaled JPEG decode plus WebP method 2 lowered median Worker CPU compared with scaled decode plus method 4:

| Target width | Method 2 CPU / output | Method 4 CPU / output | RGB PSNR (method 2 / 4) |
|---:|---:|---:|---:|
| 320 | 104 ms / 8,722 B | 202 ms / 8,478 B | 33.00 / 33.09 dB |
| 800 | 193 ms / 57,786 B | 299 ms / 57,186 B | 34.35 / 34.54 dB |
| 1600 | 424 ms / 229,456 B | 908 ms / 224,826 B | 35.70 / 35.97 dB |

Method 2 is a strong candidate for a speed-oriented option: it used about 32–53% less CPU in these cases, with 1–2% larger output and a small PSNR reduction. PSNR is a pixel-error metric, not a perceptual quality test. The 1600px method-4 sample was close to the configured 1000 ms CPU ceiling. These results do not establish a new default.

TurboJPEG scaled decoding reduced the JPEG decode dimensions before resize: 240×360 for a 320px bound, 720×1080 for 800px, and 1200×1800 for 1600px, from an original 1920×2880. For example, at 320px, full decode plus method 4 used 317 ms in the only captured CPU event; scaled decode plus method 4 used 202 ms. That full-decode sample count is too small for a strong comparison. The scaled outputs also differed slightly from the full-decode reference.

## Borrowed RGBA buffer

The decoder now exposes its malloc-owned RGBA allocation as a borrowed `fast_image_resize` image and retains an RAII free guard through resize and encode. This removes one extra full-frame RGBA allocation and copy. For the JPEG fixture that copy was 22,118,400 bytes; for the PNG it was 8,294,400 bytes. These are allocation sizes inferred from dimensions, not direct peak-memory measurements. Local stage profiling put the old copy below its millisecond timer resolution, so a CPU win was not expected.

The borrow build passed all 10 package tests, including malformed-image recovery, and all 24 remote requests across six cases succeeded. Its trace CPU samples varied relative to the earlier API3 deployment in both directions (for example PNG 800px method 4 was 231 ms before and 285 ms after). The deployment runs were not interleaved, so isolate the memory benefit from those noisy CPU differences; they do not demonstrate a consistent CPU improvement.

## SIMD audit

The resize stage is explicitly using WASM SIMD128. Rust is built with `-Ctarget-feature=+simd128`; `fast_image_resize` 5.5.0 chooses `CpuExtensions::Simd128` on `wasm32`, and its RGBA convolution dispatches to the crate's `wasm32` implementation. Disassembling the packaged WASM shows SIMD operations, including `v128.load`, `i8x16.shuffle`, and `i32x4.mul`. The final module contains other code too, so the source-level dispatch is what ties the SIMD implementation to the resizer.

The codecs do not all have equivalent hand-written SIMD enabled. libjpeg-turbo is configured with `WITH_SIMD=OFF`; libspng reports that it disabled architecture-specific SIMD for the unknown target; libwebp's CMake cache has `WEBP_ENABLE_SIMD=OFF`. The C codec compilation still receives `-msimd128`, which permits compiler vectorization, but the build does not select libwebp's specialized SIMD source paths. No SIMD-on codec rebuild has been benchmarked.

## Interleaved WebP method comparison

Methods 1–4 were alternated within each round on the same test Worker, using the JPEG fixture, scaled TurboJPEG decode, quality 80, and target bounds of 800px and 1600px. There were 24 successful HTTP samples per method and size across two interleaved passes. Cloudflare's tail stream captured fewer CPU events for the 800px cases, so CPU sample counts there are 15–19; it captured 24 per method at 1600px. CPU percentiles use nearest-rank p95. HTTP round-trip p95 is available in the raw JSON but includes network time and should not be read as Worker CPU.

| Target | Method | Trace CPU n | CPU p50 / p95 | Output bytes | RGB PSNR |
|---:|---:|---:|---:|---:|---:|
| 800 | 1 | 15 | 145 / 235 ms | 62,694 | 34.66 dB |
| 800 | 2 | 16 | 157 / 262 ms | 57,786 | 34.35 dB |
| 800 | 3 | 19 | 234 / 369 ms | 57,052 | 34.53 dB |
| 800 | 4 | 18 | 234 / 548 ms | 57,186 | 34.54 dB |
| 1600 | 1 | 24 | 276 / 387 ms | 233,374 | 35.95 dB |
| 1600 | 2 | 24 | 314 / 490 ms | 229,456 | 35.70 dB |
| 1600 | 3 | 24 | 639 / 1,071 ms | 224,376 | 35.96 dB |
| 1600 | 4 | 24 | 654 / 936 ms | 224,826 | 35.97 dB |

Method 1 was the fastest in both sizes in this experiment. Against method 2, its median CPU was about 8% lower at 800px and 12% lower at 1600px; it produced an 8.5% larger 800px file and a 1.7% larger 1600px file, with PSNR 0.25–0.31 dB higher on this fixture. Method 3 and method 4 had nearly equal medians and output quality/size. Method 3's 1600px p95 exceeded 1,000ms, while method 4's p95 was 936ms, so the median difference does not establish a safer tail. Keep method 4 as the default; method 1 is worth exposing as a fast option after representative-image quality review. These small fixture-specific samples do not justify a general quality claim.

Artifacts: `method-ab/summary.json` and `method-ab/cloudflare-cpu-events.json` contain the first pass; `method-ab-recheck/summary.json` and `method-ab-recheck/cloudflare-cpu-events.json` contain the second. The combined table is summarized here; tail CPU events are sampled and do not match every HTTP request at 800px.

## Artifacts and limits

- `local-profile.json`: 5 warm local ARM64 Node WASM samples per variant, stage timings, output size, and RGB PSNR. Local timings are not Worker CPU measurements.
- `api3/summary.json` and `api3/cloudflare-cpu-events.json`: JPEG scaled-decode and method comparisons.
- `borrow/summary.json` and `borrow/cloudflare-cpu-events.json`: remote smoke/CPU run for the borrowed-buffer build.
- `method-ab/` and `method-ab-recheck/`: interleaved WebP method A/B runs.
- `../../src/main.rs`: implementation. The default `optimize` path still uses full JPEG decode and the library's default WebP method. Public `.webp({method})` now exposes encoder methods 0–6; scaled JPEG decoding remains experimental.

No Bun or competing WASM implementation comparison was performed. No subjective image-quality review or direct peak-memory instrumentation was performed.

## Expanded method 1 vs 2 run (prepared)

`../fixtures.json` documents the added landscape and food JPEG fixtures. The interleaved runner now defaults to three photos, target widths 320/800/1600, methods 1/2, and 16 measured rounds per image and size (288 measured requests total, plus warmups). Run `node scripts/interleave-webp-methods.mjs` with `EXPERIMENTS_WORKER_URL` and the local `.build/benchmark-secrets.json` configured; collect Worker CPU traces separately while it runs. The runner writes one output WebP per image, size, and method and produces per-case request/round-trip summaries. Round-trip figures are not Worker CPU. This expanded run has not been executed or measured yet.


## Three-photo method 1 vs 2 Worker run

On 2026-10-29, methods 1 and 2 were interleaved for 16 successful HTTP requests each for three JPEGs at 320/800/1600px (288/288 valid WebP outputs total). The run used the maintainer's experiment Worker; sampled CPU events were collected with Wrangler tail. Trace sample counts are uneven and lower than request counts, so CPU percentiles are indicative. The images are the existing portrait photo, an alpine landscape, and food/sushi; fixture sources and attribution are in `../fixtures.json`. Output bytes are median HTTP response sizes.

| Fixture | Width | Trace n (m1/m2) | Method 1 CPU p50 / p95 | Method 2 CPU p50 / p95 | Output bytes (m1/m2) |
|---|---:|---:|---:|---:|---:|
| photo-1920 | 320 | 10 / 14 | 99.5 / 118 ms | 107.0 / 133 ms | 9,758 / 8,722 |
| photo-1920 | 800 | 8 / 7 | 156.5 / 220 ms | 142.0 / 206 ms | 62,694 / 57,786 |
| photo-1920 | 1600 | 15 / 13 | 268.0 / 450 ms | 317.0 / 494 ms | 233,374 / 229,456 |
| landscape-2400 | 320 | 6 / 4 | 84.5 / 99 ms | 101.0 / 138 ms | 17,162 / 15,924 |
| landscape-2400 | 800 | 8 / 6 | 125.5 / 157 ms | 149.5 / 224 ms | 90,726 / 83,960 |
| landscape-2400 | 1600 | 14 / 14 | 265.5 / 376 ms | 356.5 / 556 ms | 315,634 / 297,370 |
| food-2400 | 320 | 7 / 5 | 114.0 / 161 ms | 114.0 / 136 ms | 15,976 / 14,788 |
| food-2400 | 800 | 12 / 3 | 143.5 / 213 ms | 141.0 / 206 ms | 77,868 / 71,096 |
| food-2400 | 1600 | 15 / 16 | 285.0 / 497 ms | 356.0 / 598 ms | 330,840 / 318,300 |

Method 1 had lower median CPU in six of nine cases, method 2 in two, and they tied at the displayed precision in one. Method 1 outputs were 1.7–11.9% larger in these cases. The clearest repeatable pattern is at 1600px: method 1 had lower median CPU on all three fixtures. At 320px results were mixed, while at 800px the gap was small or inconsistent. This still supports method 1 as a candidate speed option rather than a universal winner. This run has no lossless reference renders. I visually inspected the 800px landscape and food outputs for methods 1 and 2; they look very similar at normal display size, but this is a limited subjective check rather than a complete quality review.

Sanitized trace evidence is in `method12/cloudflare-cpu-events.json` and `method12/cpu-summary.json`; request URLs, IPs, and headers were omitted. Per-request HTTP status, round-trip times, and output sizes are in `method12/summary.json`. The benchmark runner is `../../scripts/interleave-webp-methods.mjs`.
