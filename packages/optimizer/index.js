import { optimize } from './dist/optimizer.js';
import { createImage } from './pipeline.js';
export const image = createImage(optimize);
