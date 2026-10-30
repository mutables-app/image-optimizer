# Image optimizer adapter for Cloudflare Computer

Install alongside `@mutables.app/image-optimizer` and `@cloudflare/computer`.

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/photo.jpg', '/photo.webp', {
  width: 800, height: 600, quality: 80, speed: 'fast',
});
```

Reads from `workspace.fs.readFile`, optimizes with the standalone WASM package, and writes to `workspace.fs.writeFile`. No container or execution backend required. Uses inside resizing with no enlargement by default. Set `speed: 'fast'` to request the measured fast encoding path; omit it to keep the existing default. The fast path can produce larger files, with image-dependent trade-offs. Both speed modes use scanline decoding and resizing. WebP buffers the resized pixels; JPEG encodes rows directly. Set `format: 'jpeg'` to write a baseline JPEG instead of the default WebP; transparent pixels are composited onto white. The result includes the matching `contentType`. The input decoder accepts baseline JPEG, Lowzag-compatible progressive JPEG, non-interlaced PNG, and tiled/grid HEIC/HEIF; it rejects other progressive/multi-scan JPEGs (including CMYK and YCCK), Adam7 PNG, non-grid HEIC/HEIF, and AVIF. The output path must differ from the input path; existing output files are overwritten.

## Input and output limits

| Input type | Maximum source pixels | Decode path |
| --- | ---: | --- |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before full-resolution fallback. |
| Tiled/grid HEIF/HEIC | 48 MP | Decodes one tile row at a time. |

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. The output pixel limit is 8 MP by default and can be raised to 16 MP. AVIF, Adam7/interlaced PNG, and non-grid HEIC/HEIF input are not supported. Cloudflare Worker isolates have a 128 MiB total memory limit across JavaScript and WebAssembly.
