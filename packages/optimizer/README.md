# Standalone image optimizer

Rust/Emscripten JPEG, non-interlaced PNG, and tiled/grid HEIC/HEIF decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. Adam7/interlaced PNG, non-grid HEIC/HEIF, and AVIF input are rejected. HEIC/HEIF grid decoding uses libde265. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline resizing applies with and without `speed: 'fast'`.** Baseline JPEG and non-interlaced PNG inputs are read row by row. Tiled/grid HEIF/HEIC inputs decode one tile row at a time and support up to 48 million pixels. Adam7/interlaced PNG and non-grid HEIF/HEIC inputs are rejected; AVIF input is also unsupported. WebP retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Only Lowzag-compatible progressive JPEGs use reduced coefficient storage and decode to a power-of-two scale before row resizing. Other progressive/multi-scan variants, including CMYK and YCCK, are rejected before coefficient buffering. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

## Input and output limits

| Input type | Maximum source pixels | Decode path | WASM linear-memory capacity | Cloudflare isolate memory (max sampled) |
| --- | ---: | --- | ---: | ---: |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. | 16 MiB | 36.14 MiB |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. | 16 MiB | 21.17 MiB |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before any full-resolution fallback. | 27.75 MiB | 43.23 MiB |
| Tiled/grid HEIC/HEIF | 48 MP | libde265 (HEVC); decodes one tile row at a time. | 49 MiB | 54.97 MiB |

### Worker response time and CPU

These end-to-end samples convert supported synthetic inputs to 800×600 WebP. Each fixture ran in its own temporary Worker with one warm-up request followed by three measured requests. Response time is client-observed p50 and includes network and transfer time; CPU is the median per-invocation `cpuTime` reported by Wrangler tail. Wrangler captured between one and three CPU samples per fixture, as shown below. The temporary Workers used a 30-second CPU limit.

| Input path and source size | Result | Response p50 | Worker CPU median | WASM capacity after last request |
| --- | --- | ---: | ---: | ---: |
| Baseline JPEG, 12 MP | Converted | 234 ms | 137 ms (3 samples) | 16 MiB |
| Baseline JPEG, 24 MP | Converted | 230 ms | 122 ms (3 samples) | 16 MiB |
| Baseline JPEG, 48 MP | Converted | 570 ms | 308 ms (3 samples) | 16 MiB |
| Non-interlaced PNG, 48 MP | Converted | 1,083 ms | 933 ms (3 samples) | 16 MiB |
| Lowzag progressive JPEG, 24 MP | Converted | 952 ms | 686 ms (3 samples) | 27.75 MiB |
| Lowzag progressive JPEG, 48 MP | Converted | 1,025 ms | 726 ms (3 samples) | 27.75 MiB |
| Tiled/grid HEIC/HEIF, 12 MP | Converted | 560 ms | 422 ms (3 samples) | 16 MiB |
| Tiled/grid HEIC/HEIF, 48 MP | Converted | 1,339 ms | 1,171 ms (3 samples) | 48.63 MiB |

See the [raw Worker performance results](../../benchmarks/decoder-performance-worker.json). Adam7 PNG, non-grid HEIC/HEIF, and non-Lowzag progressive JPEG measurements are retained under `historicalUnsupportedResults` and do not describe current support. These small synthetic-fixture samples show this test run, not guaranteed production latency.

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. `image(input,{maxPixels: ...})` bounds output pixels: 8 MP by default, maximum 16 MP. Adam7/interlaced PNG and non-grid HEIC/HEIF are unsupported. Only Lowzag-compatible progressive JPEGs are accepted; all other progressive/multi-scan variants, including CMYK and YCCK, are rejected. WASM capacity is not total Worker memory. Cloudflare's per-invocation isolate-memory metric includes shared JavaScript and WebAssembly memory, but is sampled at invocation time rather than measuring exact peak memory. Cloudflare's isolate limit is 128 MiB. Image processing runs synchronously inside the terminal method's promise.

Worker measurements used synthetic fixtures and 800×600 WebP output. A fresh Worker handled each fixture with a 30-second CPU ceiling; the normal experiment Worker uses 1,000 ms and may time out on large inputs. Cloudflare `memoryUsageBytesP99` samples are observed isolate-memory measurements, not exact peaks. Historical measurements for now-unsupported progressive JPEG variants remain under `historicalUnsupportedResults` in the [full Worker measurement report](../../benchmarks/decoder-memory-worker.json).

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

JPEG/PNG EXIF orientation is not applied; HEIF container transforms are applied by libheif. Animation and metadata preservation are not supported. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
