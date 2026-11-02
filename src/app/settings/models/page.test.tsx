// @vitest-environment node
import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import ApiKeysPage from "../api-keys/page";
it("keeps the old provider-settings URL as a compatibility redirect", () => {
  ApiKeysPage(); expect(mocks.redirect).toHaveBeenCalledWith("/settings/models?source=cloud");
});
