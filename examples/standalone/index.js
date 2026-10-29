import { image } from '@mutables.app/image-optimizer';
export default {
 async fetch(request) {
  if (request.method !== 'POST') return new Response('POST a JPEG or PNG\n', {status:405});
  try {
   if (!request.body) throw new Error('Expected image body');
   let total = 0;
   const bounded = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
     total += chunk.byteLength;
     if (total > 20 * 1024 * 1024) throw new RangeError('Input exceeds 20 MiB');
     controller.enqueue(chunk);
    }
   }));
   const input = await new Response(bounded).blob();
   return new Response(await image(input).resize(800,800,{fit:'inside',withoutEnlargement:true}).webp({quality:80}).blob());
  } catch (error) { return Response.json({error:String(error?.message ?? error)},{status:400}); }
 }
};
