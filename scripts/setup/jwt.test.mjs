import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDockerSecrets, randomSkSecret, signSupabaseJwt } from "./jwt.mjs";

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("setup JWT helpers", () => {
  it("creates signed anon and service-role Supabase JWTs", () => {
    const secret = "test-secret";
    const token = signSupabaseJwt({ secret, role: "service_role", now: 100 });
    const [headerSegment, payloadSegment, signature] = token.split(".");

    expect(decodeSegment(headerSegment)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodeSegment(payloadSegment)).toMatchObject({
      iss: "supabase",
      ref: "kavero-local",
      role: "service_role",
      iat: 100,
    });

    const expectedSignature = createHmac("sha256", secret)
      .update(`${headerSegment}.${payloadSegment}`)
      .digest("base64url");
    expect(signature).toBe(expectedSignature);
  });

  it("creates sk-prefixed LiteLLM secrets for Docker setup", () => {
    expect(randomSkSecret()).toMatch(/^sk-[A-Za-z0-9_-]+$/);

    const secrets = createDockerSecrets({ now: 100 });
    expect(secrets.LITELLM_MASTER_KEY).toMatch(/^sk-/);
    expect(secrets.KAVERO_LITELLM_API_KEY).toBe(secrets.LITELLM_MASTER_KEY);
    expect(secrets.KAVERO_LITELLM_ROUTING_SECRET).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(secrets.KAVERO_LITELLM_ROUTING_SECRET).not.toBe(secrets.LITELLM_MASTER_KEY);
  });
});
