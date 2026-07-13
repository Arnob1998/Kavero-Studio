import { describe, expect, it } from "vitest";
import {
  createRoutingCanonicalValue,
  createRoutingSignature,
  hashRoutingBody,
} from "./routing-signature";

describe("LiteLLM routing signature", () => {
  it("hashes the exact serialized bytes and builds the versioned canonical value", () => {
    const serializedBody = '{"model":"alias","messages":[{"content":"héllo"}]}';
    const bodyHash = hashRoutingBody(serializedBody);

    expect(bodyHash).toBe("e93befcc2fb0f0eba95ecea23cc4bf76121e1e2a98d4d20ddcd15fdf8ccdfe88");
    expect(
      createRoutingCanonicalValue({
        timestamp: 1_750_000_000,
        method: "post",
        pathname: "/v1/chat/completions",
        bodyHash,
      }),
    ).toBe(
      [
        "kavero-litellm-routing",
        "v1",
        "1750000000",
        "POST",
        "/v1/chat/completions",
        bodyHash,
      ].join("\n"),
    );
  });

  it("creates a deterministic HMAC and changes it for body, path, or method changes", () => {
    const input = {
      secret: "routing-secret-012345678901234567890123456789",
      timestamp: 1_750_000_000,
      method: "POST",
      pathname: "/v1/chat/completions",
      serializedBody: '{"model":"alias"}',
    };
    const signature = createRoutingSignature(input);

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(createRoutingSignature(input)).toBe(signature);
    expect(createRoutingSignature({ ...input, serializedBody: '{"model":"changed"}' })).not.toBe(signature);
    expect(createRoutingSignature({ ...input, pathname: "/v1/images/generations" })).not.toBe(signature);
    expect(createRoutingSignature({ ...input, method: "PUT" })).not.toBe(signature);
  });
});
