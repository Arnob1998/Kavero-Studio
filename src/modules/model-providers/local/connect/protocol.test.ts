// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { claimMessage, connectOrigin, deviceMessage, publicIdentity, signConnect, verifyConnect } from "./protocol";

const pair = generateKeyPairSync("ed25519");
const pub = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
describe("Connect signed transport", () => {
  it("accepts only a canonical HTTPS origin or explicit loopback development", () => {
    expect(connectOrigin("https://kavero.example/")).toBe("https://kavero.example");
    expect(connectOrigin("http://127.0.0.1:3049", true)).toBe("http://127.0.0.1:3049");
    for (const url of ["http://kavero.example", "http://127.0.0.1:3049", "https://user@kavero.example", "https://kavero.example/other", "https://kavero.example/?x=1", "https://kavero.example/#x"]) expect(() => connectOrigin(url)).toThrow();
    expect(() => connectOrigin("http://192.168.0.1", true)).toThrow();
  });
  it("binds exact request bytes, origin, device, nonce and timestamp", () => {
    const fields = ["https://kavero.example", "device-a", "1790000000000", "nonce-a", '{"action":"status"}'] as const;
    const signature = signConnect(deviceMessage(...fields), pair.privateKey);
    expect(verifyConnect(deviceMessage(...fields), signature, pub)).toBe(true);
    for (let i = 0; i < fields.length; i++) {
      const changed: [string,string,string,string,string] = [...fields]; changed[i] += "x";
      expect(verifyConnect(deviceMessage(...changed), signature, pub)).toBe(false);
    }
  });
  it("binds a claim to the exact code, installation and public key", () => {
    const message = claimMessage("https://kavero.example", "code", "installation", pub, "device");
    const signature = signConnect(message, pair.privateKey);
    expect(verifyConnect(message, signature, pub)).toBe(true);
    expect(verifyConnect(claimMessage("https://other.example", "code", "installation", pub, "device"), signature, pub)).toBe(false);
    expect(verifyConnect(claimMessage("https://kavero.example", "other", "installation", pub, "device"), signature, pub)).toBe(false);
    expect(verifyConnect(claimMessage("https://kavero.example", "code", "other", pub, "device"), signature, pub)).toBe(false);
    expect(verifyConnect(claimMessage("https://kavero.example", "code", "installation", pub, "other-device"), signature, pub)).toBe(false);
  });
  it("rejects malformed keys/signatures without throwing verification", () => {
    expect(() => publicIdentity("a".repeat(59))).toThrow();
    expect(verifyConnect("message", "a".repeat(86), "a".repeat(59))).toBe(false);
    expect(verifyConnect("message", "bad", pub)).toBe(false);
    const other = generateKeyPairSync("ed25519");
    expect(verifyConnect("message", signConnect("message", other.privateKey), pub)).toBe(false);
  });
});
