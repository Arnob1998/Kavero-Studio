import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImagesZip, imageDownloadName } from "./image-export";

afterEach(() => vi.unstubAllGlobals());

describe("image exports", () => {
  it("keeps actual image formats and sanitizes filenames", () => {
    expect(imageDownloadName("mug", "image/jpeg")).toBe("mug.jpg");
    expect(imageDownloadName("mug", "image/png")).toBe("mug.png");
    expect(imageDownloadName("../page:one", "image/webp")).toBe("..-page-one.webp");
  });

  it("exports ordered mixed-format files without overwriting duplicate names", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })));
    const archive = await createImagesZip([
      { dataUrl: "first", mimeType: "image/png", name: "mug" },
      { dataUrl: "second", mimeType: "image/png", name: "mug" },
    ]);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["01-mug.jpg", "02-mug.png"]);
    expect(Array.from(files["01-mug.jpg"])).toEqual([255, 216, 255]);
    expect(Array.from(files["02-mug.png"])).toEqual([137, 80, 78, 71]);
  });

  it("rejects inaccessible images instead of silently exporting an incomplete ZIP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })));
    await expect(createImagesZip([{ dataUrl: "missing", mimeType: "image/png", name: "page" }])).rejects.toThrow("Unable to export image 1");
    await expect(createImagesZip([])).rejects.toThrow("No images");
  });

  it("rejects login pages returned with a success status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Sign in", { headers: { "content-type": "text/html" } })));
    await expect(createImagesZip([{ dataUrl: "redirected", mimeType: "image/jpeg", name: "frame" }])).rejects.toThrow("Image 1 is unavailable");
  });
});
