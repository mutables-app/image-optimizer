# Standalone image optimizer

Rust/Emscripten JPEG, PNG and HEIF/HEIC decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. HEIC/HEIF decoding uses libde265. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline resizing applies with and without `speed: 'fast'`.** Baseline JPEG and non-interlaced PNG inputs are read row by row. Non-grid HEIF/HEIC inputs are decoded by libheif into a complete RGBA source image before rows enter the resizer and remain capped at 12 million pixels. Grid/tiled HEIF inputs decode one tile row at a time and support up to 48 million pixels. AVIF input is rejected. WebP retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Supported progressive JPEGs use lowzag's reduced coefficient storage and decode to a power-of-two scale before row resizing. Unsupported progressive and multi-scan JPEGs fall back to libjpeg coefficient buffering. Adam7/interlaced PNG inputs are capped at 12 MP. Eligible non-enlarging downscales whose float accumulator fits 48 MiB use Pngle's pass-order pixel callbacks and Lanczos accumulation into the resized destination; other output sizes use libspng's complete-image path. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

## Input and output limits

| Input type | Maximum source pixels | Decode path | WASM linear-memory capacity | Cloudflare isolate memory (max sampled) |
| --- | ---: | --- | ---: | ---: |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. | 16 MiB | 36.14 MiB |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. | 16 MiB | 21.17 MiB |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before any full-resolution fallback. | 27.75 MiB | 43.23 MiB |
| Other progressive or multi-scan JPEG | 48 MP | Buffered codec compatibility path; coefficient planes above 64 MiB are rejected before allocation. | 44.13 MiB (12 MP arithmetic-coded sample) | 49.27 MiB (12 MP arithmetic-coded sample) |
| CMYK progressive JPEG | 12 MP | Lowzag reduced coefficient planes. | 19.25 MiB | 24.34 MiB (5 current-build requests); old build 117.72 MiB (1 request) |
| YCCK progressive JPEG | 12 MP | Buffered coefficient compatibility path. | 71.56 MiB | 76.49 MiB (1 request) |
| Adam7/interlaced PNG | 12 MP | Pngle callback downscaling for eligible resized outputs; full-frame fallback is also limited to 12 MP. | 25.25 MiB (historical 48 MP test) | 46.07 MiB (historical 48 MP test) |
| Non-grid HEIC/HEIF | 12 MP | libde265 (HEVC); decodes the full source image into memory. | 117.19 MiB (current repeated-request run) | 102.66 MiB (prior build; current isolate memory not sampled) |
| Tiled/grid HEIC/HEIF | 48 MP | libde265 (HEVC); decodes one tile row at a time. | 49 MiB | 54.97 MiB |

### Worker response time and CPU

These end-to-end samples convert synthetic inputs to 800×600 WebP. Each fixture ran in its own temporary Worker with one warm-up request followed by three measured requests. Response time is client-observed p50 and includes network and transfer time; CPU is the median per-invocation `cpuTime` reported by Wrangler tail. Wrangler captured between one and three CPU samples per fixture, as shown below. The temporary Workers used a 30-second CPU limit.

