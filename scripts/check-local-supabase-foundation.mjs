#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const requiredBuckets = [
  "canvas-assets",
  "kavero-generated-images",
  "kavero-generated-metadata",
  "kavero-canvas-assets",
];

const defaultBootstrapWaitMs = 5000;
const bootstrapPollIntervalMs = 100;

function printHelp() {
  console.log(`Kavero local Supabase foundation smoke

Verifies a running local Supabase stack for Kavero's narrow 7B foundation:
Auth signup/signin, DB/PostgREST access, RLS owner isolation, Storage bucket
readiness, and service-role Vault-backed RPC compatibility.

Usage:
  node scripts/check-local-supabase-foundation.mjs

Required environment:
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY

Optional environment:
  KAVERO_LOCAL_SMOKE_BOOTSTRAP_WAIT_MS  Total wait for trigger-created rows. Default: ${defaultBootstrapWaitMs}

Recommended local environment:
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  KAVERO_AUTH_MODE=password
`);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return { createClient };
}

function createClients(createClient, url, publishableKey, serviceRoleKey) {
  const baseAuth = {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  };

  return {
    anon: createClient(url, publishableKey, { auth: baseAuth }),
    service: createClient(url, serviceRoleKey, { auth: baseAuth }),
  };
}

async function signUpDisposableUser(client, prefix) {
  const email = `${prefix}-${Date.now()}-${randomUUID()}@example.local`;
  const password = `Kavero-local-${randomUUID()}-7B!`;

  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`Password signup failed: ${signUp.error.message}`);

  let session = signUp.data.session;
  let user = signUp.data.user;

  if (!session || !user) {
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) {
      throw new Error(`Password signin after signup failed: ${signIn.error.message}`);
    }
    session = signIn.data.session;
    user = signIn.data.user;
  }

  assert(user?.id, "Password signup/signin did not return a user.");
  assert(session?.access_token, "Password signup/signin did not return a session.");

  return { email, password, user, session };
}

