# Standalone image optimizer

Rust/Emscripten JPEG, non-interlaced PNG, WebP, still AVIF, and tiled/grid HEIC/HEIF decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. WebP and AVIF input are limited to 12 MP; resized `speed: 'fast'` WebP requests use reduced-output decoding. Still AVIF uses libavif with Google’s libgav1 AV1 decoder; large downscales reduce YUV planes to at most 2× target dimensions before RGBA conversion; animated AVIF, Adam7/interlaced PNG, and non-grid HEIC/HEIF are rejected. HEIC/HEIF grid decoding uses libde265. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline resizing applies with and without `speed: 'fast'` to scanline-compatible formats.** Baseline JPEG and non-interlaced PNG inputs are read row by row. WebP input is limited to 12 MP and fully decoded by default; resized fast requests use libwebp scaled output at up to 2× target dimensions, then Lanczos resizing. Still AVIF input is limited to 12 MP. For substantial downscales, libavif scales the decoded YUV planes to at most 2× target dimensions before RGBA conversion; the existing Lanczos resizer then produces the output. Tiled/grid HEIF/HEIC inputs decode one tile row at a time and support up to 48 million pixels. Adam7/interlaced PNG, animated AVIF, and non-grid HEIF/HEIC inputs are rejected. WebP output retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Only Lowzag-compatible progressive JPEGs use reduced coefficient storage and decode to a power-of-two scale before row resizing. Other progressive/multi-scan variants, including CMYK and YCCK, are rejected before coefficient buffering. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

## Input and output limits

| Input type | Maximum source pixels | Decode path | WASM linear-memory capacity | Cloudflare isolate memory (max sampled) |
| --- | ---: | --- | ---: | ---: |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. | 16 MiB | 36.14 MiB |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. | 16 MiB | 21.17 MiB |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before any full-resolution fallback. | 27.75 MiB | 43.23 MiB |
| Still AVIF | 12 MP | libavif with Google’s libgav1 AV1 decoder; YUV prescale to ≤2× target before RGBA on substantial downscales. | 44.50 MiB | 49.84 MiB |
| Tiled/grid HEIC/HEIF | 48 MP | libde265 (HEVC); decodes one tile row at a time. | 49 MiB | 54.97 MiB |

### Worker response time and CPU

These end-to-end samples convert supported synthetic inputs to 800×600 WebP. Each fixture ran in its own temporary Worker with one warm-up request followed by three measured requests. Response time is client-observed p50 and includes network and transfer time; CPU is the median per-invocation `cpuTime` reported by Wrangler tail. Wrangler captured one to three CPU samples per fixture; the sample count appears beside each CPU median. The temporary Workers used a 30-second CPU limit.

| Input path and source size | Input file size | Response p50 | Worker CPU median | WASM capacity | Worker isolate memory, max sampled | Output WebP size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline JPEG, 12 MP | 0.63 MiB | 379 ms | 213 ms (2 samples) | 16.00 MiB | 23.79 MiB (2 samples) | 61.6 KiB |
| Baseline JPEG, 24 MP | 1.26 MiB | 389 ms | 256 ms (2 samples) | 16.00 MiB | 24.83 MiB (2 samples) | 72.6 KiB |
| Baseline JPEG, 48 MP | 6.10 MiB | 547 ms | 282 ms (3 samples) | 16.00 MiB | 39.08 MiB (3 samples) | 144.9 KiB |
| Non-interlaced PNG, 12 MP | 0.19 MiB | 570 ms | 457 ms (2 samples) | 16.00 MiB | 21.07 MiB (2 samples) | 61.0 KiB |
| Non-interlaced PNG, 24 MP | 0.37 MiB | 871 ms | 622 ms (3 samples) | 16.00 MiB | 21.93 MiB (4 samples) | 71.6 KiB |
| Non-interlaced PNG, 48 MP | 0.39 MiB | 909 ms | 770 ms (2 samples) | 16.00 MiB | 24.35 MiB (3 samples) | 24.1 KiB |
| Lowzag progressive JPEG, 12 MP | 4.48 MiB | 864 ms | 479 ms (3 samples) | 16.00 MiB | 32.21 MiB (3 samples) | 261.8 KiB |
| Lowzag progressive JPEG, 24 MP | 4.63 MiB | 1,011 ms | 727 ms (3 samples) | 27.75 MiB | 41.15 MiB (4 samples) | 95.1 KiB |
| Lowzag progressive JPEG, 48 MP | 7.53 MiB | 1,407 ms | 1,001 ms (3 samples) | 27.75 MiB | 45.12 MiB (4 samples) | 104.0 KiB |
| Still AVIF to WebP, 2 MP | 0.02 MiB | 287 ms | 290 ms (2 samples) | 27.50 MiB | 32.31 MiB (3 samples) | 15.4 KiB |
| Still AVIF to WebP, 6 MP | 0.04 MiB | 774 ms | 708 ms (3 samples) | 27.75 MiB | 32.62 MiB (4 samples) | 15.6 KiB |
| Still AVIF to WebP, 12 MP | 0.04 MiB | 1,231 ms | 1,144 ms (3 samples) | 44.50 MiB | 49.84 MiB (3 samples) | 15.3 KiB |
| Tiled/grid HEIC/HEIF, 12 MP | 0.77 MiB | 641 ms | 464 ms (2 samples) | 16.00 MiB | 26.06 MiB (3 samples) | 34.1 KiB |
| Tiled/grid HEIC/HEIF, 24 MP | 0.30 MiB | 861 ms | 742 ms (3 samples) | 36.94 MiB | 44.27 MiB (4 samples) | 8.2 KiB |
| Tiled/grid HEIC/HEIF, 48 MP | 0.61 MiB | 2,842 ms | 2,539 ms (3 samples) | 48.62 MiB | 55.66 MiB (4 samples) | 15.3 KiB |



