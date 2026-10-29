# Standalone image optimizer

Rust/Emscripten JPEG and PNG decoder, SIMD resizer, and WebP encoder. No Cloudflare Computer dependency. Built with libjpeg-turbo, libspng, libwebp, and fast_image_resize.

```js
import { image } from '@mutables.app/image-optimizer';
const webp = await image(inputBytes)
  .resize(800, 600, {fit: 'inside', withoutEnlargement: true})
  .webp({quality: 80, method: 1})
  .bytes();
```

Input: Blob, ArrayBuffer, or typed array. Output: Uint8Array, or `.blob()` for an image/webp Blob. `.webp({lossless:true})` enables lossless encoding. The optional WebP `method` accepts 0–6; omitting it preserves the library default. Lower methods usually trade some output size for speed, but the trade-off depends on the image. Method 1 was fastest in our preliminary JPEG Worker benchmark; see the workspace experiment report before choosing it for your workload. Width-only resizing preserves aspect ratio. Two dimensions default to stretch; `inside` preserves aspect ratio.

Node uses a file-based WASM loader; Workers use a static `.wasm` import. Configure your bundler to treat that file as a WebAssembly module. Requires WebAssembly SIMD and modern WASM exception handling. Workers tested with compatibility date 2026-09-02 and `new_module_registry`.

20 MiB input limit; 8 million pixels by default (override with `image(input,{maxPixels: ...})`, maximum 16 million). 256 MiB linear memory cap. High-memory images can still exhaust that cap. Encoding runs synchronously inside the terminal's promise, not on a background thread.

JPEG/PNG input only, WebP output only. No EXIF auto-orientation, ICC conversion, animation, or metadata preservation. Scaled JPEG decode remains experimental and is not exposed by the public package. No Bun performance equivalence is claimed. See licenses/ for bundled codec and Rust dependency notices.