function authedClient(createClient, url, publishableKey, accessToken) {
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function expectNoError(label, resultPromise) {
  const result = await resultPromise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function getBootstrapWaitMs() {
  const rawValue = process.env.KAVERO_LOCAL_SMOKE_BOOTSTRAP_WAIT_MS?.trim();
  if (!rawValue) return defaultBootstrapWaitMs;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("KAVERO_LOCAL_SMOKE_BOOTSTRAP_WAIT_MS must be a non-negative number.");
  }

  return Math.floor(value);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollForTriggerRow({ query, isExpectedRow, missingMessage, waitMs }) {
  const startedAt = Date.now();

  while (true) {
    const result = await query();
    if (result.error) throw result.error;

    if (result.data) {
      if (!isExpectedRow(result.data)) throw new Error(missingMessage);
      return result.data;
    }

    if (Date.now() - startedAt >= waitMs) {
      throw new Error(missingMessage);
    }

    await sleep(Math.min(bootstrapPollIntervalMs, waitMs - (Date.now() - startedAt)));
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bootstrapWaitMs = getBootstrapWaitMs();

  const { createClient } = await loadSupabase();
  const { anon, service } = createClients(createClient, url, publishableKey, serviceRoleKey);
  const cleanup = { userIds: [], promptTemplateIds: [] };

  try {
    console.log("Checking Auth password signup/signin...");
    const primary = await signUpDisposableUser(anon, "kavero-local-smoke-primary");
    cleanup.userIds.push(primary.user.id);
    const primaryClient = authedClient(createClient, url, publishableKey, primary.session.access_token);

    console.log("Checking auth.users trigger bootstrap...");
    const profile = await pollForTriggerRow({
      query: () => service.from("profiles").select("id, email").eq("id", primary.user.id).maybeSingle(),
      isExpectedRow: (row) => row.id === primary.user.id,
      missingMessage: "profiles row was not created for signed-up user.",
      waitMs: bootstrapWaitMs,
    });

    const metadata = await pollForTriggerRow({
      query: () =>
        service.from("user_metadata").select("user_id, plan").eq("user_id", primary.user.id).maybeSingle(),
      isExpectedRow: (row) => row.user_id === primary.user.id,
      missingMessage: "user_metadata row was not created for signed-up user.",
      waitMs: bootstrapWaitMs,
    });
    assert(metadata.plan === "free", "user_metadata default plan is not free.");

    console.log("Checking RLS owner insert/read and isolation...");
    const ownerTemplate = await expectNoError(
      "owner prompt template insert failed",
      primaryClient
        .from("prompt_templates")
        .insert({
          user_id: primary.user.id,
          name: "Local smoke owner template",
          prompt: "Owner-visible local smoke prompt",
        })
        .select("id")
        .single(),
    );
    cleanup.promptTemplateIds.push(ownerTemplate.id);

    const secondary = await signUpDisposableUser(anon, "kavero-local-smoke-secondary");
    cleanup.userIds.push(secondary.user.id);
    const otherTemplate = await expectNoError(
      "service prompt template insert failed",
      service
        .from("prompt_templates")
        .insert({
          user_id: secondary.user.id,
          name: "Local smoke isolated template",
          prompt: "Other-user local smoke prompt",
        })
        .select("id")
        .single(),
    );
    cleanup.promptTemplateIds.push(otherTemplate.id);

    const ownerRead = await expectNoError(
      "owner prompt template read failed",
      primaryClient.from("prompt_templates").select("id").eq("id", ownerTemplate.id).maybeSingle(),
    );
    assert(ownerRead?.id === ownerTemplate.id, "Owner could not read owned prompt template.");

    const crossUserRead = await expectNoError(
      "cross-user prompt template read failed",
      primaryClient.from("prompt_templates").select("id").eq("id", otherTemplate.id).maybeSingle(),
    );
    assert(crossUserRead === null, "Owner RLS allowed reading another user's prompt template.");

    const anonRead = await expectNoError(
      "anon prompt template read failed",
      anon.from("prompt_templates").select("id").eq("id", ownerTemplate.id).maybeSingle(),
    );
    assert(anonRead === null, "Anon RLS allowed reading a user prompt template.");

    console.log("Checking service-role provider-key Vault RPCs...");
    const providerSecret = `local-smoke-provider-secret-${randomUUID()}`;
    await expectNoError(
      "upsert_provider_key RPC failed",
      service.rpc("upsert_provider_key", {
        p_user_id: primary.user.id,
        p_provider_id: "google-gemini",
        p_secret: providerSecret,
        p_key_hint: "...test",
      }),
    );
    const providerRoundTrip = await expectNoError(
      "get_provider_key RPC failed",
      service.rpc("get_provider_key", {
        p_user_id: primary.user.id,
        p_provider_id: "google-gemini",
      }),
    );
    assert(providerRoundTrip === providerSecret, "Provider-key Vault RPC did not round trip the secret.");

    const unauthorizedProviderRead = await primaryClient.rpc("get_provider_key", {
      p_user_id: primary.user.id,
      p_provider_id: "google-gemini",
    });
    assert(
      Boolean(unauthorizedProviderRead.error),
      "Authenticated client unexpectedly executed get_provider_key.",
    );

    console.log("Checking service-role Google Drive token Vault RPC compatibility...");
    const driveSecret = `local-smoke-drive-refresh-token-${randomUUID()}`;
    await expectNoError(
      "upsert_google_drive_connection RPC failed",
      service.rpc("upsert_google_drive_connection", {
        p_user_id: primary.user.id,
        p_refresh_token: driveSecret,
        p_google_email: "local-smoke@example.local",
        p_folder_id: "local-smoke-folder",
        p_folder_name: "Kavero Local Smoke",
        p_scope: "https://www.googleapis.com/auth/drive.file",
      }),
    );
    const driveRoundTrip = await expectNoError(
      "get_google_drive_refresh_token RPC failed",
      service.rpc("get_google_drive_refresh_token", { p_user_id: primary.user.id }),
    );
    assert(driveRoundTrip === driveSecret, "Drive-token Vault RPC did not round trip the secret.");

    await expectNoError(
      "disconnect_google_drive RPC failed",
      service.rpc("disconnect_google_drive", { p_user_id: primary.user.id }),
    );

    console.log("Checking Storage bucket readiness...");
    const buckets = await expectNoError("storage bucket list failed", service.storage.listBuckets());
    const bucketIds = new Set(buckets.map((bucket) => bucket.id));
    const missingBuckets = requiredBuckets.filter((bucket) => !bucketIds.has(bucket));
    assert(missingBuckets.length === 0, `Missing required buckets: ${missingBuckets.join(", ")}`);

    console.log("Local Supabase foundation smoke passed.");
  } finally {
    const warnings = [];

    if (cleanup.promptTemplateIds.length > 0) {
      const result = await service.from("prompt_templates").delete().in("id", cleanup.promptTemplateIds);
      if (result.error) warnings.push(`Prompt template cleanup failed: ${result.error.message}`);
    }

    for (const userId of cleanup.userIds) {
      const result = await service.auth.admin.deleteUser(userId);
      if (result.error) warnings.push(`User cleanup failed for ${userId}: ${result.error.message}`);
    }

    for (const warning of warnings) console.warn(warning);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
