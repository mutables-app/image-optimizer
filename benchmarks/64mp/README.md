# 64 megapixel experiment

Tested synthetic 8000×8000 inputs resized to 800×800 with an isolated build. Both source and buffered caps were raised to 64 million pixels for the progressive experiment. The staged v0.2.2 packages and tracked decoder limits were unchanged.

Progressive JPEG passed all four local conversions (WebP/JPEG, default/fast). WASM linear-memory capacity reached 231–231.3125 MiB. This is capacity, not a live-memory measurement.

On the deployed experiments Worker, progressive JPEG to WebP passed at both speeds with independently decoded 800×800 output. Progressive JPEG to JPEG failed at both speeds with HTTP 400 and `Invalid array buffer length`. The exact failing allocation has not been isolated. Worker request round trips were approximately 5–8 seconds; these are not CPU times.

Baseline JPEG passed all four local conversions. On the Worker, WebP passed at both speeds and JPEG passed in fast mode; default JPEG returned HTTP 503. Streaming PNG passed all four local conversions, but all four Worker requests returned HTTP 503. The cause of those 503 responses was not established by these measurements.

One request per case using synthetic fixtures does not establish reliability, concurrency safety, or general 64 MP support. Cloudflare documents a 128 MB isolate limit across JS and WASM, and may allow in-flight requests to finish while recycling isolates: https://developers.cloudflare.com/workers/platform/limits/#memory

Raw results are in `results.json`. Fixture generator, isolated source/build, outputs and diagnostic logs remain under ignored `.build/experiment-64mp/`.
