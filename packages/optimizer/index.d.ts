export interface ImagePipeline {
 resize(width?: number, height?: number, options?: {fit?: 'fill' | 'inside'; withoutEnlargement?: boolean}): ImagePipeline;
 webp(options?: {quality?: number; lossless?: boolean; method?: 0 | 1 | 2 | 3 | 4 | 5 | 6}): ImagePipeline;
 bytes(): Promise<Uint8Array>;
 blob(): Promise<Blob>;
}
export function image(input: Blob | ArrayBuffer | ArrayBufferView, options?: {maxPixels?: number}): ImagePipeline;
