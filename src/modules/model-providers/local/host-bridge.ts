import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { signLocalBridgeRequest } from "./signature";

export async function localHostRequest(path: string, body: unknown) {
  const url = new URL(process.env.KAVERO_LOCAL_HOST_URL ?? "http://127.0.0.1:8792");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname)
    || url.port !== "8792" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw Error("local-host-config-invalid");
  const secret = process.env.KAVERO_LOCAL_HOST_SECRET ?? "";
  if (!/^[a-f0-9]{64}$/.test(secret)) throw Error("local-host-unconfigured");
  if (!["/host/status", "/host/activate", "/host/activation", "/host/activation/cancel", "/host/setup", "/host/setup/terms", "/host/setup/install", "/host/setup/status", "/host/setup/cancel", "/host/setup/access"].includes(path)) throw Error("local-host-action-invalid");
  const encoded = JSON.stringify(body), signed = signLocalBridgeRequest(secret, "POST", path, encoded);
  const response = await fetch(new URL(path, url), { method: "POST", headers: { "content-type": "application/json", ...signed }, body: encoded,
    signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store" });
  const reader = response.body?.getReader(); if (!reader) throw Error("local-host-response-invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
    if (size > (path === "/host/setup/terms" ? 256 * 1024 : 4096)) { await reader.cancel(); throw Error("local-host-response-invalid"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks), signature = response.headers.get("x-kavero-response") ?? "";
  const expected = createHmac("sha256", secret).update(signed["x-kavero-nonce"] + "\n" + createHash("sha256").update(bytes).digest("hex")).digest();
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw Error("local-host-response-invalid");
  return { status: response.status, body: JSON.parse(bytes.toString("utf8")) as unknown };
}
