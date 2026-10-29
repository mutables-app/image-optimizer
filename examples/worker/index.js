import { DurableObject } from 'cloudflare:workers';
import { withWorkspace, getWorkspace } from '@cloudflare/computer';
import { image } from '@mutables.app/image-optimizer';
import { optimizeWorkspaceImage } from '@mutables.app/image-computer';

export class ImageWorkspace extends withWorkspace(
  class extends DurableObject {},
  self => ({ storage: self.ctx.storage }),
) {}

function number(value) {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Expected a finite number');
  return parsed;
}
// A local integration example. Add application authentication before deployment.
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/optimize' && request.method === 'POST') {
        const input = await boundedBody(request);
        const pipeline = image(input);
        const width = number(url.searchParams.get('width'));
        const height = number(url.searchParams.get('height'));
        if (width !== undefined || height !== undefined) pipeline.resize(width, height, {fit: url.searchParams.get('fit') ?? 'inside', withoutEnlargement: true});
        const result = await pipeline.webp({ quality: number(url.searchParams.get('quality')), method: number(url.searchParams.get('method')) }).bytes();
        return new Response(result, {headers: {'content-type': 'image/webp'}});
      }
      const match = url.pathname.match(/^\/workspaces\/([a-zA-Z0-9_-]+)\/(files\/.*|optimize)$/);
      if (match) {
        const workspace = await getWorkspace(env.IMAGES.get(env.IMAGES.idFromName(match[1])));
        try {
          if (match[2] === 'optimize' && request.method === 'POST') {
            const {input, output, ...options} = await request.json();
            return Response.json(await optimizeWorkspaceImage(workspace, input, output, options));
          }
          if (match[2].startsWith('files/')) {
            const path = '/' + decodeURIComponent(match[2].slice(6));
            if (path.split('/').includes('..')) throw new Error('Invalid path');
            if (request.method === 'PUT') {
              await workspace.fs.writeFile(path, await boundedBody(request));
              return new Response(null, {status: 204});
            }
            if (request.method === 'GET') return new Response(await workspace.fs.readFile(path), {headers: {'content-type': path.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'}});
          }
        } finally { workspace[Symbol.dispose](); }
      }
      return new Response('POST /optimize or use /workspaces/:id/files/:path and /workspaces/:id/optimize\n', {status: 404});
    } catch (error) {
      return Response.json({error: String(error?.message ?? error)}, {status: 400});
    }
  },
};
async function boundedBody(request) {
  if (!request.body) throw new Error('Expected image body');
  const reader = request.body.getReader(); let total = 0; const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('Input exceeds 20 MiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
