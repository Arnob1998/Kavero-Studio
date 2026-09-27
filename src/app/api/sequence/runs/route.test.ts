import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, maybeSingle, save, load, getResolvedModelProviderPreferences, validateSequenceCapabilities } = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  getResolvedModelProviderPreferences: vi.fn(),
  validateSequenceCapabilities: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const query = { eq: vi.fn(), maybeSingle };
    query.eq.mockImplementation(() => query);
    return {
      auth: { getUser },
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
    };
  }),
}));

vi.mock("@/modules/model-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/model-providers")>()),
  getResolvedModelProviderPreferences,
}));

vi.mock("@/modules/generation/sequence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/generation/sequence")>()),
  createSupabaseSequenceRepository: vi.fn(() => ({ save, load })),
  validateSequenceCapabilities,
}));

import { GET, POST, PUT } from "./route";

const input = {
  goal: "Create a two-frame launch",
  plannerModelAlias: "kavero-chat-orchestration-default",
  imageModelAlias: "kavero-image-generation-default",
  plannerCallsUsed: 1,
  revision: 2,
  references: [{
    id: "reference-1",
    label: "Product",
    role: "product",
    dataUrl: "data:image/png;base64,QQ==",
    mimeType: "image/png",
    byteSize: 1,
  }],
  plan: {
    title: "Launch",
    sequenceType: "carousel",
    countRationale: "Two beats",
    sharedRules: { style: "Editorial", subject: null, character: null, product: "Same product", palette: null, typography: null, composition: null },
    frames: [
      { id: "frame-1", purpose: "Introduce", prompt: "Hero", referenceIds: ["reference-1"], dependencies: [] },
      { id: "frame-2", purpose: "Use", prompt: "In use", referenceIds: ["reference-1"], dependencies: ["frame-1"] },
    ],
    warnings: [],
    assumptions: [],
  },
};

function post(body: unknown = input) {
  return new Request("http://localhost/api/sequence/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(body: unknown) {
  return new Request("http://localhost/api/sequence/runs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  maybeSingle.mockResolvedValue({ data: { preferences: {} }, error: null });
  getResolvedModelProviderPreferences.mockReturnValue({
    chatOrchestrationModelAlias: input.plannerModelAlias,
    imageGenerationModelAlias: input.imageModelAlias,
  });
  validateSequenceCapabilities.mockReturnValue([]);
  save.mockImplementation(async (record) => ({ status: "saved", record }));
});

describe("sequence run freeze API", () => {
  it("authenticates before parsing or persistence", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(new Request("http://localhost/api/sequence/runs", { method: "POST", body: "{" }));
    expect(response.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects invalid dependency graphs before persistence", async () => {
    const response = await POST(post({
      ...input,
      plan: { ...input.plan, frames: input.plan.frames.map((frame, index) => index === 0 ? { ...frame, dependencies: ["frame-2"] } : frame) },
    }));
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects stale selections and capability drift", async () => {
    getResolvedModelProviderPreferences.mockReturnValueOnce({
      chatOrchestrationModelAlias: "changed",
      imageGenerationModelAlias: input.imageModelAlias,
    });
    expect((await POST(post())).status).toBe(409);
    expect(save).not.toHaveBeenCalled();

    validateSequenceCapabilities.mockReturnValueOnce([{ code: "image-references-unavailable", message: "No references" }]);
    expect((await POST(post())).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("freezes an owner-scoped approved revision without reference bytes", async () => {
    const response = await POST(post());
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.sequence).toMatchObject({
      userId: "user-1",
      version: 1,
      execution: { status: "awaiting-approval", plannerCallsUsed: 1, imageCallsUsed: 0 },
      planRevisions: [{ revision: 2, imageModelAlias: input.imageModelAlias, approvedAt: expect.any(String) }],
    });
    expect(payload.sequence.planRevisions[0].references[0].source).not.toHaveProperty("dataUrl");
    expect(save).toHaveBeenCalledWith(expect.any(Object), 0);
  });

  it("loads only through the authenticated owner repository scope", async () => {
    load.mockResolvedValueOnce({ id: "sequence-1", userId: "user-1", version: 2 });
    const response = await GET(new Request("http://localhost/api/sequence/runs?id=sequence-1"));
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith("sequence-1", "user-1");
  });

  it("checkpoints start with compare-and-swap versions", async () => {
    await POST(post());
    const frozen = save.mock.calls[0][0];
    load.mockResolvedValueOnce(frozen);
    save.mockImplementationOnce(async (record) => ({ status: "saved", record }));
    const response = await PUT(put({
      action: "start",
      sequenceId: frozen.id,
      expectedVersion: 1,
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.sequence).toMatchObject({ version: 2, execution: { status: "running" } });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }), 1);
  });

  it("rejects stale checkpoint writers before applying an action", async () => {
    await POST(post());
    const frozen = { ...save.mock.calls[0][0], version: 3 };
    load.mockResolvedValueOnce(frozen);
    const response = await PUT(put({
      action: "start",
      sequenceId: frozen.id,
      expectedVersion: 1,
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ details: { code: "sequence-version-conflict", currentVersion: 3 } });
  });

  it("accepts a frame only after its generated image is visible in owner-scoped history", async () => {
    await POST(post());
    const frozen = save.mock.calls[0][0];

    load.mockResolvedValueOnce(frozen);
    await PUT(put({ action: "start", sequenceId: frozen.id, expectedVersion: 1 }));
    const running = save.mock.calls.at(-1)?.[0];

    const attemptId = "33333333-3333-4333-8333-333333333333";
    load.mockResolvedValueOnce(running);
    await PUT(put({ action: "attempt-start", sequenceId: frozen.id, expectedVersion: 2, frameId: "frame-1", attemptId }));
    const attempting = save.mock.calls.at(-1)?.[0];

    const generatedImageId = "44444444-4444-4444-8444-444444444444";
    load.mockResolvedValueOnce(attempting);
    maybeSingle.mockResolvedValueOnce({ data: { id: generatedImageId }, error: null });
    const response = await PUT(put({
      action: "attempt-success",
      sequenceId: frozen.id,
      expectedVersion: 3,
      attemptId,
      generatedImageId,
      modelAlias: input.imageModelAlias,
      prompt: "Hero\n\nKeep these approved sequence rules:\nstyle: Editorial\nproduct: Same product",
      referenceIds: ["reference-1"],
      sourceOutputIds: [],
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.sequence).toMatchObject({
      version: 4,
      outputs: [{ generatedImageId, frameId: "frame-1", acceptedAt: expect.any(String) }],
      planRevisions: [{ frames: [expect.objectContaining({ id: "frame-1", status: "accepted" }), expect.any(Object)] }],
    });
  });
});
