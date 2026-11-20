// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
const mock = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: mock.update }));
beforeEach(() => mock.update.mockReset().mockResolvedValue(new Response("session", { status: 401 })));
describe("Connect authentication boundary", () => {
  it.each(["/api/connect/claim", "/api/connect/device", "/api/connect/results", "/api/connect/results/upload"])("delegates only exact companion endpoint %s to its proof-auth handler", async path => {
    expect((await proxy(new NextRequest("https://kavero.example" + path))).status).toBe(200);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it.each(["/api/connect/devices", "/api/connect/pairings", "/api/connect/device/extra", "/api/connect/results/extra", "/api/connect/results/upload/extra", "/api/connect/claiming", "/dashboard", "/api/local-generation/models"])("preserves user-session handling for %s", async path => {
    expect((await proxy(new NextRequest("https://kavero.example" + path))).status).toBe(401);
    expect(mock.update).toHaveBeenCalledOnce();
  });
});
