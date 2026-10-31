import { deflateSync } from 'node:zlib';
import { pngCRC } from '../../src/modules/model-providers/local/png.ts';
export function pngChunk(type,data=Buffer.alloc(0)) {
  const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write(type,4,'ascii');data.copy(chunk,8);
  chunk.writeUInt32BE(pngCRC(chunk.subarray(4,-4)),chunk.length-4);return chunk;
}
export function pngFixture({width=512,height=512,color=123,filter=0,extraRaw=0,interlace=0,extraChunks=[],compressedTail=Buffer.alloc(0)}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;header[12]=interlace;
  const raw=Buffer.alloc((width*3+1)*height+extraRaw,color);
  for(let y=0;y<height;y++)raw[y*(width*3+1)]=filter;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),...extraChunks,pngChunk('IDAT',Buffer.concat([deflateSync(raw),compressedTail])),pngChunk('IEND')]);
}