See the [raw Worker performance results](../../benchmarks/decoder-performance-worker.json). Adam7 PNG, non-grid HEIC/HEIF, and non-Lowzag progressive JPEG measurements are retained under `historicalUnsupportedResults` and do not describe current support. These small synthetic-fixture samples show this test run, not guaranteed production latency.

#### AVIF to optimized JPEG

These synthetic still AVIF fixtures were resized to 800×600 and encoded as JPEG at quality 80 in a fresh Worker per size. Each case used one warm-up and three measured requests. Cloudflare isolate memory is sampled `memoryUsageBytesP99`, not exact peak RSS.

| Input type and source size | Input file size | Response p50 | Worker CPU median | WASM capacity | Worker isolate memory, max sampled | Output JPEG size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Still AVIF to JPEG, 2 MP | 0.02 MiB | 349 ms | 422 ms (2 samples) | 27.50 MiB | 32.33 MiB (2 samples) | 29.4 KiB |
| Still AVIF to JPEG, 6 MP | 0.04 MiB | 600 ms | 588 ms (2 samples) | 27.75 MiB | 32.65 MiB (3 samples) | 29.7 KiB |
| Still AVIF to JPEG, 12 MP | 0.04 MiB | 1,188 ms | 1,047 ms (3 samples) | 44.50 MiB | 49.75 MiB (1 sample) | 29.8 KiB |

Prescaling reduced 12 MP WASM capacity from 121.00 to 44.50 MiB and sampled isolate memory from 126.40 to 49.84 MiB. Comparing decoded outputs with the earlier full-frame path gave 40.79 dB PSNR for WebP and 41.96 dB for JPEG on this synthetic chart. AV1 still reconstructs a full YUV frame; the memory saving comes from reducing those YUV planes before allocating RGBA. Cloudflare memory is sampled, not an exact peak. See the [raw Worker results](../../benchmarks/decoder-performance-worker.json).

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. `image(input,{maxPixels: ...})` bounds output pixels: 8 MP by default, maximum 16 MP. Adam7/interlaced PNG and non-grid HEIC/HEIF are unsupported. Only Lowzag-compatible progressive JPEGs are accepted; all other progressive/multi-scan variants, including CMYK and YCCK, are rejected. WASM capacity is not total Worker memory. Cloudflare's per-invocation isolate-memory metric includes shared JavaScript and WebAssembly memory, but is sampled at invocation time rather than measuring exact peak memory. Cloudflare's isolate limit is 128 MiB. Image processing runs synchronously inside the terminal method's promise.

Worker measurements used synthetic fixtures and 800×600 WebP output. A fresh Worker handled each fixture with a 30-second CPU ceiling; the normal experiment Worker uses 1,000 ms and may time out on large inputs. Cloudflare `memoryUsageBytesP99` samples are observed isolate-memory measurements, not exact peaks. Historical measurements for now-unsupported progressive JPEG variants remain under `historicalUnsupportedResults` in the [full Worker measurement report](../../benchmarks/decoder-memory-worker.json).

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

JPEG/PNG EXIF orientation is not applied; HEIF container transforms are applied by libheif. Animation and metadata preservation are not supported. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
