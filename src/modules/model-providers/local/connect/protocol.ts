import { createHash, createPublicKey, sign, verify, type KeyLike } from "node:crypto";

export const CONNECT_VERSION = 1;
export const CONNECT_DEVICE_PATH = "/api/connect/device";
export const CONNECT_CLAIM_PATH = "/api/connect/claim";
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function connectOrigin(value: string, allowLoopback = false): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw Error("invalid-connect-origin");
  return url.origin;
}

export function publicIdentity(value: string) {
  if (!/^[A-Za-z0-9_-]{59}$/.test(value)) throw Error("invalid-device-key");
  const bytes = Buffer.from(value, "base64url");
  const key = createPublicKey({ key: bytes, type: "spki", format: "der" });
  if (key.asymmetricKeyType !== "ed25519" || bytes.toString("base64url") !== value) throw Error("invalid-device-key");
  return key;
}

export function claimMessage(origin: string, code: string, installation: string, publicKey: string, device: string) {
  return ["kavero-connect-claim-v1", origin, digest(code), installation, publicKey, device].join("\n");
}

export function deviceMessage(origin: string, device: string, timestamp: string, nonce: string, body: string) {
  return ["kavero-connect-v1", origin, "POST", CONNECT_DEVICE_PATH, device, timestamp, nonce, digest(body)].join("\n");
}

export function signConnect(message: string, key: KeyLike) {
  return sign(null, Buffer.from(message), key).toString("base64url");
}

export function verifyConnect(message: string, signature: string, publicKey: string) {
  try {
    return /^[A-Za-z0-9_-]{86}$/.test(signature)
      && verify(null, Buffer.from(message), publicIdentity(publicKey), Buffer.from(signature, "base64url"));
  } catch { return false; }
}
