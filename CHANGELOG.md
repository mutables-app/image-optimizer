# Changelog

## 0.1.0 — unreleased

- Add a standalone Rust/Emscripten JPEG and PNG to WebP optimizer for Node.js and Cloudflare Workers.
- Add an optional Cloudflare Computer filesystem adapter that reads bounded streams and writes optimized output.
- Support quality and lossless controls, resize modes, pixel and dimension limits, and optional WebP encoder method selection (`0`–`6`). Omitting `method` preserves the previous encoder default.
- Use a borrowed decoder buffer to avoid an extra full-frame RGBA allocation.
- Keep scaled JPEG decoding experimental until representative visual-quality checks are complete.
- Document initial Worker CPU and encoder method experiments, including their sample sizes and limitations.
