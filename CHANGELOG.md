# Changelog

## 0.2.2 — 2026-10-29

- Raise the streaming source image limit from 16 to 32 megapixels while retaining the 20 MiB input, 16,383-pixel dimension and 16-megapixel output limits. Cap buffered progressive/multi-scan JPEG and Adam7 PNG input at 24 megapixels after deployed Worker memory measurements.
- Test a 24-megapixel progressive JPEG through the public optimizer and measure WASM memory use before release.

## 0.2.1 — 2026-10-29

- Use libwebp's RGBX import path for JPEG input, which is always opaque, and avoid processing an unnecessary alpha channel during WebP encoding.

## 0.2.0 — 2026-10-29

- Decode baseline JPEG and non-interlaced PNG sequentially and resize with a bounded Lanczos3 row window and SIMD128, for both default and fast speed settings.
- Keep only the resized destination for WebP encoding; retain the existing WebP quality/effort settings. Float convolution can change resized pixels and encoded bytes relative to v0.1.0.
- Add `.jpeg({quality, speed})`, using baseline row encoding with standard Huffman tables, 4:2:0 chroma subsampling and white alpha compositing.
- Add `format: 'jpeg'` to the Computer adapter and return the matching content type.
- Separate the 16MP source ceiling from `maxPixels`, which now bounds output pixels (8MP by default). This allows large sources to be resized in either speed setting.
- Preserve progressive/multi-scan JPEG and Adam7 PNG compatibility with additional codec buffering; document the distinction from sequential decoding.
- Add image-correctness tests, row-memory diagnostics and matched benchmark harnesses. Retain the old full-frame implementation as an experimental benchmark reference.

## 0.1.0 — 2026-10-29

- Add a standalone Rust/Emscripten JPEG and PNG to WebP optimizer for Node.js and Cloudflare Workers.
- Add an optional Cloudflare Computer filesystem adapter that reads bounded streams and writes optimized output.
- Support quality and lossless controls, resize modes, pixel and dimension limits, and the outcome-focused `speed: 'fast'` option. Encoder settings are selected internally; omitting `speed` preserves the previous encoder default.
- Use a borrowed decoder buffer to avoid an extra full-frame RGBA allocation.
- Use TurboJPEG scaled decoding on the `speed: 'fast'` path for resized JPEGs when it can safely reduce the intermediate; cap scaled JPEG sources at 16 megapixels and preserve full-resolution decoding for PNG and lossless requests.
- Document initial Worker CPU and encoder method experiments, including their sample sizes and limitations.
