# Standalone image optimizer

Rust/Emscripten JPEG, PNG, HEIF/HEIC and AVIF decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. AVIF decoding uses dav1d through libheif; HEIC/HEIF decoding uses libde265. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline resizing applies with and without `speed: 'fast'`.** Baseline JPEG and non-interlaced PNG inputs are read row by row. Non-grid HEIF/HEIC and AVIF inputs are decoded by libheif into a complete RGBA source image before rows enter the resizer and remain capped at 12 million pixels. Grid/tiled HEIF inputs decode one tile row at a time and support up to 48 million pixels; tiled AVIF inputs support up to 48 million pixels. WebP retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Supported progressive JPEGs use lowzag's reduced coefficient storage and decode to a power-of-two scale before row resizing. Unsupported progressive and multi-scan JPEGs fall back to libjpeg coefficient buffering. Non-enlarging Adam7 PNG downscales whose float accumulator fits 48 MiB use Pngle's pass-order pixel callbacks and Lanczos accumulation into the resized destination; other output sizes fall back to libspng's complete-image decode. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

## Input and output limits

| Input type | Maximum source pixels | Decode path | WASM linear-memory capacity | Cloudflare isolate memory (max sampled) |
| --- | ---: | --- | ---: | ---: |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. | 16 MiB | Not measured |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. | 16 MiB | Not measured |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before any full-resolution fallback. | 27.75 MiB | Not measured |
| Other progressive or multi-scan JPEG | 48 MP | Buffered codec compatibility path; coefficient planes above 64 MiB are rejected before allocation. | 44.13 MiB (12 MP arithmetic-coded sample) | Not measured |
| CMYK/YCCK progressive JPEG | 12 MP | CMYK uses Lowzag reduced coefficient planes; YCCK keeps the full-coefficient compatibility path. | 19.25 MiB for CMYK | 24.34 MiB for CMYK (4 requests); old build 117.72 MiB (1 request); YCCK not measured |
| Adam7/interlaced PNG | 48 MP | Pngle callback downscaling with a <=48 MiB accumulator; full-frame fallback is limited to 12 MP. | 25.25 MiB | Not measured |
| Non-grid HEIC/HEIF | 12 MP | Full source image is decoded into memory. | 97.94 MiB | Not measured |
| Non-grid AVIF | 12 MP | Full source image is decoded into memory. | 90.25 MiB | Not measured |
| Tiled/grid HEIC/HEIF | 48 MP | Decodes one tile row at a time. | 49 MiB | Not measured |
| Tiled/grid AVIF | 48 MP | Decodes one tile row at a time. | No fixture available | Not measured |

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. `image(input,{maxPixels: ...})` bounds output pixels: 8 MP by default, maximum 16 MP. Decoder limits depend on the selected path and requested output size; Adam7 inputs above 12 MP require the callback downscaler and an output no larger than the 48 MiB accumulator permits. Other progressive JPEGs are also subject to a coefficient-plane memory check. CMYK progressive JPEGs use reduced Lowzag coefficient storage; YCCK retains the full-coefficient compatibility path. Both have a separate 12 MP source limit. WASM capacity is not total Worker memory. Cloudflare's per-invocation isolate-memory metric includes shared JavaScript and WebAssembly memory, but is sampled at invocation time rather than measuring exact peak memory; total-isolate figures are available only for the CMYK path so far. Cloudflare's isolate limit is 128 MiB. Image processing runs synchronously inside the terminal method's promise.

Worker measurements used synthetic fixtures and 800×600 WebP output. Temporary benchmark Workers used a 30,000 ms CPU ceiling; the normal experiment Worker uses 1,000 ms and may time out on large inputs. For CMYK, WASM linear-memory capacity was 19.25 MiB and the maximum Cloudflare isolate-memory sample across four successful requests was 24.34 MiB. The old build measured 112.69 MiB of WASM capacity and 117.72 MiB of isolate memory in one request. Cloudflare's metric samples isolate memory at invocation time, so these are observed maxima, not guaranteed peaks. The benchmark Worker name was reported as `__unknown__` in analytics; samples were correlated by time, colo, and successful probe requests. Other formats do not yet have total-isolate measurements. The regression test caps the CMYK path at 64 MiB. The other progressive/multi-scan measurement uses an arithmetic-coded 12 MP fixture, which bypasses Lowzag; tiled AVIF still lacks a matching fixture. See the [full Worker measurement report](../../benchmarks/decoder-memory-worker.json).

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

JPEG/PNG EXIF orientation is not applied; HEIF container transforms are applied by libheif. Animation and metadata preservation are not supported. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
