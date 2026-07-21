import { z } from "zod";
import {
  CANVAS_TOOL_REGISTRY,
  type CanvasToolName,
  type CanvasToolJsonSchema,
  type CanvasToolRisk,
} from "@/modules/canvas/actions/canvas-tool-registry";
import { isModelGatewayError } from "@/modules/model-providers";
import {
  getImageModelCapabilitiesByLegacyModel,
  validateLegacyImageRequest,
} from "@/modules/model-providers/image-capabilities";

export const DEFAULT_CANVAS_ASSISTANT_MODEL = "gemini-3.1-pro-preview";

export type AssistantRole = "user" | "assistant" | "system";

export interface CanvasAssistantMessage {
  role: AssistantRole;
  content: string;
}

export interface CanvasAssistantProviderToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface CanvasAssistantProviderResult {
  message: CanvasAssistantMessage;
  toolCalls: CanvasAssistantProviderToolCall[];
}

export type CanvasAssistantWorkflowPhase = "inspect" | "propose" | "repair";
export type CanvasAssistantDecision = "approve" | "reject" | "customize";

export interface CanvasAssistantProvider {
  name: string;
  model: string;
  generate: (input: CanvasAssistantProviderInput) => Promise<CanvasAssistantProviderResult>;
}

export interface CanvasAssistantProviderInput {
  messages: CanvasAssistantMessage[];
  context: SafeCanvasAssistantContext;
  tools: CanvasAssistantToolSchema[];
  phase: CanvasAssistantWorkflowPhase;
  decision?: CanvasAssistantDecision;
  customInstruction?: string;
  temperature?: number;
  thinkingEnabled?: boolean;
}

export interface CanvasAssistantToolSchema {
  name: CanvasToolName;
  description: string;
  riskLevel: CanvasToolRisk;
  inputSchema: CanvasToolJsonSchema;
}

export interface SafeCanvasAssistantContext {
  designId: string;
  pageId: string;
  sceneSnapshot: unknown | null;
  relationMap: unknown | null;
  selectedObjectIds: string[];
  visualPreview: AssistantVisualInput | null;
  inspectedAssets: AssistantAssetInspection[];
  imageGeneration: AssistantImageGenerationSettings | null;
}

export interface AssistantImageGenerationSettings {
  enabled: boolean;
  modelAlias: string;
  model: string;
  batchSize: 4 | 8 | 12 | 16;
  thinking: "fast" | "balanced" | "deep" | "provider-managed";
  aspectRatio: string;
  imageSize: "1K" | "2K" | "4K" | "auto" | "1024x1024" | "1536x1024" | "1024x1536";
  quality: "auto" | "low" | "medium" | "high";
  background: "auto" | "opaque" | "transparent";
  transparentBackgroundDefault: boolean;
}

export interface AssistantVisualInput {
  status: "available";
  pageId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface AssistantAssetInspection {
  assetId: string;
  status: "available" | "missing" | "unsupported" | "too_large";
  mimeType: string | null;
  bytes: number | null;
  publicUrl: string | null;
}

export interface ValidatedAssistantToolCall {
  id: string;
  name: CanvasToolName;
  input: unknown;
  riskLevel: CanvasToolRisk;
  status: "ready" | "requires_confirmation" | "approved" | "rejected";
  errors: string[];
  summary: string;
}

export interface CanvasAssistantActionBundle {
  id: string;
  summary: string;
  riskLevel: CanvasToolRisk;
  actions: ValidatedAssistantToolCall[];
}

export interface CanvasAssistantResponse {
  ok: boolean;
  provider: string;
  model: string;
  message: CanvasAssistantMessage | null;
  requestsFeedback: boolean;
  context: {
    sceneSnapshot: boolean;
    relationMap: boolean;
    selectedObjectIds: string[];
    visualPreview: "none" | "available";
    visualPreviewBytes: number;
    inspectedAssets: AssistantAssetInspection[];
    imageGeneration: AssistantImageGenerationSettings | null;
  };
  tools: CanvasAssistantToolSchema[];
  toolCalls: ValidatedAssistantToolCall[];
  proposedBundle: CanvasAssistantActionBundle | null;
  errors: string[];
}

export interface CanvasAssistantDependencies {
  getUserId: () => Promise<string | null>;
  requireCanvasAccess: (userId: string) => Promise<{ allowed: boolean; error?: string }>;
  getOwnedPage: (userId: string, designId: string, pageId: string) => Promise<{ id: string; design_id: string } | null>;
  assetExists: (userId: string, assetId: string) => Promise<boolean>;
  getOwnedAsset?: (userId: string, assetId: string) => Promise<AssistantAssetInspection | null>;
  provider: CanvasAssistantProvider;
}

const allowedVisualMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const providerImageLimits = {
  maxImages: 4,
  maxBytesPerImage: 4 * 1024 * 1024,
};

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(6000),
});

