import { describe, expect, it } from "vitest";
import { getGalleryImageContentUrl } from "./gallery-image-content-url";

describe("getGalleryImageContentUrl", () => {
  it("returns the provider-neutral generated image content route", () => {
    expect(getGalleryImageContentUrl("image 1/2")).toBe(
      "/api/gallery/images/image%201%2F2/content",
    );
  });
});
