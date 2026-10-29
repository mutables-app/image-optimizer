# Image optimizer adapter for Cloudflare Computer

Install alongside `@mutables.app/image-optimizer` and `@cloudflare/computer`.

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/photo.jpg', '/photo.webp', {
  width: 800, height: 600, quality: 80, speed: 'fast',
});
```

Reads from `workspace.fs.readFile`, optimizes with the standalone WASM package, and writes to `workspace.fs.writeFile`. No container or execution backend required. Streamed input is bounded to 20 MiB. Uses inside resizing with no enlargement by default. Set `speed: 'fast'` to request the measured fast encoding path; omit it to keep the existing default. The fast path can produce larger files, with image-dependent trade-offs. Scaled JPEG decode remains experimental. The output path must differ from the input path; existing output files are overwritten.
