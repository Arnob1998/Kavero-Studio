import { describe, expect, it, vi } from "vitest";
import {
  type AssistantAssetInspection,
  type CanvasAssistantProvider,
  createMockCanvasAssistantProvider,
  DEFAULT_CANVAS_ASSISTANT_MODEL,
  getCanvasAssistantToolSchemas,
  orchestrateCanvasAssistant,
  type CanvasAssistantDependencies,
} from "./assistant-orchestrator";

const basePayload = {
  designId: "design-1",
  pageId: "page-1",
  messages: [{ role: "user", content: "add a heading" }],
  sceneSnapshot: {
    selectedObjectIds: ["obj-1"],
    unsafe: "data:image/png;base64,abc",
  },
  relationMap: { nodes: [], edges: [] },
  selectedObjectIds: ["obj-1"],
  visualPreview: {
    status: "available",
    pageId: "page-1",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
    width: 900,
    height: 600,
    bytes: 3,
  },
};

function deps(overrides: Partial<CanvasAssistantDependencies> = {}): CanvasAssistantDependencies {
  return {
    getUserId: vi.fn(async () => "user-1"),
    requireCanvasAccess: vi.fn(async () => ({ allowed: true })),
    getOwnedPage: vi.fn(async () => ({ id: "page-1", design_id: "design-1" })),
    assetExists: vi.fn(async (_userId, assetId) => assetId === "asset-1"),
    getOwnedAsset: vi.fn(async (_userId, assetId) => {
      if (assetId === "asset-1") {
        return {
          assetId,
          status: "available" as const,
          mimeType: "image/png",
          bytes: 1024,
          publicUrl: `/api/canvas/assets/${assetId}`,
        } satisfies AssistantAssetInspection;
      }
      return null;
    }),
    provider: createMockCanvasAssistantProvider(),
    ...overrides,
  };
}

function providerReturning(toolCalls: Array<{ id: string; name: string; input: unknown }>, content = "Done."): CanvasAssistantProvider {
  return {
    name: "mock-integration",
    model: "test-model",
    generate: vi.fn(async () => ({
      message: { role: "assistant" as const, content },
      toolCalls,
    })),
  };
}

