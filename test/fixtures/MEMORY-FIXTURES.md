The 12, 24, and 48 MP PNG/JPEG charts and tiled HEIC grids used in decoder benchmarks are synthetic local test data; no third-party image content is used. The 12 and 24 MP non-interlaced PNG fixtures use deterministic gradients and PNG Sub filtering. The 12 MP Lowzag progressive JPEG is encoded from a synthetic PPM with libjpeg-turbo; the 24 and 48 MP progressive JPEGs are produced by `scripts/make-progressive-memory-fixture.py`. The 24 MP tiled HEIC grid is a synthetic 6×4 HEVC grid with 1024-pixel tiles; 12 and 48 MP grids are also synthetic. The arithmetic-coded 12 MP, CMYK progressive, and YCCK progressive JPEG fixtures are retained to verify that non-Lowzag progressive variants are rejected. The YCCK fixture is transcoded from the 12 MP CMYK chart by `scripts/make-ycck-progressive-fixture.c`, using libjpeg-turbo.

SHA-256:

- `input-48mp-baseline.jpg`: `d78a623fb4d4218d897e051b9e88fe9182f732385b6b1d490f0797b5d00407f6`
- `input-12mp-baseline.jpg`: `7288e7341703bde43015e2d04f8c07ef1fc17b9107f10c180d03053227882a62`
- `input-24mp-baseline.jpg`: `265ea6071a0131f57e7ad58529897403d39dc51241e4ce15838f1e6bd99e6fc4`
- `input-48mp-cmyk-progressive.jpg`: `0e2ae78f013bf2084069eae4aa0db3f8b9a5291025e4816f4f2fbb49665b47c0`
- `input-12mp-cmyk-progressive.jpg`: `f66598d0a40539788118a4cc8cda051a2821002c4e095fc4461b733b43c026ad`
- `input-12mp-ycck-progressive.jpg`: `2a00d1cffb6961c735b26d1124fbc2bb4d97cd19fa32f8fb6541f23377e5e9ad`
- `input-12mp-arithmetic-progressive.jpg`: `23d6af61a10ebcad1ffd0adc57e9bef970fd5ba9fef7c2046650a0360a9146cf`
- `input-48mp-progressive.jpg`: `ac441bf929be1cda09e052d4f98ac0d46fc57aa7755351fd730b97c3ac69963e`
- `input-48mp-streaming.png`: `a4f6e7bc9df353d33bed14c49f3d7740037501836e4ff085b4a1769cc432c685`
