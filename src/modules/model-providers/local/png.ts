import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const LOCAL_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function pngCRC(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Only the pinned engine's single, non-interlaced 512px RGB/RGBA PNG contract. */
export function validateLocalPNG(input: Uint8Array) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const reject = () => { throw new Error("invalid-local-image"); };
  if (bytes.length < 57 || bytes.length > LOCAL_IMAGE_MAX_BYTES || !bytes.subarray(0, 8).equals(signature)) reject();
  let offset = 8, channels = 0, ended = false, idatEnded = false, chunks = 0;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (++chunks > 1024 || offset + 12 > bytes.length) reject();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) reject();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || bytes.subarray(offset + 4, offset + 8).some(byte => byte > 127) || (bytes[offset + 6] & 32) !== 0) reject();
    if (pngCRC(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) reject();
    const data = bytes.subarray(offset + 8, end - 4);
    if (chunks === 1 && type !== "IHDR") reject();
    if (type === "IHDR") {
      if (chunks !== 1 || length !== 13 || data.readUInt32BE(0) !== 512 || data.readUInt32BE(4) !== 512
        || data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) reject();
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      if (idatEnded) reject();
      compressed.push(data);
    } else {
      if (compressed.length) idatEnded = true;
      if (type === "IEND") {
        if (length || !compressed.length || end !== bytes.length) reject();
        ended = true;
      } else if (["acTL", "fcTL", "fdAT"].includes(type) || (bytes[offset + 4] & 32) === 0) reject();
    }
    offset = end;
  }
  if (!ended || !channels) reject();
  const stride = 512 * channels, expected = (stride + 1) * 512;
  const packed = Buffer.concat(compressed);
  // Bound decompression before allocation; reject trailing/concatenated streams.
  // Node returns {buffer, engine} for info:true; @types/node still declares
  // only the default Buffer return. This exact host runtime is pinned.
  let inflated: { buffer: Buffer; engine: { bytesWritten: number } };
  try { inflated = inflateSync(packed, { maxOutputLength: expected, info: true }) as unknown as typeof inflated; }
  catch { return reject(); }
  const decoded = inflated.buffer;
  if (decoded.length !== expected || inflated.engine.bytesWritten !== packed.length) reject();
  const pixels = Buffer.alloc(stride * 512);
  for (let y = 0; y < 512; y++) {
    const filter = decoded[y * (stride + 1)];
    if (filter > 4) reject();
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x >= channels ? pixels[at - channels] : 0;
      const up = y ? pixels[at - stride] : 0, upperLeft = y && x >= channels ? pixels[at - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      pixels[at] = (decoded[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, width: 512 as const, height: 512 as const, mimeType: "image/png" as const };
}
