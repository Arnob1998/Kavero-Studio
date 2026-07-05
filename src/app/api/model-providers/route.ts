import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
  getBrowserModelCatalog,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  getSafeGatewayStatus,
  mergeModelProviderPreferences,
} from "@/modules/model-providers";
import { createClient } from "@/lib/supabase/server";

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

function settingsPayload(preferences: unknown) {
  const selection = getResolvedModelProviderPreferences(preferences);

  return {
    gateway: getSafeGatewayStatus(getModelGatewayConfig()),
    catalog: getBrowserModelCatalog(),
    defaults: {
      chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    },
    selected: selection,
    ...selection,
  };
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
    const preferences = await loadPreferences(context.supabase, context.user.id);
    return NextResponse.json(settingsPayload(preferences));
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
    const currentPreferences = await loadPreferences(context.supabase, context.user.id);
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

    return NextResponse.json(settingsPayload(merged.preferences));
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
