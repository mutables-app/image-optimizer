# Standalone image optimizer

Rust/Emscripten JPEG and PNG decoding, scanline Lanczos3 resizing with WASM SIMD128, and WebP/JPEG output. No Cloudflare Computer dependency.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(1200, 1200, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, speed: 'fast'})
  .bytes();

const jpeg = await image(inputBytes).resize(800).jpeg({quality: 80}).bytes();
```

Input: Blob, ArrayBuffer, or typed array. `.bytes()` returns a Uint8Array; `.blob()` returns an image/webp or image/jpeg Blob. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `fit: 'inside'` preserves aspect ratio.

**Scanline processing applies with and without `speed: 'fast'`.** Baseline JPEG and non-interlaced PNG inputs are read row by row, and the resizer keeps a bounded row window. WebP retains the complete resized image for encoding. JPEG encodes resized rows directly, uses baseline 4:2:0 output and composites transparency onto white. Input and encoded output bytes remain buffered: this API does not stream HTTP input/output.

Progressive/multi-scan JPEG needs coefficient storage inside the codec. Adam7 PNG uses a bounded complete-image decode before row resizing. These formats have higher memory requirements. No fixed whole-Worker memory guarantee is made.

For WebP, `speed: 'fast'` selects a faster internal encoder setting and enables scaled JPEG decoding where beneficial. The fast encoder can produce larger files. For JPEG output, `speed: 'fast'` enables scaled JPEG decoding; the JPEG encoder uses the same settings in both modes. Omit speed for full-resolution decoding and the default WebP encoder. `.webp({lossless: true})` uses lossless WebP encoding and disables scaled decoding; resizing still changes pixels.

20 MiB input limit and 32 million source pixels for streaming inputs. Buffered progressive/multi-scan JPEGs and Adam7 PNGs are capped at 24 million pixels based on deployed Worker memory measurements. `image(input,{maxPixels: ...})` bounds output pixels: 8 million by default, maximum 16 million. Dimensions are limited to 16383. The WASM build allows up to 256 MiB of linear memory; Cloudflare Worker isolates are limited to 128 MiB total across JavaScript and WebAssembly. Image processing runs synchronously inside the terminal method's promise.

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

No EXIF auto-orientation, ICC conversion, animation, or metadata preservation. See licenses/ for bundled codec and Rust dependency notices. The source repository contains reference benchmarks; no Bun performance equivalence is claimed.
