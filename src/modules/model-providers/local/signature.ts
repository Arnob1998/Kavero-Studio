import { createHash, createHmac, randomUUID } from "node:crypto";

export function signLocalBridgeRequest(secret: string, method: string, path: string, body: string) {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(["kavero-local-v1", method, path, timestamp, nonce, digest].join("\n")).digest("hex");
  return { "x-kavero-time": timestamp, "x-kavero-nonce": nonce, "x-kavero-signature": signature };
}
