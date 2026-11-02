// @vitest-environment node
import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { validateLocalPNG, LOCAL_IMAGE_MAX_BYTES } from "./png";
// @ts-expect-error Native worker test fixture intentionally has no TypeScript declarations.
import { pngFixture, pngChunk } from "../../../../scripts/local-generation/png-fixture.mjs";

describe("Pinned final-image validation", () => {
  it("fully decodes a bounded final PNG and returns a checksum", () => {
    const info = validateLocalPNG(pngFixture());
    expect(info).toMatchObject({ width: 512, height: 512, mimeType: "image/png" });
    expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([1, 2, 3, 4])("decodes PNG filter %i", filter => expect(validateLocalPNG(pngFixture({ filter })).width).toBe(512));
  it.each([
    { width: 256 }, { height: 1024 }, { interlace: 1 }, { filter: 5 }, { extraRaw: 1 },
    { extraRaw: 4 * 1024 * 1024 }, { compressedTail: deflateSync(Buffer.from("second stream")) },
    { extraChunks: [pngChunk("acTL", Buffer.alloc(8))] }, { extraChunks: [pngChunk("ABCD")] },
  ])("rejects incompatible or unbounded PNG data %#", options => expect(() => validateLocalPNG(pngFixture(options))).toThrow());
  it("rejects corrupt CRC, truncation, trailing bytes and oversized encoded data", () => {
    const good = pngFixture(), corrupt = Buffer.from(good); corrupt[corrupt.length - 1] ^= 1;
    for (const bytes of [corrupt, good.subarray(0, -1), Buffer.concat([good, Buffer.from([0])]), Buffer.alloc(LOCAL_IMAGE_MAX_BYTES + 1)]) {
      expect(() => validateLocalPNG(bytes)).toThrow("invalid-local-image");
    }
  });
  it("rejects non-contiguous image chunks", () => {
    const good = pngFixture(), idatEnd = good.length - 12;
    const split = Buffer.concat([good.subarray(0, idatEnd), pngChunk("tEXt", Buffer.from("metadata")), pngChunk("IDAT"), good.subarray(idatEnd)]);
    expect(() => validateLocalPNG(split)).toThrow("invalid-local-image");
  });
});
