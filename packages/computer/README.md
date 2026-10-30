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
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before full-resolution fallback. |
| Other progressive or multi-scan JPEG | 48 MP | Buffered codec compatibility path; coefficient planes above 64 MiB are rejected before allocation; 12 MP arithmetic-coded sample used 44.13 MiB of WASM capacity. |
| CMYK/YCCK progressive JPEG | 12 MP | Lowzag does not support CMYK; this path buffers coefficient planes. |
| Adam7/interlaced PNG | 48 MP | Pngle callback downscaling with a <=48 MiB accumulator; full-frame fallback is limited to 12 MP. |
| Non-grid HEIC/HEIF and AVIF | 12 MP | Full source image is decoded into memory. |
| Tiled/grid HEIF/HEIC | 48 MP | Decodes one tile row at a time. |
| Tiled/grid AVIF | 48 MP | Decodes one tile row at a time. |

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. The output pixel limit is 8 MP by default and can be raised to 16 MP. Decoder limits depend on path and output size; Adam7 inputs above 12 MP require callback downscaling within the 48 MiB accumulator limit. Cloudflare Worker isolates have a 128 MiB total memory limit across JavaScript and WebAssembly.
