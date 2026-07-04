import { describe, expect, it } from "vitest";
import { parseBase64DataUrl } from "./data-url";

describe("parseBase64DataUrl", () => {
  it("parses valid base64 data URLs", () => {
    expect(parseBase64DataUrl("data:image/png;base64,AAAA")).toEqual({
      mimeType: "image/png",
      data: "AAAA",
    });
  });

  it("returns null for invalid data URLs", () => {
    expect(parseBase64DataUrl("image/png;base64,AAAA")).toBeNull();
    expect(parseBase64DataUrl("data:image/png,AAAA")).toBeNull();
  });
});
