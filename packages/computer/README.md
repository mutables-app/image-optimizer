# Image optimizer adapter for Cloudflare Computer

Install alongside `@mutables.app/image-optimizer` and `@cloudflare/computer`.

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/photo.jpg', '/photo.webp', {
  width: 800, height: 600, quality: 80, speed: 'fast',
});
```

Reads from `workspace.fs.readFile`, optimizes with the standalone WASM package, and writes to `workspace.fs.writeFile`. No container or execution backend required. Streamed input is bounded to 20 MiB. Supports JPEG, PNG, HEIC/HEIF, and AVIF input; non-grid HEIC/HEIF and AVIF are capped at 8 megapixels, while tiled HEIF grids support up to 64 megapixels. Uses inside resizing with no enlargement by default. Set `speed: 'fast'` to request the measured fast encoding path; omit it to keep the existing default. The fast path can produce larger files, with image-dependent trade-offs. Both speed modes use scanline decoding and resizing. WebP buffers the resized pixels; JPEG encodes rows directly. Progressive JPEG and Adam7 PNG retain additional codec memory. Set `format: 'jpeg'` to write a baseline JPEG instead of the default WebP; transparent pixels are composited onto white. The result includes the matching `contentType`. The output path must differ from the input path; existing output files are overwritten.
