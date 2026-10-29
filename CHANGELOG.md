# Changelog

## 0.1.0 — 2026-10-29

- Add a standalone Rust/Emscripten JPEG and PNG to WebP optimizer for Node.js and Cloudflare Workers.
- Add an optional Cloudflare Computer filesystem adapter that reads bounded streams and writes optimized output.
- Support quality and lossless controls, resize modes, pixel and dimension limits, and the outcome-focused `speed: 'fast'` option. Encoder settings are selected internally; omitting `speed` preserves the previous encoder default.
- Use a borrowed decoder buffer to avoid an extra full-frame RGBA allocation.
- Use TurboJPEG scaled decoding on the `speed: 'fast'` path for resized JPEGs when it can safely reduce the intermediate; cap scaled JPEG sources at 16 megapixels and preserve full-resolution decoding for PNG and lossless requests.
- Document initial Worker CPU and encoder method experiments, including their sample sizes and limitations.
