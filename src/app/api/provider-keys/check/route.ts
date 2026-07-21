import { NextResponse } from "next/server";
import {
  parseProviderCredentialPayload,
  providerKeyRegistry,
  type ProviderCredentials,
  type SupportedProviderId,
} from "@/lib/provider-key-registry";
import { createClient } from "@/lib/supabase/server";
import {
  createLiteLlmClient,
  getModelGatewayConfig,
  isModelGatewayError,
} from "@/modules/model-providers";
import { buildAzureOpenAiImageGenerationUrl, buildAzureOpenAiLiteLlmRequest } from "@/modules/model-providers/server";

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

async function checkProviderCredentials(providerId: SupportedProviderId, credentials: ProviderCredentials) {
  if (providerId === "azure-openai-image") {
    const url = buildAzureOpenAiImageGenerationUrl(credentials);
    if (!url) return { ok: false, status: 400 };
    const imageCredentials = credentials as { apiKey: string };
    const response = await fetch(url, {
      method: "POST",
      headers: { "api-key": imageCredentials.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A minimal blue circle on a plain white background",
        n: 1,
        size: "1024x1024",
        quality: "low",
        output_format: "png",
      }),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: unknown }> } | null;
    return {
      ok: Boolean(payload?.data?.length === 1 && typeof payload.data[0]?.b64_json === "string"),
      status: 200,
    };
  }

  if (providerId === "azure-openai") {
    const config = getModelGatewayConfig();
    if (config.status !== "configured") return { ok: false, status: 503 };

    const request = buildAzureOpenAiLiteLlmRequest(
      {
        model: "kavero-chat-azure-openai",
        max_tokens: 256,
        messages: [{ role: "user", content: "Connectivity check" }],
      },
      credentials,
    );
    if (!request) return { ok: false, status: 400 };

    try {
      await createLiteLlmClient({ config }).chatCompletions(request.body, {
        provider: "azure-openai",
        model: request.monitoringModel,
        modelAlias: "kavero-chat-azure-openai",
      });
      return { ok: true, status: 200 };
    } catch (error) {
      return {
        ok: false,
        status: isModelGatewayError(error) ? error.details.status ?? 502 : 502,
      };
    }
  }

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
