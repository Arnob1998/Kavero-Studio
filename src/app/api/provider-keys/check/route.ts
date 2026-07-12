import { NextResponse } from "next/server";
import {
  parseProviderCredentialPayload,
  providerKeyRegistry,
  type ProviderCredentials,
  type SupportedProviderId,
} from "@/lib/provider-key-registry";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = parseProviderCredentialPayload(await request.json().catch(() => null));

  if (!parsed) {
    return NextResponse.json({ error: "Invalid provider key check." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const registryEntry = providerKeyRegistry[parsed.providerId];
  const failureMessage = `${parsed.providerId === "google-gemini" ? "Gemini" : registryEntry.label} key check failed.`;

  if (registryEntry.checkMode === "validation-only") {
    return NextResponse.json({
      status: "validation_only",
      checkedAt,
      check: "not_implemented",
      message: `${registryEntry.label} credentials passed local validation. Live check is not available yet.`,
    });
  }

  try {
    const response = await checkProviderCredentials(parsed.providerId, parsed.credentials);

    if (response.ok) {
      return NextResponse.json({
        status: "passed",
        checkedAt,
      });
    }

    return NextResponse.json({
      status: "failed",
      checkedAt,
      code: response.status === 401 || response.status === 403 ? "authentication_error" : "provider_error",
      message: failureMessage,
    });
  } catch {
    return NextResponse.json({
      status: "failed",
      checkedAt,
      code: "network_error",
      message: failureMessage,
    });
  }
}

function checkProviderCredentials(providerId: SupportedProviderId, credentials: ProviderCredentials) {
  const apiKey = (credentials as { apiKey: string }).apiKey;

  if (providerId === "google-gemini") {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", apiKey);
    return fetch(url, { method: "GET" });
  }

  const url = providerId === "openai" ? "https://api.openai.com/v1/models" : "https://api.groq.com/openai/v1/models";
  return fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}
