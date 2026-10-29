# Image optimizer adapter for Cloudflare Computer

Install alongside `@mutables.app/image-optimizer` and `@cloudflare/computer`.

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/photo.jpg', '/photo.webp', {
  width: 800, height: 600, quality: 80, speed: 'fast',
});
```

Reads from `workspace.fs.readFile`, optimizes with the standalone WASM package, and writes to `workspace.fs.writeFile`. No container or execution backend required. Uses inside resizing with no enlargement by default. Set `speed: 'fast'` to request the measured fast encoding path; omit it to keep the existing default. The fast path can produce larger files, with image-dependent trade-offs. Both speed modes use scanline decoding and resizing. WebP buffers the resized pixels; JPEG encodes rows directly. Set `format: 'jpeg'` to write a baseline JPEG instead of the default WebP; transparent pixels are composited onto white. The result includes the matching `contentType`. The output path must differ from the input path; existing output files are overwritten.

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

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. The output pixel limit is 8 MP by default and can be raised to 16 MP. Cloudflare Worker isolates have a 128 MiB total memory limit across JavaScript and WebAssembly. Progressive JPEG and Adam7 PNG compatibility paths retain additional codec memory.