const requestSchema = z.object({
  action: z.enum(["start", "resume"]).default("start"),
  designId: z.string().trim().min(1).max(160),
  pageId: z.string().trim().min(1).max(160),
  messages: z.array(messageSchema).min(1).max(64),
  phase: z.enum(["inspect", "propose", "repair"]).optional(),
  decision: z.enum(["approve", "reject", "customize"]).optional(),
  customInstruction: z.string().trim().max(2000).optional(),
  sceneSnapshot: z.unknown().optional(),
  relationMap: z.unknown().optional(),
  selectedObjectIds: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  visualPreview: z
    .object({
      status: z.enum(["available"]),
      pageId: z.string().trim().min(1).max(160),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      dataUrl: z.string().max(6 * 1024 * 1024),
      width: z.number().finite().min(1).max(10000),
      height: z.number().finite().min(1).max(10000),
      bytes: z.number().finite().min(1).max(20 * 1024 * 1024),
    })
    .optional(),
  assetIdsToInspect: z.array(z.string().trim().regex(/^[a-zA-Z0-9_-]+$/)).max(8).optional(),
  confirmedToolCallIds: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingEnabled: z.boolean().optional(),
  imageGeneration: z
    .object({
      enabled: z.boolean().default(true),
      modelAlias: z.string().trim().min(1).max(200),
      model: z.string().trim().min(1).max(120).default("gemini-3.1-flash-image-preview"),
      batchSize: z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(16)]).default(4),
      thinking: z.enum(["fast", "balanced", "deep", "provider-managed"]).default("balanced"),
      aspectRatio: z.string().trim().min(1).max(24).default("auto"),
      imageSize: z.enum(["1K", "2K", "4K", "auto", "1024x1024", "1536x1024", "1024x1536"]).default("1K"),
      quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
      background: z.enum(["auto", "opaque", "transparent"]).default("auto"),
      transparentBackgroundDefault: z.boolean().default(false),
    })
    .superRefine((settings, context) => {
      const capability = getImageModelCapabilitiesByLegacyModel(settings.model);
      if (!capability) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Unknown image model." });
        return;
      }
      if (settings.modelAlias !== capability.modelAlias) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["modelAlias"], message: "Image model selection is stale." });
      }
      for (const issue of validateLegacyImageRequest({
        feature: "canvas-generation",
        model: settings.model,
        count: settings.batchSize,
        thinking: settings.thinking,
        aspectRatio: settings.aspectRatio,
        imageSize: settings.imageSize,
        referenceImages: [],
      })) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [issue.field], message: issue.message });
      }
      const allowedReasoning = capability.reasoning.values.length > 0 ? capability.reasoning.values : ["provider-managed"];
      if (!allowedReasoning.includes(settings.thinking)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["thinking"], message: `${capability.displayLabel} does not support the selected reasoning control.` });
      }
      const allowedQuality = capability.quality.values.length > 0 ? capability.quality.values : ["auto"];
      if (!allowedQuality.includes(settings.quality)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["quality"], message: `${capability.displayLabel} does not support the selected quality.` });
      }
      if (!capability.background.values.includes(settings.background)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["background"], message: `${capability.displayLabel} does not support the selected background.` });
      }
    })
    .optional(),
});

