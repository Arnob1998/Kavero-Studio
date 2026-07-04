import { describe, expect, it } from "vitest";
import {
  getBrowserSupabaseUrl,
  getServerSupabaseUrl,
  getSupabaseAuthCookieName,
  requireServerSupabaseUrl,
} from "./url";

describe("Supabase URL resolution", () => {
  it("keeps browser clients on the public Supabase URL", () => {
    expect(
      getBrowserSupabaseUrl(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
      })),
    ).toBe("http://127.0.0.1:54321");
  });

  it("uses the internal Supabase URL for server clients when present", () => {
    expect(
      getServerSupabaseUrl(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
      })),
    ).toBe("http://supabase-kong:8000");
  });

  it("falls back to the public Supabase URL for server clients", () => {
    expect(
      getServerSupabaseUrl(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      })),
    ).toBe("http://127.0.0.1:54321");
  });

  it("treats a blank internal Supabase URL as absent", () => {
    expect(
      getServerSupabaseUrl(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_INTERNAL_URL: "   ",
      })),
    ).toBe("http://127.0.0.1:54321");
  });

  it("throws a clear error when no server URL is configured", () => {
    expect(() => requireServerSupabaseUrl(testEnv({}))).toThrow(
      "Supabase URL is not configured.",
    );
  });

  it("derives the auth cookie name from the public Supabase URL", () => {
    expect(
      getSupabaseAuthCookieName(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
      })),
    ).toBe("sb-127-auth-token");

    expect(
      getSupabaseAuthCookieName(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
      })),
    ).toBe("sb-project-ref-auth-token");
  });

  it("returns no auth cookie name when the public Supabase URL is missing or invalid", () => {
    expect(getSupabaseAuthCookieName(testEnv({}))).toBeUndefined();
    expect(
      getSupabaseAuthCookieName(testEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
      })),
    ).toBeUndefined();
  });
});

function testEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values } as NodeJS.ProcessEnv;
}
