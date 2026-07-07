import { NextResponse } from "next/server";
import {
  createMockCanvasAssistantProvider,
  DEFAULT_CANVAS_ASSISTANT_MODEL,
  orchestrateCanvasAssistant,
} from "@/modules/canvas/ai/copilot/assistant-orchestrator";
import { getCanvasUser, getCanvasAdmin, requireCanvasAccess } from "@/lib/canvas/api";
import { createGeminiCanvasAssistantProvider } from "@/modules/canvas/ai/copilot/gemini-assistant-provider";
import { createLiteLlmCanvasAssistantProvider } from "@/modules/canvas/ai/copilot/litellm-assistant-provider";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { getCanvasAssetStorageRef } from "@/modules/assets/canvas-asset-storage-refs";
import {
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
} from "@/modules/model-providers";

export async function handleAssistantRequest(request: Request) {
  const user = await getCanvasUser();
  let provider = createMockCanvasAssistantProvider();
  provider.model = process.env.CANVAS_ASSISTANT_MODEL ?? DEFAULT_CANVAS_ASSISTANT_MODEL;

  if (process.env.CANVAS_ASSISTANT_PROVIDER !== "mock" && user?.id) {
    const gatewayConfig = getModelGatewayConfig();

    if (gatewayConfig.status === "configured") {
      const preferences = await loadModelProviderPreferences(user.id);
      if (!preferences.ok) {
        return NextResponse.json({ error: "Unable to load Copilot model settings." }, { status: 500 });
      }
      const selection = getResolvedModelProviderPreferences(preferences.preferences);
      provider = createLiteLlmCanvasAssistantProvider({
        config: gatewayConfig,
        modelAlias: selection.chatOrchestrationModelAlias,
        userId: user.id,
      });
    } else if (gatewayConfig.status === "error") {
      return NextResponse.json(
        {
          error: "Canvas Copilot model gateway is not configured correctly.",
          details: { code: "model-gateway-configuration" },
        },
        { status: 503 },
      );
    } else {
      let apiKey: string | null = null;
      try {
        apiKey = await getUserProviderApiKey(user.id, "google-gemini");
      } catch {
        return NextResponse.json({ error: "Unable to load your Gemini API key." }, { status: 500 });
      }
      if (!apiKey) {
        return NextResponse.json({ error: "Add your Gemini API key in Settings before using Copilot." }, { status: 403 });
      }
      provider = createGeminiCanvasAssistantProvider({
        apiKey,
        model: process.env.CANVAS_ASSISTANT_MODEL ?? DEFAULT_CANVAS_ASSISTANT_MODEL,
      });
    }
  }

  const result = await orchestrateCanvasAssistant(await request.json().catch(() => null), {
    async getUserId() {
      return user?.id ?? null;
    },
    async requireCanvasAccess(userId) {
      const access = await requireCanvasAccess(userId);
      return access.response ? { allowed: false, error: "Canvas access denied." } : { allowed: true };
    },
    async getOwnedPage(userId, designId, pageId) {
      const admin = getCanvasAdmin();
      if (!admin) return null;
      const { data } = await admin
        .from("canvas_pages")
        .select("id, design_id")
        .eq("id", pageId)
        .eq("design_id", designId)
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? null;
    },
    async assetExists(userId, assetId) {
      const admin = getCanvasAdmin();
      if (!admin) return false;
      const { data } = await admin
        .from("canvas_assets")
        .select("id")
        .eq("id", assetId)
        .eq("user_id", userId)
        .maybeSingle();
      return Boolean(data);
    },
    async getOwnedAsset(userId, assetId) {
      const admin = getCanvasAdmin();
      if (!admin) return null;
      const { data } = await admin
        .from("canvas_assets")
        .select(
          "id, public_url, content_type, size_bytes, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
        )
        .eq("id", assetId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return null;
      const storageRef = getCanvasAssetStorageRef(data);
      return {
        assetId: String(data.id),
        status: storageRef ? (storageRef.status === "available" ? "available" : "missing") : data.drive_status === "missing" ? "missing" : "available",
        mimeType: typeof data.content_type === "string" ? data.content_type : null,
        bytes: typeof data.size_bytes === "number" ? data.size_bytes : null,
        publicUrl: typeof data.public_url === "string" ? data.public_url : `/api/canvas/assets/${assetId}`,
      };
    },
    provider,
  });

  return NextResponse.json(result.body, { status: result.status });
}

async function loadModelProviderPreferences(userId: string): Promise<{ ok: true; preferences: unknown } | { ok: false }> {
  const admin = getCanvasAdmin();
  if (!admin) return { ok: false };

  const { data, error } = await admin
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error("Unable to load Copilot model preferences");
    return { ok: false };
  }

  return { ok: true, preferences: data?.preferences ?? {} };
}