export async function orchestrateCanvasAssistant(
  rawBody: unknown,
  dependencies: CanvasAssistantDependencies,
): Promise<{ status: number; body: CanvasAssistantResponse | { error: string; details?: unknown } }> {
  const userId = await dependencies.getUserId();
  if (!userId) return { status: 401, body: { error: "Unauthorized" } };

  const access = await dependencies.requireCanvasAccess(userId);
  if (!access.allowed) return { status: 403, body: { error: access.error ?? "Canvas access denied." } };

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid assistant payload.",
        details: {
          fieldErrors: parsed.error.flatten().fieldErrors,
          formErrors: parsed.error.flatten().formErrors,
        },
      },
    };
  }

  const page = await dependencies.getOwnedPage(userId, parsed.data.designId, parsed.data.pageId);
  if (!page) return { status: 404, body: { error: "Design page not found." } };

  const contextResult = await buildSafeContext(parsed.data, userId, dependencies);
  if (!contextResult.ok) return { status: 400, body: { error: contextResult.error } };
  const context = contextResult.context;
  const phase = inferWorkflowPhase(parsed.data);
  const tools = getCanvasAssistantToolSchemas(phase);

  let providerResult: CanvasAssistantProviderResult;
  try {
    providerResult = await dependencies.provider.generate({
      messages: compactMessages(parsed.data.messages),
      context,
      tools,
      phase,
      decision: parsed.data.decision,
      customInstruction: parsed.data.customInstruction,
      temperature: parsed.data.temperature,
      thinkingEnabled: parsed.data.thinkingEnabled,
    });
  } catch (error) {
    const failure = getProviderFailure(error);
    return {
      status: failure.status,
      body: {
        ok: false,
        provider: dependencies.provider.name,
        model: dependencies.provider.model,
        message: null,
        requestsFeedback: false,
        context: responseContext(context),
        tools,
        toolCalls: [],
        proposedBundle: null,
        errors: [failure.message],
      },
    };
  }

  const requestsFeedback = providerResult.toolCalls.some((c) => c.name === "request_feedback");
  const canvasToolCalls = providerResult.toolCalls.filter((c) => c.name !== "request_feedback");

  const toolCalls: ValidatedAssistantToolCall[] = [];
  for (const call of canvasToolCalls) {
    toolCalls.push(await validateAssistantToolCall(call, parsed.data.confirmedToolCallIds ?? [], userId, dependencies, phase));
  }
  const proposedBundle = createActionBundle(toolCalls);

  return {
    status: 200,
    body: {
      ok: toolCalls.every((call) => call.errors.length === 0),
      provider: dependencies.provider.name,
      model: dependencies.provider.model,
      message: sanitizeMessage(providerResult.message),
      requestsFeedback,
      context: responseContext(context),
      tools,
      toolCalls,
      proposedBundle,
      errors: toolCalls.flatMap((call) => call.errors),
    },
  };
}

export function getCanvasAssistantToolSchemas(phase: CanvasAssistantWorkflowPhase = "propose"): CanvasAssistantToolSchema[] {
  return Object.values(CANVAS_TOOL_REGISTRY).filter((tool) => toolAllowedInPhase(tool.name, phase)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    inputSchema: tool.jsonSchema,
  }));
}

function inferWorkflowPhase(input: z.infer<typeof requestSchema>): CanvasAssistantWorkflowPhase {
  if (input.phase) return input.phase;
  if (input.action === "resume" && input.decision === "customize") return "repair";
  if (input.action === "resume" && input.decision === "reject") return "propose";
  const last = input.messages.at(-1)?.content.toLowerCase() ?? "";
  if (/\b(inspect|explain|what is|describe|analy[sz]e)\b/.test(last)) return "inspect";
  return "propose";
}

