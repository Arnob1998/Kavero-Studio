import { afterEach, expect, it, vi } from "vitest";
import { localGenerationEnabled, localGenerationUIEnabled } from "./enabled";
afterEach(() => vi.unstubAllEnvs());
it("enables the normal UI without internal preview flags", () => {
  vi.stubEnv("KAVERO_LOCAL_GENERATION_ENABLED", "1");
  vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "0");
  vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "0");
  expect(localGenerationEnabled()).toBe(true);
  expect(localGenerationUIEnabled()).toBe(true);
});
it("respects explicit operator disable even with legacy flags", () => {
  vi.stubEnv("KAVERO_LOCAL_GENERATION_ENABLED", "0");
  vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "1");
  vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "1");
  expect(localGenerationEnabled()).toBe(false);
  expect(localGenerationUIEnabled()).toBe(false);
});
it("does not expose local generation by default", () => {
  vi.stubEnv("KAVERO_LOCAL_GENERATION_ENABLED", undefined);
  vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", undefined);
  vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", undefined);
  expect(localGenerationUIEnabled()).toBe(false);
});
