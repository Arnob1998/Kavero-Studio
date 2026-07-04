import { createHmac, randomBytes } from "node:crypto";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function randomSecret(byteLength = 48) {
  return randomBytes(byteLength).toString("base64url");
}

export function signSupabaseJwt({ secret, role, now = Math.floor(Date.now() / 1000) }) {
  if (!secret || typeof secret !== "string") {
    throw new Error("A JWT secret is required.");
  }

  if (role !== "anon" && role !== "service_role") {
    throw new Error(`Unsupported Supabase role: ${role}`);
  }

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: "supabase",
    ref: "kavero-local",
    role,
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");

  return `${signingInput}.${signature}`;
}

export function createDockerSecrets({ now } = {}) {
  const postgresPassword = randomSecret(32);
  const jwtSecret = randomSecret(48);
  const anonKey = signSupabaseJwt({ secret: jwtSecret, role: "anon", now });
  const serviceRoleKey = signSupabaseJwt({ secret: jwtSecret, role: "service_role", now });

  return {
    POSTGRES_PASSWORD: postgresPassword,
    SUPABASE_JWT_SECRET: jwtSecret,
    SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
}
