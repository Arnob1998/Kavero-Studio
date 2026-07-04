import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./editor-api";

describe("api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed JSON for successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "design-1" }))
    );

    await expect(api<{ id: string }>("GET", "/canvas/api/designs/design-1")).resolves.toEqual({
      id: "design-1",
    });
  });

  it("throws the API error message for failed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Not found" }, { status: 404 }))
    );

    await expect(api("GET", "/canvas/api/designs/missing")).rejects.toThrow("Not found");
  });
});