| Input path and source size | Result | Response p50 | Worker CPU median | WASM capacity after last request |
| --- | --- | ---: | ---: | ---: |
| Baseline JPEG, 12 MP | Converted | 234 ms | 137 ms (3 samples) | 16 MiB |
| Baseline JPEG, 24 MP | Converted | 230 ms | 122 ms (3 samples) | 16 MiB |
| Baseline JPEG, 48 MP | Converted | 570 ms | 308 ms (3 samples) | 16 MiB |
| Non-interlaced PNG, 48 MP | Converted | 1,083 ms | 933 ms (3 samples) | 16 MiB |
| Lowzag progressive JPEG, 24 MP | Converted | 952 ms | 686 ms (3 samples) | 27.75 MiB |
| Lowzag progressive JPEG, 48 MP | Converted | 1,025 ms | 726 ms (3 samples) | 27.75 MiB |
| Other progressive JPEG, 12 MP | Converted | 251 ms | 144 ms (3 samples) | 43.75 MiB |
| CMYK progressive JPEG, 12 MP | Converted | 407 ms | 278 ms (1 sample) | 19.25 MiB |
| YCCK progressive JPEG, 12 MP | Converted | 287 ms | 177 ms (3 samples) | 71.21 MiB |
| Adam7 PNG, 12 MP | Converted | 1,829 ms | 1,590 ms (3 samples) | 16 MiB |
| Adam7 PNG, 24 MP | Rejected at source limit | 155 ms | 30 ms (3 samples) | — |
| Adam7 PNG, 48 MP | Rejected at source limit | 454 ms | 127 ms (3 samples) | — |
| Non-grid HEIC/HEIF, 12 MP | Converted | 400 ms | 308 ms (3 samples) | 117.19 MiB |
| Non-grid HEIC/HEIF, 24 MP | Rejected at source limit | 78 ms | 7 ms (3 samples) | — |
| Tiled/grid HEIC/HEIF, 12 MP | Converted | 560 ms | 422 ms (3 samples) | 16 MiB |
| Tiled/grid HEIC/HEIF, 48 MP | Converted | 1,339 ms | 1,171 ms (3 samples) | 48.63 MiB |

See the [raw Worker performance results](../../benchmarks/decoder-performance-worker.json). The 117.19 MiB figure is WASM linear-memory capacity, not total isolate memory; the current run did not capture a matching Cloudflare isolate-memory sample. These small synthetic-fixture samples show this test run, not guaranteed production latency.

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. `image(input,{maxPixels: ...})` bounds output pixels: 8 MP by default, maximum 16 MP. Adam7/interlaced PNG source images are capped at 12 MP; eligible resized outputs can use the callback downscaler within its 48 MiB accumulator limit. Other progressive JPEGs are subject to a coefficient-plane memory check. CMYK progressive JPEGs use reduced Lowzag coefficient storage; YCCK retains the full-coefficient compatibility path. Both have a separate 12 MP source limit. WASM capacity is not total Worker memory. Cloudflare's per-invocation isolate-memory metric includes shared JavaScript and WebAssembly memory, but is sampled at invocation time rather than measuring exact peak memory. Cloudflare's isolate limit is 128 MiB. Image processing runs synchronously inside the terminal method's promise.

Worker measurements used synthetic fixtures and 800×600 WebP output. A fresh Worker handled each fixture; these tests used a 30,000 ms CPU ceiling, while the normal experiment Worker uses 1,000 ms and may time out on large inputs. The Cloudflare values are `memoryUsageBytesP99` samples from Workers Analytics, correlated by request time and colo; most temporary Worker names were returned as `__unknown__`. Each format has one successful request except CMYK, which has five current-build samples; treat the table values as observed maxima, not guaranteed peaks. The CMYK path used 19.25 MiB of WASM capacity and up to 24.34 MiB of total isolate memory in those samples, versus 112.69 MiB and 117.72 MiB for one old-build request. YCCK remains on buffered decoding and measured 76.49 MiB total isolate memory for one 12 MP request. The regression test caps reduced CMYK decoding at 64 MiB of WASM capacity. The other progressive/multi-scan measurement uses a 12 MP arithmetic-coded fixture, which bypasses Lowzag. See the [full Worker measurement report](../../benchmarks/decoder-memory-worker.json).

## Decoder memory roadmap

Investigate reducing the full-resolution decode cost for non-grid HEIC/HEIF while keeping its 12 MP input limit. The current Worker sample is 102.66 MiB. Candidate experiments are to avoid an extra full-size RGBA surface where the codec permits it, and to evaluate decoder-side reduced-resolution or custom-buffer options for libde265. These are investigation directions, not confirmed capabilities. Before changing either limit, benchmark total isolate memory, WASM capacity, CPU time, and output correctness in a real Worker.

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

JPEG/PNG EXIF orientation is not applied; HEIF container transforms are applied by libheif. Animation and metadata preservation are not supported. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
