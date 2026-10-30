// Small deterministic fixtures, including an Adam7 PNG used to verify rejection.
import {deflateSync, crc32} from 'node:zlib';
function chunk(name,data) {
 const type=Buffer.from(name), size=Buffer.alloc(4), crc=Buffer.alloc(4);
 size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
 return Buffer.concat([size,type,data,crc]);
}
export function rgbaPng(width,height,pixel,interlaced=false) {
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;header[12]=Number(interlaced);
 const rows=[];
 const passes=interlaced ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
 for(const [x0,y0,dx,dy] of passes) for(let y=y0;y<height && x0<width;y+=dy) {
  const row=[0]; for(let x=x0;x<width;x+=dx) row.push(...pixel(x,y)); rows.push(Buffer.from(row));
 }
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
export function specialPng(kind) {
 const width=3,height=2,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);
 header[8]=kind==='gray16'?16:8;header[9]=kind==='gray16'?0:3;
 const extras=kind==='gray16'?[]:[chunk('PLTE',Buffer.from([255,0,0,0,255,0,0,0,255])),chunk('tRNS',Buffer.from([0,128,255]))];
 const row=kind==='gray16'?Buffer.from([0,0,0,128,0,255,255]):Buffer.from([0,0,1,2]);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),...extras,chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
