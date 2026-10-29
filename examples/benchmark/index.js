import { image } from '@mutables.app/image-optimizer';
function integer(value, fallback, max) {
 const n = value === null ? fallback : Number(value);
 if (!Number.isInteger(n) || n < 1 || n > max) throw new RangeError(`Expected integer 1–${max}`);
 return n;
}
export default {
 async fetch(request, env) {
  if (request.method === 'GET' && new URL(request.url).pathname === '/health') return Response.json({ok:true,engine:'Rust/Emscripten + libjpeg-turbo/libspng/libwebp',version:'0.1.0'});
  if (!env.BENCHMARK_TOKEN || request.headers.get('authorization') !== `Bearer ${env.BENCHMARK_TOKEN}`) return new Response('Unauthorized', {status:401});
  if (request.method !== 'POST') return new Response('POST an image', {status:405});
  try {
   const url = new URL(request.url);
   const width = integer(url.searchParams.get('width'),800,4096);
   const height = integer(url.searchParams.get('height'),800,4096);
   const quality = integer(url.searchParams.get('quality'),80,100);
   if (!request.body) throw new Error('Expected image bytes');
   let total = 0;
   const bounded = request.body.pipeThrough(new TransformStream({transform(chunk, controller) {
    total += chunk.byteLength; if (total > 20*1024*1024) throw new RangeError('Input exceeds 20 MiB');
    controller.enqueue(chunk);
   }}));
   const input = new Uint8Array(await new Response(bounded).arrayBuffer());
   const start = performance.now();
   const output = await image(input).resize(width,height,{fit:'inside',withoutEnlargement:true}).webp({quality,lossless:url.searchParams.get('lossless') === 'true'}).bytes();
   // Workers may freeze timers during synchronous CPU work. This is diagnostic,
   // not a CPU measurement; use client timings and Workers CPU analytics.
   const elapsed = performance.now()-start;
   return new Response(output,{headers:{
    'content-type':'image/webp','cache-control':'no-store',
    'x-input-bytes':String(input.length),'x-output-bytes':String(output.length),
    'x-observed-transform-ms':String(elapsed),
    'x-worker-colo':request.cf?.colo ?? 'local',
   }});
  } catch(error) { return Response.json({error:String(error?.message ?? error)},{status:400}); }
 }
};