function toolAllowedInPhase(name: CanvasToolName, phase: CanvasAssistantWorkflowPhase) {
  if (phase === "inspect") return name === "select_object";
  if (phase === "repair") {
    return [
      "update_object",
      "transform_object",
      "flip_object",
      "set_object_perspective",
      "fit_objects_in_canvas",
      "repair_canvas_overflow",
      "normalize_text_box",
      "layout_stack",
      "align_object",
      "reorder_object",
      "set_object_shadow",
      "set_object_blur",
      "set_object_blend_mode",
      "undo",
      "redo",
    ].includes(name);
  }
  return true;
}

export function createMockCanvasAssistantProvider(): CanvasAssistantProvider {
  return {
    name: "mock",
    model: DEFAULT_CANVAS_ASSISTANT_MODEL,
    async generate(input) {
      const last = input.messages.at(-1)?.content.toLowerCase() ?? "";
      if (last.includes("provider failure")) throw new Error("Mock provider failure.");
      if (last.includes("malformed")) {
        return {
          message: { role: "assistant", content: "Mock malformed tool call." },
          toolCalls: [{ id: "mock-malformed", name: "add_text", input: { preset: "poster" } }],
        };
      }
      if (last.includes("delete")) {
        return {
          message: { role: "assistant", content: "I can delete the selected object after confirmation." },
          toolCalls: [
            {
              id: "mock-delete",
              name: "delete_objects",
              input: { objectIds: input.context.selectedObjectIds.slice(0, 1) },
            },
          ],
        };
      }
      if (last.includes("asset")) {
        return {
          message: { role: "assistant", content: "I can add that uploaded asset." },
          toolCalls: [{ id: "mock-asset", name: "add_uploaded_image", input: { assetId: "asset-1" } }],
        };
      }
      return {
        message: { role: "assistant", content: "Mock assistant response." },
        toolCalls: [{ id: "mock-heading", name: "add_text", input: { preset: "heading", text: "New heading" } }],
      };
    },
  };
}

async function validateAssistantToolCall(
  call: CanvasAssistantProviderToolCall,
  confirmedToolCallIds: string[],
  userId: string,
  dependencies: CanvasAssistantDependencies,
  phase: CanvasAssistantWorkflowPhase,
): Promise<ValidatedAssistantToolCall> {
  if (!isCanvasToolName(call.name)) {
    return invalidCall(call, `Unknown tool: ${call.name}`);
  }
  if (!toolAllowedInPhase(call.name, phase)) {
    return invalidCall(call, `Tool ${call.name} is not available during the ${phase} phase.`, CANVAS_TOOL_REGISTRY[call.name].riskLevel);
  }

  const definition = CANVAS_TOOL_REGISTRY[call.name];
  const parsed = definition.inputSchema.safeParse(call.input ?? {});
  if (!parsed.success) {
    return invalidCall(
      call,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "),
      definition.riskLevel,
    );
  }

  const assetError = await validateToolAssets(parsed.data, userId, dependencies);
  if (assetError) return invalidCall(call, assetError, definition.riskLevel);

  const requiresConfirmation =
    definition.riskLevel === "high" || PAGE_LEVEL_TOOLS.has(call.name) || isBulkMutation(call.name, parsed.data);
  const confirmed = confirmedToolCallIds.includes(call.id);

  return {
    id: call.id,
    name: call.name,
    input: parsed.data,
    riskLevel: definition.riskLevel,
    status: requiresConfirmation && !confirmed ? "requires_confirmation" : requiresConfirmation ? "approved" : "ready",
    errors: [],
    summary:
      requiresConfirmation && !confirmed
        ? `${summarizeToolCall(call.name, parsed.data)} Confirmation is required.`
        : summarizeToolCall(call.name, parsed.data),
  };
}

async function validateToolAssets(input: unknown, userId: string, dependencies: CanvasAssistantDependencies) {
  const assetIds = extractCanvasAssetIds(input);
  for (const assetId of assetIds) {
    const exists = await dependencies.assetExists(userId, assetId);
    if (!exists) return `Canvas asset ${assetId} is not owned by this user.`;
  }
  return null;
}

function extractCanvasAssetIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(extractCanvasAssetIds);
  const record = value as Record<string, unknown>;
  const ids: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (key === "assetId" && typeof item === "string") ids.push(item);
    if ((key === "assetUrl" || key === "value") && typeof item === "string") {
      const match = item.match(/^\/api\/canvas\/assets\/([a-zA-Z0-9_-]+)$/);
      if (match) ids.push(match[1]);
    }
    ids.push(...extractCanvasAssetIds(item));
  }
  return Array.from(new Set(ids));
}

async function buildSafeContext(
  input: z.infer<typeof requestSchema>,
  userId: string,
  dependencies: CanvasAssistantDependencies,
): Promise<{ ok: true; context: SafeCanvasAssistantContext } | { ok: false; error: string }> {
  const visualPreview = validateVisualPreview(input);
  if (typeof visualPreview === "string") return { ok: false, error: visualPreview };
  const inspectedAssets = await inspectAssets(input.assetIdsToInspect ?? [], userId, dependencies, visualPreview ? 1 : 0);

  return {
    ok: true,
    context: {
      designId: input.designId,
      pageId: input.pageId,
      sceneSnapshot: stripUnsafeContext(input.sceneSnapshot ?? null),
      relationMap: stripUnsafeContext(input.relationMap ?? null),
      selectedObjectIds: input.selectedObjectIds ?? [],
      visualPreview,
      inspectedAssets,
      imageGeneration: input.imageGeneration ?? null,
    },
  };
}

function validateVisualPreview(input: z.infer<typeof requestSchema>): AssistantVisualInput | null | string {
  if (!input.visualPreview) return null;
  if (input.visualPreview.pageId !== input.pageId) return "Visual preview does not match the active page.";
  if (!allowedVisualMimeTypes.has(input.visualPreview.mimeType)) return "Unsupported visual preview format.";
  if (input.visualPreview.bytes > providerImageLimits.maxBytesPerImage) return "Visual preview is too large for provider limits.";
  if (!input.visualPreview.dataUrl.startsWith(`data:${input.visualPreview.mimeType};base64,`)) return "Visual preview data is malformed.";
  return {
    status: "available",
    pageId: input.visualPreview.pageId,
    mimeType: input.visualPreview.mimeType,
    dataUrl: input.visualPreview.dataUrl,
    width: input.visualPreview.width,
    height: input.visualPreview.height,
    bytes: input.visualPreview.bytes,
  };
}

async function inspectAssets(
  assetIds: string[],
  userId: string,
  dependencies: CanvasAssistantDependencies,
  imageSlotsUsed: number,
): Promise<AssistantAssetInspection[]> {
  const uniqueIds = Array.from(new Set(assetIds)).slice(0, Math.max(0, providerImageLimits.maxImages - imageSlotsUsed));
  const inspected: AssistantAssetInspection[] = [];
  for (const assetId of uniqueIds) {
    const asset = dependencies.getOwnedAsset
      ? await dependencies.getOwnedAsset(userId, assetId)
      : (await dependencies.assetExists(userId, assetId))
        ? { assetId, status: "available" as const, mimeType: null, bytes: null, publicUrl: `/api/canvas/assets/${assetId}` }
        : null;
    if (!asset) {
      inspected.push({ assetId, status: "missing", mimeType: null, bytes: null, publicUrl: null });
      continue;
    }
    if (!asset.mimeType || !allowedVisualMimeTypes.has(asset.mimeType)) {
      inspected.push({ ...asset, status: "unsupported" });
      continue;
    }
    if (asset.bytes !== null && asset.bytes > providerImageLimits.maxBytesPerImage) {
      inspected.push({ ...asset, status: "too_large" });
      continue;
    }
    inspected.push(asset);
  }
  return inspected;
}

