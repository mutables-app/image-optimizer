# Image Workspace

A standalone Rust/Emscripten image optimizer with an optional Cloudflare Computer filesystem adapter. This project is separate from the upstream workers-rs checkout.

## Standalone optimizer

```js
import { image } from '@mutables.app/image-optimizer';
const bytes = await image(inputBytes)
  .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80, method: 1 })
  .bytes();
```

Accepts Blob, ArrayBuffer and typed-array input. Input is sniffed as JPEG or PNG. Width-only resizing preserves aspect ratio; two dimensions default to `fill`. Output is always WebP, with optional lossless encoding and method 0–6. Omit `method` to retain the existing default; method 1 is a speed-oriented choice whose size and quality trade-offs depend on the image. `.blob()` returns an `image/webp` Blob. Terminals return promises, but CPU work runs synchronously in the isolate; it is not moved to a background thread.

The optimizer has no Computer dependency. Node selects a separate loader automatically through package exports. Workers use a statically imported WebAssembly module. A standalone Worker is in `examples/standalone`; run `npx wrangler dev --config examples/standalone/wrangler.jsonc`.

## Computer adapter

```js
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';
await optimizeWorkspaceImage(workspace, '/input.jpg', '/output.webp', {
  width: 800, height: 600, fit: 'inside', quality: 80, method: 1,
});
```

Pass a Computer Workspace or Workspace stub with `fs.readFile` and `fs.writeFile`. Binary reads are consumed as streams and bounded before buffering. The adapter does not start a container or execution backend: it runs the WASM optimizer in the Worker and saves the result to Computer's SQLite-backed filesystem. Input and output paths must differ. Existing output files can be overwritten.

## Local integration example

```sh
npm install
npm run dev
curl -X POST --data-binary @test/fixtures/input.jpg 'http://localhost:8787/optimize?width=80' -o /tmp/direct.webp
curl -X PUT --data-binary @test/fixtures/input.jpg http://localhost:8787/workspaces/demo/files/input.jpg
curl -X POST -H 'content-type: application/json' --data '{"input":"/input.jpg","output":"/output.webp","width":80}' http://localhost:8787/workspaces/demo/optimize
curl http://localhost:8787/workspaces/demo/files/output.webp -o /tmp/workspace.webp
```

`wrangler.jsonc` registers an SQLite Durable Object. The demo intentionally has no login or workspace authorization; add those before exposing it to users. No Cloudflare deployment is performed by the build/test scripts.

## Build

Prerequisites: Python 3.12+, CMake 3.16+, Make, Rust beta with the `wasm32-unknown-emscripten` target, Emscripten **6.0.10**, and `wasm-bindgen` CLI **0.2.129** on PATH. The build downloads pinned codec release tags from GitHub. Set `EMSDK` to the installed SDK and `EM_CONFIG` to its generated config file. If CMake is outside PATH, set `CMAKE`.

```sh
export EMSDK=/path/to/emsdk
export EM_CONFIG=/path/to/emscripten.config
./scripts/build.sh
npm test
npm run check:worker
```

With the combined dev server running, `npm run test:worker` exercises the real Computer storage flow. On this host, Node/npm are installed under `$HOME/.cache/worker-build/emsdk-6.0.10/node/24.19.0_64bit/bin`; add that directory to PATH if needed. Package archives are in `.build/artifacts/`.

Libraries: libjpeg-turbo 3.1.3, libspng 0.7.4, libwebp 1.6.0, and fast_image_resize (Cargo.lock pins its version). The resize path uses WASM SIMD128. Specialized codec SIMD is disabled in the current build: libjpeg-turbo assembly, libspng's architecture-specific SIMD, and libwebp's SIMD source paths. See [`benchmarks/experiments/RESULTS.md`](benchmarks/experiments/RESULTS.md) for the binary/build audit. No claim of Bun-equivalent speed is made. Third-party notices are in `licenses/`, and Cargo/npm lockfiles record dependencies.

## Limits and current scope

- JPEG/PNG input only; WebP output only. No animation, HEIC, AVIF, rotation, or metadata API.
- Maximum input 20 MiB; default 8 million pixels, configurable up to 16 million. Source and output dimensions cannot exceed 16383. WASM linear memory is capped at 256 MiB; complex images may still exhaust memory before reaching those limits.
- PNG alpha is preserved. EXIF orientation and ICC color management are not applied; metadata is not copied. JPEGs with decoder warnings are rejected.
- SIMD resizer uses its default Lanczos3 filter with alpha handling. No alternate filter API yet. JPEG scaled decoding is experimental and is not exposed by the package API.
- CPU time and peak memory must be measured on representative production images before choosing Worker limits. The public `.webp({method})` option accepts libwebp methods 0–6; omitting it preserves the prior default. Experiment data and limitations are in [`benchmarks/experiments/RESULTS.md`](benchmarks/experiments/RESULTS.md). This project has no Bun/native performance comparison.

Tests exercise real codecs, malformed input, limits, resize modes, alpha, and the adapter. The independent output validator needs Python 3 and native `libwebp.so.7` (available on this Linux host). The Worker integration test requires Wrangler/workerd.


This repository does not deploy or operate a public image-processing service. Historical benchmark notes in `benchmarks/experiments/RESULTS.md` come from the maintainer's own test deployments; endpoint URLs and account-specific deployment data are omitted.
