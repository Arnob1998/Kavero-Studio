#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const requiredBuckets = [
  "canvas-assets",
  "kavero-generated-images",
  "kavero-generated-metadata",
  "kavero-canvas-assets",
];

const requiredFunctions = [
  "public.upsert_provider_key(uuid,text,text,text)",
  "public.get_provider_key(uuid,text)",
  "public.upsert_google_drive_connection(uuid,text,text,text,text,text)",
  "public.get_google_drive_refresh_token(uuid)",
  "public.disconnect_google_drive(uuid)",
];

const options = {
  host: process.env.PGHOST || "supabase-db",
  port: process.env.PGPORT || "5432",
  database: process.env.PGDATABASE || "postgres",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  schema: path.join(repoRoot, "supabase", "schema.sql"),
  foundation: path.join(repoRoot, "supabase", "local-foundation.sql"),
  authUrl: process.env.SUPABASE_AUTH_URL || "http://supabase-auth:9999",
  restUrl: process.env.SUPABASE_REST_URL || "http://supabase-rest:3000",
  storageUrl: process.env.SUPABASE_STORAGE_URL || "http://supabase-storage:5000",
  kongUrl: process.env.SUPABASE_KONG_URL || "",
  waitMs: Number(process.env.KAVERO_COMPOSE_BOOTSTRAP_WAIT_MS || "120000"),
  pollMs: Number(process.env.KAVERO_COMPOSE_BOOTSTRAP_POLL_MS || "1000"),
};

function assertValidNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(label, probe) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt <= options.waitMs) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }

    await sleep(options.pollMs);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${label} did not become ready within ${options.waitMs}ms.${suffix}`);
}

function psql(args, input) {
  const result = spawnSync("psql", args, {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: options.host,
      PGPORT: options.port,
      PGDATABASE: options.database,
      PGUSER: options.user,
      PGPASSWORD: options.password,
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `psql failed with exit code ${result.status}.`);
  }

  return result.stdout.trim();
}

function queryScalar(sql) {
  return psql(["-v", "ON_ERROR_STOP=1", "-tAc", sql]);
}

function applySql(label, filePath) {
  if (!existsSync(filePath)) throw new Error(`${label} SQL file does not exist: ${filePath}`);

  const sql = readFileSync(filePath, "utf8");
  psql(["-v", "ON_ERROR_STOP=1", "-f", "-"], sql);
}

function isTruthySqlValue(value) {
  return value === "t" || value === "true" || value === "1";
}

async function fetchOk(url, init) {
  const response = await fetch(url, init);
  return response.ok;
}

function verifyKeysAreUsable() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!publishableKey || publishableKey.startsWith("replace-with-")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a real local Supabase JWT before bootstrap can verify services.");
  }

  if (!serviceRoleKey || serviceRoleKey.startsWith("replace-with-")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be a real local Supabase service-role JWT before bootstrap can verify services.");
  }
}

async function main() {
  assertValidNumber(options.waitMs, "KAVERO_COMPOSE_BOOTSTRAP_WAIT_MS");
  assertValidNumber(options.pollMs, "KAVERO_COMPOSE_BOOTSTRAP_POLL_MS");
  verifyKeysAreUsable();

  console.log("Waiting for Postgres...");
  await waitFor("Postgres", () => {
    const ready = queryScalar("select true;");
    return isTruthySqlValue(ready);
  });

  console.log("Waiting for Auth and Storage database prerequisites...");
  await waitFor("auth.users", () => isTruthySqlValue(queryScalar("select to_regclass('auth.users') is not null;")));
  await waitFor("storage.buckets", () => isTruthySqlValue(queryScalar("select to_regclass('storage.buckets') is not null;")));
  await waitFor("storage.buckets metadata columns", () =>
    isTruthySqlValue(
      queryScalar(
        "select count(*) = 3 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name in ('public', 'file_size_limit', 'allowed_mime_types');",
      ),
    ),
  );

  console.log("Applying supabase/schema.sql...");
  applySql("schema", options.schema);

  console.log("Applying supabase/local-foundation.sql...");
  applySql("local foundation", options.foundation);

  console.log("Verifying required extensions...");
  const extensions = queryScalar(
    "select count(*) = 2 from pg_extension where extname in ('pgcrypto', 'supabase_vault');",
  );
  if (!isTruthySqlValue(extensions)) throw new Error("Required extensions are not installed.");

  console.log("Verifying required buckets...");
  const bucketList = requiredBuckets.map((bucket) => `'${bucket}'`).join(",");
  const buckets = queryScalar(`select count(*) = ${requiredBuckets.length} from storage.buckets where id in (${bucketList});`);
  if (!isTruthySqlValue(buckets)) throw new Error(`Missing required buckets: ${requiredBuckets.join(", ")}`);

  console.log("Verifying required RPC functions and service-role grants...");
  for (const signature of requiredFunctions) {
    const exists = queryScalar(`select to_regprocedure('${signature}') is not null;`);
    if (!isTruthySqlValue(exists)) throw new Error(`Missing required function: ${signature}`);

    const canExecute = queryScalar(`select has_function_privilege('service_role', '${signature}', 'execute');`);
    if (!isTruthySqlValue(canExecute)) {
      throw new Error(`service_role cannot execute required function: ${signature}`);
    }
  }

  console.log("Waiting for Auth reachability...");
  await waitFor("Auth", () => fetchOk(`${options.authUrl}/health`));

  console.log("Waiting for PostgREST reachability...");
  await waitFor("PostgREST", () =>
    fetchOk(`${options.restUrl}/`, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      },
    }),
  );

  console.log("Waiting for Storage reachability...");
  await waitFor("Storage", () => fetchOk(`${options.storageUrl}/status`));

  if (options.kongUrl) {
    console.log("Waiting for Kong gateway reachability...");
    await waitFor("Kong gateway", () => fetchOk(`${options.kongUrl}/auth/v1/health`));
  }

  console.log("Supabase Compose bootstrap completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
