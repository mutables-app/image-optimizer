import { image } from '@mutables.app/image-optimizer';
export async function optimizeWorkspaceImage(workspace, inputPath, outputPath, options = {}) {
  for (const path of [inputPath, outputPath]) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')) throw new TypeError('Use absolute workspace paths without ..');
  }
  if (inputPath === outputPath) throw new Error('Input and output paths must differ');
  const source = await workspace.fs.readFile(inputPath);
  // Computer returns a byte stream for binary reads. Bound it before buffering.
  let input;
  if (source instanceof ReadableStream) {
    const reader = source.getReader(); const chunks = []; let total = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > 20 * 1024 * 1024) { await reader.cancel(); throw new RangeError('Input exceeds 20 MiB'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    input = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  } else input = source;
  const pipeline = image(input, { maxPixels: options.maxPixels });
  if (options.width !== undefined || options.height !== undefined) pipeline.resize(options.width, options.height, {fit: options.fit ?? 'inside', withoutEnlargement: options.withoutEnlargement ?? true});
  const output = await pipeline.webp({quality: options.quality, lossless: options.lossless, speed: options.speed}).bytes();
  await workspace.fs.writeFile(outputPath, output);
  return {path: outputPath, bytes: output.byteLength, contentType: 'image/webp'};
}
