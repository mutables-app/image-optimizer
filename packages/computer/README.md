# Image optimizer adapter for Cloudflare Computer

Install alongside `@mutables.app/image-optimizer` and `@cloudflare/computer`.

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/photo.jpg', '/photo.webp', {
  width: 800, height: 600, quality: 80, speed: 'fast',
});
```

Reads from `workspace.fs.readFile`, optimizes with the standalone WASM package, and writes to `workspace.fs.writeFile`. No container or execution backend required. Uses inside resizing with no enlargement by default. Set `speed: 'fast'` to request the faster path; omit it to keep existing defaults. Fast resized WebP inputs decode to a reduced intermediate surface, then use Lanczos resizing; default WebP decoding retains the full source surface. WebP and still AVIF input are limited to 12 MP. Still AVIF uses libavif with Google’s libgav1 AV1 decoder; substantial downscales reduce YUV planes before RGBA conversion; animated AVIF is unsupported. WebP output buffers resized pixels; JPEG encodes rows directly. Set `format: 'jpeg'` to write a baseline JPEG instead of the default WebP; transparent pixels are composited onto white. The result includes the matching `contentType`. The input decoder accepts baseline JPEG, Lowzag-compatible progressive JPEG, non-interlaced PNG, WebP (up to 12 MP), still AVIF (up to 12 MP), and tiled/grid HEIC/HEIF; it rejects other progressive/multi-scan JPEGs (including CMYK and YCCK), Adam7 PNG, and non-grid HEIC/HEIF. The output path must differ from the input path; existing output files are overwritten.

## Input and output limits

| Input type | Maximum source pixels | Decode path |
| --- | ---: | --- |
| Baseline JPEG | 48 MP | Sequential scanline decode; eligible resized JPEGs can use scaled decode with `speed: 'fast'`. |
| Non-interlaced PNG | 48 MP | Sequential scanline decode. |
| Lowzag-compatible progressive JPEG | 48 MP | Reduced coefficient decode when resizing; coefficient planes are checked before full-resolution fallback. |
| Still AVIF | 12 MP | libavif with Google’s libgav1 AV1 decoder; substantial downscales pre-scale YUV before RGBA conversion. |
| Tiled/grid HEIF/HEIC | 48 MP | Decodes one tile row at a time. |

All formats share a 20 MiB input limit and a 16,383-pixel dimension limit. The output pixel limit is 8 MP by default and can be raised to 16 MP. Adam7/interlaced PNG and non-grid HEIC/HEIF input are not supported. Cloudflare Worker isolates have a 128 MiB total memory limit across JavaScript and WebAssembly.
