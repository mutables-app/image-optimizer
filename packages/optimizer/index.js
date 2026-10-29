import { optimize, optimize_jpeg } from './dist/optimizer.js';
import { createImage } from './pipeline.js';
export const image = createImage(optimize, optimize_jpeg);
