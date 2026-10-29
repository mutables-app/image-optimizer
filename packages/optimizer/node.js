import { optimize } from './dist/optimizer.node.js';
import { createImage } from './pipeline.js';
export const image = createImage(optimize);