function stripUnsafeContext(value: unknown): unknown {
  if (typeof value === "string") {
    if (/data:|drive\.google\.com|file:|[a-zA-Z]:\\|\/Users\/|\/home\//i.test(value)) return "[redacted]";
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripUnsafeContext);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["driveFileId", "accessToken", "refreshToken", "serviceRoleKey", "dataUrl", "url"].includes(key))
      .map(([key, item]) => [key, stripUnsafeContext(item)]),
  );
}

function responseContext(context: SafeCanvasAssistantContext) {
  const visualPreview: "none" | "available" = context.visualPreview?.status ?? "none";
  return {
    sceneSnapshot: Boolean(context.sceneSnapshot),
    relationMap: Boolean(context.relationMap),
    selectedObjectIds: context.selectedObjectIds,
    visualPreview,
    visualPreviewBytes: context.visualPreview?.bytes ?? 0,
    inspectedAssets: context.inspectedAssets.map((asset) => ({
      ...asset,
      publicUrl: asset.publicUrl,
    })),
    imageGeneration: context.imageGeneration
      ? {
          ...context.imageGeneration,
          enabled: context.imageGeneration.enabled,
        }
      : null,
  };
}

function compactMessages(messages: CanvasAssistantMessage[]) {
  if (messages.length <= 32) return messages;
  const kept = messages.slice(-31);
  return [
    { role: "system" as const, content: `Earlier history compacted server-side (${messages.length - kept.length} messages).` },
    ...kept,
  ];
}

function sanitizeMessage(message: CanvasAssistantMessage): CanvasAssistantMessage {
  return {
    role: message.role,
    content: String(stripUnsafeContext(message.content)).slice(0, 6000),
  };
}

function isCanvasToolName(name: string): name is CanvasToolName {
  return name in CANVAS_TOOL_REGISTRY;
}

function invalidCall(call: CanvasAssistantProviderToolCall, error: string, riskLevel: CanvasToolRisk = "high"): ValidatedAssistantToolCall {
  return {
    id: call.id,
    name: isCanvasToolName(call.name) ? call.name : "delete_objects",
    input: call.input,
    riskLevel,
    status: "rejected",
    errors: [error],
    summary: error,
  };
}

function createActionBundle(toolCalls: ValidatedAssistantToolCall[]): CanvasAssistantActionBundle | null {
  const actions = toolCalls.filter((call) => call.status === "requires_confirmation");
  if (actions.length === 0) return null;
  const riskLevel = actions.some((call) => call.riskLevel === "high")
    ? "high"
    : actions.some((call) => call.riskLevel === "medium")
      ? "medium"
      : "low";
  return {
    id: `bundle-${actions.map((call) => call.id).join("-").slice(0, 80) || "review"}`,
    summary: summarizeActionBundle(actions),
    riskLevel,
    actions,
  };
}

function summarizeActionBundle(actions: ValidatedAssistantToolCall[]) {
  if (actions.length === 1) return actions[0]?.summary ?? "Review proposed canvas change.";
  const highRiskCount = actions.filter((action) => action.riskLevel === "high").length;
  const pageLevelCount = actions.filter((action) => PAGE_LEVEL_TOOLS.has(action.name)).length;
  const parts = [`Review ${actions.length} proposed canvas changes`];
  if (highRiskCount > 0) parts.push(`${highRiskCount} high risk`);
  if (pageLevelCount > 0) parts.push(`${pageLevelCount} page level`);
  return `${parts.join(", ")}.`;
}

function isBulkMutation(name: CanvasToolName, input: unknown) {
  if (name !== "delete_objects" && name !== "duplicate_objects") return false;
  const objectIds = (input as { objectIds?: unknown }).objectIds;
  return Array.isArray(objectIds) && objectIds.length > 1;
}

const PAGE_LEVEL_TOOLS = new Set<CanvasToolName>(["set_background", "set_canvas_size", "save"]);

