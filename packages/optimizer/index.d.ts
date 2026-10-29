export interface ImagePipeline {
 resize(width?: number, height?: number, options?: {fit?: 'fill' | 'inside'; withoutEnlargement?: boolean}): ImagePipeline;
 webp(options?: {quality?: number; lossless?: boolean; /** Faster encoding; resized JPEGs also use scaled decoding when beneficial. */ speed?: 'fast'}): ImagePipeline;
 /** Baseline JPEG; transparent pixels are composited onto white. */
 jpeg(options?: {quality?: number; speed?: 'fast'}): ImagePipeline;
 bytes(): Promise<Uint8Array>;
 blob(): Promise<Blob>;
}
export function image(input: Blob | ArrayBuffer | ArrayBufferView, options?: {maxPixels?: number}): ImagePipeline;
