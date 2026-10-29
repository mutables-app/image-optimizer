const MAX_INPUT = 20 * 1024 * 1024;
const dimension = value => {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 1 || value > 16383) throw new RangeError('Dimensions must be integers from 1 to 16383');
  return value;
};
export function createImage(optimize) {
  return function image(input, { maxPixels = 8_000_000 } = {}) {
    if (!Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > 16_000_000) throw new RangeError('maxPixels must be 1–16000000');
    // Snapshot byte input: callers can reuse or mutate their input while awaiting.
    let snapshot;
    if (input instanceof Blob) {
      if (input.size > MAX_INPUT) throw new RangeError('Input exceeds 20 MiB');
      snapshot = input;
    } else if (input instanceof ArrayBuffer) {
      if (input.byteLength > MAX_INPUT) throw new RangeError('Input exceeds 20 MiB');
      snapshot = new Uint8Array(input.slice(0));
    }
    else if (ArrayBuffer.isView(input)) {
      if (input.byteLength > MAX_INPUT) throw new RangeError('Input exceeds 20 MiB');
      snapshot = new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
    }
    else throw new TypeError('Expected Blob, ArrayBuffer, or typed array');
    if (snapshot.byteLength > MAX_INPUT) throw new RangeError('Input exceeds 20 MiB');
    let width = 0, height = 0, inside = false, withoutEnlargement = false;
    let quality = 80, lossless = false, method = -1, scaled = false;
    const pipeline = {
      resize(w, h, options = {}) {
        width = dimension(w); height = dimension(h);
        if (!width && !height) throw new RangeError('Provide a width or height');
        if (options.fit !== undefined && !['fill', 'inside'].includes(options.fit)) throw new TypeError('fit must be fill or inside');
        if (options.withoutEnlargement !== undefined && typeof options.withoutEnlargement !== 'boolean') throw new TypeError('withoutEnlargement must be boolean');
        inside = options.fit === 'inside'; withoutEnlargement = options.withoutEnlargement ?? false;
        return pipeline;
      },
      webp(options = {}) {
        quality = options.quality ?? 80; lossless = options.lossless ?? false;
        if (options.method !== undefined) throw new TypeError('method is internal; use speed: "fast"');
        if (options.speed !== undefined && options.speed !== 'fast') throw new RangeError('speed must be "fast"');
        method = options.speed === 'fast' ? 1 : -1;
        scaled = options.speed === 'fast';
        if (!Number.isFinite(quality) || quality < 0 || quality > 100) throw new RangeError('quality must be 0–100');
        if (typeof lossless !== 'boolean') throw new TypeError('lossless must be boolean');
        return pipeline;
      },
      async bytes() {
        const args = [width, height, inside, withoutEnlargement, quality, lossless, maxPixels, method, scaled];
        const bytes = snapshot instanceof Blob ? new Uint8Array(await snapshot.arrayBuffer()) : snapshot;
        try { return optimize(bytes, ...args); }
        catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
      },
      async blob() { return new Blob([await pipeline.bytes()], { type: 'image/webp' }); },
    };
    return pipeline;
  };
}