function getProviderFailure(error: unknown) {
  if (isModelGatewayError(error)) {
    const { errorCode, retryable, status } = error.details;
    if (errorCode === "authentication_error") {
      return { status: 403, message: "The assistant model gateway was rejected. Check provider setup and try again." };
    }
    if (status === 404) {
      return { status: 502, message: "The configured assistant model was not found. Check your model provider settings and try again." };
    }
    if (status === 413) {
      return { status: 413, message: "The canvas assistant context is too large for the provider." };
    }
    if (errorCode === "rate_limited" || retryable) {
      return { status: 503, message: "The assistant provider is temporarily busy. Please wait a moment and try again." };
    }
    if (errorCode === "invalid_response") {
      return { status: 502, message: "Assistant provider failed." };
    }
    return { status: 502, message: "Assistant provider failed." };
  }

  const status = getErrorStatus(error);
  if (status === 401 || status === 403) {
    return { status: 403, message: "Your assistant provider key was rejected. Check the key in Settings and try again." };
  }
  if (status === 404) {
    return { status: 502, message: "The configured assistant model was not found. Check the CANVAS_ASSISTANT_MODEL environment variable." };
  }
  if (status === 413) {
    return { status: 413, message: "The canvas assistant context is too large for the provider." };
  }
  if (status === 429 || status === 503) {
    return { status: 503, message: "The assistant provider is temporarily busy. Please wait a moment and try again." };
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("[canvas-assistant] provider error:", message);
  return { status: 502, message: "Assistant provider failed." };
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const directStatus = "status" in error ? (error as { status?: unknown }).status : null;
  if (typeof directStatus === "number") return directStatus;
  const message = "message" in error ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string") return null;
  try {
    const parsed = JSON.parse(message) as { error?: { code?: unknown; status?: unknown } };
    const code = parsed.error?.code;
    if (typeof code === "number") return code;
  } catch {
    return null;
  }
  return null;
}

function summarizeToolCall(name: CanvasToolName, input: unknown) {
  const data = input as Record<string, unknown>;
  if (name === "add_text") return `Add text${typeof data.text === "string" ? ` "${data.text}"` : ""}.`;
  if (name === "add_shape") return `Add ${typeof data.shapeType === "string" ? data.shapeType : "shape"}.`;
  if (name === "add_uploaded_image") return `Add uploaded asset ${String(data.assetId ?? assetIdFromUrl(data.assetUrl) ?? "image")}.`;
  if (name === "generate_image_asset") {
    return data.useAsBackground === true
      ? `Generate and set an AI background asset for "${String(data.prompt ?? "canvas")}".`
      : `Generate and place an AI image asset for "${String(data.prompt ?? "canvas")}".`;
  }
  if (name === "set_background") return "Update the canvas background.";
  if (name === "set_canvas_size") return `Resize canvas to ${String(data.width)} x ${String(data.height)}.`;
  if (name === "update_object") return `Update object ${String(data.objectId ?? "")}.`.trim();
  if (name === "transform_object") return `Move or transform object ${String(data.objectId ?? "")}.`.trim();
  if (name === "align_object") return `Align object ${String(data.objectId ?? "")}.`.trim();
  if (name === "reorder_object") return `Reorder object ${String(data.objectId ?? "")}.`.trim();
  if (name === "select_object") return `Select object ${String(data.objectId ?? "")}.`.trim();
  if (name === "delete_objects") {
    const ids = Array.isArray(data.objectIds) ? data.objectIds : [];
    return `Delete ${ids.length || "selected"} object${ids.length === 1 ? "" : "s"}.`;
  }
  if (name === "duplicate_objects") {
    const ids = Array.isArray(data.objectIds) ? data.objectIds : [];
    return `Duplicate ${ids.length || "selected"} object${ids.length === 1 ? "" : "s"}.`;
  }
  if (name === "undo") return "Undo the latest canvas edit.";
  if (name === "redo") return "Redo the latest canvas edit.";
  if (name === "save") return "Save the active design.";
  return `${name} validated.`;
}

function assetIdFromUrl(value: unknown) {
  if (typeof value !== "string") return null;
  return value.match(/^\/api\/canvas\/assets\/([a-zA-Z0-9_-]+)$/)?.[1] ?? null;
}
