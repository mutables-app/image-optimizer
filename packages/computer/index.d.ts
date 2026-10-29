export interface WorkspaceFiles {
 fs: {
  readFile(path: string): Promise<ReadableStream<Uint8Array> | Uint8Array>;
  writeFile(path: string, value: Uint8Array): Promise<unknown>;
 };
}
export interface OptimizeOptions {
 width?: number; height?: number; fit?: 'inside' | 'fill'; withoutEnlargement?: boolean;
 quality?: number; lossless?: boolean; method?: 0 | 1 | 2 | 3 | 4 | 5 | 6; maxPixels?: number;
}
export function optimizeWorkspaceImage(workspace: WorkspaceFiles, inputPath: string, outputPath: string, options?: OptimizeOptions): Promise<{path: string; bytes: number; contentType: 'image/webp'}>;
