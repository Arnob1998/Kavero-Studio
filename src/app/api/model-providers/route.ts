import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  getSafeGatewayStatus,
  mergeModelProviderPreferences,
} from "@/modules/model-providers";
import { createClient } from "@/lib/supabase/server";
import { getModelGatewayCredentialMode } from "@/modules/model-providers/server/credential-mode";
import { getAvailableBrowserModelCatalog } from "@/modules/model-providers/server/model-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupportedProviderId } from "@/lib/provider-key-registry";

const modelProviderSettingsSchema = z
  .object({
    chatOrchestrationModelAlias: z.string().trim().min(1).max(200).optional(),
    imageGenerationModelAlias: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) => value.chatOrchestrationModelAlias || value.imageGenerationModelAlias,
    "At least one model alias is required.",
  );

type UserMetadataRow = {
  preferences: unknown;
};

function settingsPayload(preferences: unknown, activeProviderKeyIds: ReadonlySet<SupportedProviderId>) {
  const selection = getResolvedModelProviderPreferences(preferences);
  const gatewayConfig = getModelGatewayConfig();
  const credentialMode = getModelGatewayCredentialMode();

  return {
    gateway: getSafeGatewayStatus(gatewayConfig),
    credentialMode,
    catalog: getAvailableBrowserModelCatalog({ gateway: gatewayConfig, credentialMode, activeProviderKeyIds }),
    defaults: {
      chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    },
    selected: selection,
    ...selection,
  };
}

async function loadActiveProviderKeyIds(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_provider_keys")
    .select("provider_id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) throw new Error("Unable to load provider availability.");
  return new Set((data ?? []).map((row) => row.provider_id as SupportedProviderId));
}

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { supabase, user };
}

async function loadPreferences(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data, error } = await supabase
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<UserMetadataRow>();

  if (error) {
    console.error("Unable to load model-provider preferences", error);
    throw new Error("Unable to load model-provider preferences.");
  }

  return data?.preferences ?? {};
}

export async function GET() {
  const context = await getAuthenticatedContext();
  if ("response" in context) return context.response;

  try {
    const [preferences, activeProviderKeyIds] = await Promise.all([
      loadPreferences(context.supabase, context.user.id),
      loadActiveProviderKeyIds(context.user.id),
    ]);
    return NextResponse.json(settingsPayload(preferences, activeProviderKeyIds));
  } catch {
    return NextResponse.json({ error: "Unable to load model-provider settings." }, { status: 500 });
  }
}

async function save(request: Request) {
  const parsed = modelProviderSettingsSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid model-provider settings." }, { status: 400 });
  }

  const context = await getAuthenticatedContext();
  if ("response" in context) return context.response;

  try {
    const [currentPreferences, activeProviderKeyIds] = await Promise.all([
      loadPreferences(context.supabase, context.user.id),
      loadActiveProviderKeyIds(context.user.id),
    ]);
    const gatewayConfig = getModelGatewayConfig();
    const credentialMode = getModelGatewayCredentialMode();
    const catalog = getAvailableBrowserModelCatalog({ gateway: gatewayConfig, credentialMode, activeProviderKeyIds });
    const requestedAliases = [
      parsed.data.chatOrchestrationModelAlias,
      parsed.data.imageGenerationModelAlias,
    ].filter((value): value is string => Boolean(value));
    const unavailable = requestedAliases
      .map((alias) => catalog.find((model) => model.modelAlias === alias))
      .find((model) => model && !model.availability.active);
    if (unavailable) {
      return NextResponse.json(
        {
          error: unavailable.availability.message ?? "The selected model is not available.",
          code: "model-unavailable",
        },
        { status: 409 },
      );
    }
    const merged = mergeModelProviderPreferences(currentPreferences, parsed.data);

    if (!merged.ok) {
      return NextResponse.json(
        { error: merged.message, code: merged.code },
        { status: 400 },
      );
    }

    const { error } = await context.supabase.from("user_metadata").upsert(
      {
        user_id: context.user.id,
        preferences: merged.preferences,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("Unable to save model-provider preferences", error);
      return NextResponse.json({ error: "Unable to save model-provider settings." }, { status: 500 });
    }

    return NextResponse.json(settingsPayload(merged.preferences, activeProviderKeyIds));
  } catch {
    return NextResponse.json({ error: "Unable to save model-provider settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  return save(request);
}

export async function POST(request: Request) {
  return save(request);
}