describe("canvas assistant orchestrator", () => {
  it("accepts capability-normalized provider-managed Azure image settings", async () => {
    const result = await orchestrateCanvasAssistant({
      ...basePayload,
      imageGeneration: {
        enabled: true,
        modelAlias: "kavero-image-azure-gpt-image-2",
        model: "azure-gpt-image-2",
        batchSize: 4,
        thinking: "provider-managed",
        aspectRatio: "auto",
        imageSize: "auto",
        quality: "auto",
        background: "auto",
        transparentBackgroundDefault: false,
      },
    }, deps());

    expect(result.status).toBe(200);
    expect("context" in result.body && result.body.context.imageGeneration).toMatchObject({
      modelAlias: "kavero-image-azure-gpt-image-2",
      thinking: "provider-managed",
    });
  });

  it("rejects stale or capability-incompatible image controls with safe field details", async () => {
    const result = await orchestrateCanvasAssistant({
      ...basePayload,
      imageGeneration: {
        enabled: true,
        modelAlias: "kavero-image-generation-default",
        model: "azure-gpt-image-2",
        batchSize: 4,
        thinking: "deep",
        aspectRatio: "auto",
        imageSize: "auto",
        quality: "auto",
        background: "auto",
        transparentBackgroundDefault: false,
      },
    }, deps());

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: "Invalid assistant payload.",
      details: { fieldErrors: { imageGeneration: expect.any(Array) } },
    });
  });

  it("rejects unauthenticated requests", async () => {
    const result = await orchestrateCanvasAssistant(basePayload, deps({ getUserId: vi.fn(async () => null) }));

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Unauthorized" });
  });

  it("rejects users without canvas access", async () => {
    const result = await orchestrateCanvasAssistant(
      basePayload,
      deps({ requireCanvasAccess: vi.fn(async () => ({ allowed: false, error: "Premium required." })) }),
    );

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "Premium required." });
  });

  it("rejects pages not owned by the user", async () => {
    const result = await orchestrateCanvasAssistant(basePayload, deps({ getOwnedPage: vi.fn(async () => null) }));

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "Design page not found." });
  });

  it("exposes tool schemas from the centralized registry", () => {
    const tools = getCanvasAssistantToolSchemas();

    expect(tools.map((tool) => tool.name)).toContain("add_text");
    expect(tools.map((tool) => tool.name)).toContain("delete_objects");
    expect(tools.find((tool) => tool.name === "delete_objects")).toMatchObject({ riskLevel: "high" });
    expect(tools.find((tool) => tool.name === "add_text")?.inputSchema).toMatchObject({ type: "object" });
  });

  it("validates safe model-requested tool calls", async () => {
    const result = await orchestrateCanvasAssistant(basePayload, deps());

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      provider: "mock",
      model: DEFAULT_CANVAS_ASSISTANT_MODEL,
      context: {
        sceneSnapshot: true,
        relationMap: true,
        selectedObjectIds: ["obj-1"],
        visualPreview: "available",
        visualPreviewBytes: 3,
      },
    });
    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      name: "add_text",
      status: "ready",
      errors: [],
    });
  });

  it("rejects malformed tool calls from the provider", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "malformed" }] },
      deps(),
    );

    expect(result.status).toBe(200);
    expect("ok" in result.body && result.body.ok).toBe(false);
    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      name: "add_text",
      status: "rejected",
    });
    expect("errors" in result.body && result.body.errors[0]).toContain("preset");
  });

  it("rejects provider tool arguments that are not valid input objects", async () => {
    const result = await orchestrateCanvasAssistant(
      basePayload,
      deps({
        provider: providerReturning([{ id: "bad-args", name: "transform_object", input: "{not-json" }]),
      }),
    );

    expect(result.status).toBe(200);
    expect("ok" in result.body && result.body.ok).toBe(false);
    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "bad-args",
      name: "transform_object",
      status: "rejected",
    });
    expect("errors" in result.body && result.body.errors[0]).toContain("Expected object");
  });

  it("gates destructive tool calls until confirmed", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "delete selected" }] },
      deps(),
    );

    expect(result.status).toBe(200);
    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "mock-delete",
      name: "delete_objects",
      riskLevel: "high",
      status: "requires_confirmation",
    });
  });

  it("approves destructive tool calls when confirmed", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "delete selected" }], confirmedToolCallIds: ["mock-delete"] },
      deps(),
    );

    expect(result.status).toBe(200);
    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "mock-delete",
      status: "approved",
    });
  });

  it("validates model-requested asset access", async () => {
    const allowed = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "add asset" }] },
      deps(),
    );
    const denied = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "add asset" }] },
      deps({ assetExists: vi.fn(async () => false) }),
    );

    expect("toolCalls" in allowed.body && allowed.body.toolCalls[0]).toMatchObject({ status: "ready" });
    expect("toolCalls" in denied.body && denied.body.toolCalls[0]).toMatchObject({ status: "rejected" });
    expect("errors" in denied.body && denied.body.errors[0]).toContain("not owned");
  });

  it("returns provider failures as structured errors", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "provider failure" }] },
      deps(),
    );

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      ok: false,
      provider: "mock",
      model: DEFAULT_CANVAS_ASSISTANT_MODEL,
      errors: ["Assistant provider failed."],
    });
  });

  it("maps provider rate failures to retryable assistant errors", async () => {
    const result = await orchestrateCanvasAssistant(
      basePayload,
      deps({
        provider: {
          name: "mock-rate",
          model: "test-model",
          generate: vi.fn(async () => {
            const error = new Error("rate limited") as Error & { status: number };
            error.status = 429;
            throw error;
          }),
        },
      }),
    );

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      ok: false,
      errors: ["The assistant provider is temporarily busy. Please wait a moment and try again."],
    });
  });

  it("passes transient visual preview data to providers without echoing base64 in responses", async () => {
    const provider = createMockCanvasAssistantProvider();
    const generate = vi.fn(provider.generate);
    provider.generate = generate;

    const result = await orchestrateCanvasAssistant(
      {
        ...basePayload,
        visualPreview: {
          status: "available",
          pageId: "page-1",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          width: 900,
          height: 600,
          bytes: 3,
        },
      },
      deps({ provider }),
    );

    const providerInput = generate.mock.calls[0][0];
    expect(providerInput.context.visualPreview).toMatchObject({
      status: "available",
      pageId: "page-1",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
      bytes: 3,
    });
    expect(JSON.stringify(result.body)).not.toContain("data:image");
    expect(JSON.stringify(providerInput.context.sceneSnapshot)).not.toContain("data:image");
  });

  it("rejects visual previews that do not match the active page", async () => {
    const result = await orchestrateCanvasAssistant(
      {
        ...basePayload,
        visualPreview: {
          status: "available",
          pageId: "page-2",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          width: 900,
          height: 600,
          bytes: 3,
        },
      },
      deps(),
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Visual preview does not match the active page." });
  });

  it("inspects uploaded assets by owned Kavero asset ID only", async () => {
    const provider = createMockCanvasAssistantProvider();
    const generate = vi.fn(provider.generate);
    provider.generate = generate;

    const result = await orchestrateCanvasAssistant(
      { ...basePayload, assetIdsToInspect: ["asset-1", "missing-asset"] },
      deps({ provider }),
    );

    expect(result.status).toBe(200);
    const providerAssets = generate.mock.calls[0][0].context.inspectedAssets;
    expect(providerAssets).toEqual([
      {
        assetId: "asset-1",
        status: "available",
        mimeType: "image/png",
        bytes: 1024,
        publicUrl: "/api/canvas/assets/asset-1",
      },
      {
        assetId: "missing-asset",
        status: "missing",
        mimeType: null,
        bytes: null,
        publicUrl: null,
      },
    ]);
    expect("context" in result.body && result.body.context.inspectedAssets).toHaveLength(2);
  });

  it("marks unsupported, missing, and oversized assets before provider use", async () => {
    const provider = createMockCanvasAssistantProvider();
    const generate = vi.fn(provider.generate);
    provider.generate = generate;

    await orchestrateCanvasAssistant(
      { ...basePayload, assetIdsToInspect: ["unsupported", "large", "missing"] },
      deps({
        provider,
        getOwnedAsset: vi.fn(async (_userId, assetId) => {
          if (assetId === "unsupported") {
            return { assetId, status: "available" as const, mimeType: "image/gif", bytes: 100, publicUrl: `/api/canvas/assets/${assetId}` };
          }
          if (assetId === "large") {
            return {
              assetId,
              status: "available" as const,
              mimeType: "image/png",
              bytes: 5 * 1024 * 1024,
              publicUrl: `/api/canvas/assets/${assetId}`,
            };
          }
          return null;
        }),
      }),
    );

    expect(generate.mock.calls[0][0].context.inspectedAssets.map((asset: { status: string }) => asset.status)).toEqual([
      "unsupported",
      "too_large",
      "missing",
    ]);
  });

  it("honors provider image limits for preview plus inspected assets", async () => {
    const provider = createMockCanvasAssistantProvider();
    const generate = vi.fn(provider.generate);
    provider.generate = generate;

    await orchestrateCanvasAssistant(
      {
        ...basePayload,
        visualPreview: {
          status: "available" as const,
          pageId: "page-1",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          width: 900,
          height: 600,
          bytes: 3,
        },
        assetIdsToInspect: ["asset-1", "asset-2", "asset-3", "asset-4"],
      },
      deps({
        provider,
        getOwnedAsset: vi.fn(async (_userId, assetId) => ({
          assetId,
          status: "available" as const,
          mimeType: "image/png",
          bytes: 100,
          publicUrl: `/api/canvas/assets/${assetId}`,
        })),
      }),
    );

    expect(generate.mock.calls[0][0].context.inspectedAssets).toHaveLength(3);
  });

  it("supports inspect-only design requests without tool calls", async () => {
    const provider = providerReturning([], "The current design has one selected heading.");
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "inspect current design" }] },
      deps({ provider }),
    );

    expect(result.status).toBe(200);
    expect("message" in result.body && result.body.message?.content).toBe("The current design has one selected heading.");
    expect("toolCalls" in result.body && result.body.toolCalls).toEqual([]);
    expect(vi.mocked(provider.generate).mock.calls[0][0].context).toMatchObject({
      selectedObjectIds: ["obj-1"],
      designId: "design-1",
      pageId: "page-1",
    });
  });

  it("validates move-one-object model calls", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "move selected object" }] },
      deps({
        provider: providerReturning([
          { id: "move-1", name: "transform_object", input: { objectId: "obj-1", left: 120, top: 180 } },
        ]),
      }),
    );

    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "move-1",
      name: "transform_object",
      status: "ready",
      summary: "Move or transform object obj-1.",
    });
  });

  it("validates align-related-objects model calls", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "align the related objects" }] },
      deps({
        provider: providerReturning([{ id: "align-1", name: "align_object", input: { objectId: "obj-1", alignment: "left" } }]),
      }),
    );

    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "align-1",
      name: "align_object",
      status: "ready",
      summary: "Align object obj-1.",
    });
  });

  it("validates add-uploaded-asset model calls against owned assets", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "add uploaded asset" }] },
      deps({
        provider: providerReturning([{ id: "asset-1-call", name: "add_uploaded_image", input: { assetId: "asset-1" } }]),
      }),
    );

    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "asset-1-call",
      name: "add_uploaded_image",
      status: "ready",
      summary: "Add uploaded asset asset-1.",
    });
  });

  it("validates update-text model calls", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "update the title text" }] },
      deps({
        provider: providerReturning([{ id: "update-text", name: "update_object", input: { objectId: "obj-1", props: { text: "Updated title" } } }]),
      }),
    );

    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "update-text",
      name: "update_object",
      status: "ready",
      summary: "Update object obj-1.",
    });
  });

  it("requires confirmation for destructive model calls in the full loop", async () => {
    const result = await orchestrateCanvasAssistant(
      { ...basePayload, messages: [{ role: "user", content: "delete the selected object" }] },
      deps({
        provider: providerReturning([{ id: "delete-1", name: "delete_objects", input: { objectIds: ["obj-1"] } }]),
      }),
    );

    expect("toolCalls" in result.body && result.body.toolCalls[0]).toMatchObject({
      id: "delete-1",
      name: "delete_objects",
      riskLevel: "high",
      status: "requires_confirmation",
      summary: "Delete 1 object. Confirmation is required.",
    });
  });
});
