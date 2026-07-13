import { createHash, createHmac } from "node:crypto";

export const KAVERO_ROUTING_CONTRACT_NAME = "kavero-litellm-routing";
export const KAVERO_ROUTING_CONTRACT_VERSION = "v1";
export const KAVERO_ROUTING_HEADER_VERSION = "x-kavero-routing-version";
export const KAVERO_ROUTING_HEADER_TIMESTAMP = "x-kavero-routing-timestamp";
export const KAVERO_ROUTING_HEADER_SIGNATURE = "x-kavero-routing-signature";

export function createRoutingCanonicalValue(input: {
  timestamp: number;
  method: string;
  pathname: string;
  bodyHash: string;
}) {
  return [
    KAVERO_ROUTING_CONTRACT_NAME,
    KAVERO_ROUTING_CONTRACT_VERSION,
    String(input.timestamp),
    input.method.toUpperCase(),
    input.pathname,
    input.bodyHash,
  ].join("\n");
}

export function hashRoutingBody(serializedBody: string) {
  return createHash("sha256").update(serializedBody, "utf8").digest("hex");
}

export function createRoutingSignature(input: {
  secret: string;
  timestamp: number;
  method: string;
  pathname: string;
  serializedBody: string;
}) {
  const canonicalValue = createRoutingCanonicalValue({
    timestamp: input.timestamp,
    method: input.method,
    pathname: input.pathname,
    bodyHash: hashRoutingBody(input.serializedBody),
  });

  return createHmac("sha256", input.secret).update(canonicalValue, "utf8").digest("hex");
}
