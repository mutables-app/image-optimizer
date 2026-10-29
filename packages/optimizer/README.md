# Standalone image optimizer

Rust/Emscripten JPEG, PNG, HEIF/HEIC and AVIF decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline resizing applies with and without `speed: 'fast'`.** Baseline JPEG and non-interlaced PNG inputs are read row by row. Non-grid HEIF/HEIC and AVIF inputs are decoded by libheif into a complete RGBA source image before rows enter the resizer and remain capped at 8 million pixels. Grid/tiled HEIF inputs decode one tile row at a time and support up to 64 million pixels. WebP retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Supported progressive JPEGs use lowzag's reduced coefficient storage and decode to a power-of-two scale before row resizing. Unsupported progressive and multi-scan JPEGs fall back to libjpeg coefficient buffering; Adam7 PNG uses a bounded complete-image decode. These fallback formats have higher memory requirements. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

## Input and output limits

| Input type | Maximum source pixels | Decode path |
| --- | ---: | --- |
| Baseline JPEG | 32 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. |
| Non-interlaced PNG | 32 MP | Sequential scanline decode. |
| Lowzag-compatible progressive JPEG | 64 MP | Reduced coefficient decode when resizing; full-resolution fallback retains the 24 MP buffered limit. |
| Other progressive or multi-scan JPEG | 24 MP | Buffered codec compatibility path. |
| Adam7/interlaced PNG | 24 MP | Complete-image compatibility decode before resizing. |
| Non-grid HEIC/HEIF and AVIF | 8 MP | Full source image is decoded into memory. |
| Tiled/grid HEIF/HEIC or AVIF | 64 MP | Decodes one tile row at a time. |

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. `image(input,{maxPixels: ...})` bounds output pixels: 8 MP by default, maximum 16 MP. The Wasm build allows up to 256 MiB of linear memory; Cloudflare Worker isolates have a 128 MiB total limit across JavaScript and WebAssembly. Image processing runs synchronously inside the terminal method's promise.

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

JPEG/PNG EXIF orientation is not applied; HEIF container transforms are applied by libheif. Animation and metadata preservation are not supported. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
