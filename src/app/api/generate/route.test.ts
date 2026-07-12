import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUserProviderCredentials: vi.fn(),
  normalizeUserPlan: vi.fn(),
  getGenerationLimit: vi.fn(),
  getGoogleDriveConnection: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  uploadGoogleDriveFile: vi.fn(),
  createGoogleDriveFolder: vi.fn(),
  updateGoogleDriveFolder: vi.fn(),
  markGoogleDriveFolderMissing: vi.fn(),
  isGoogleDriveMissingError: vi.fn(),
  createLocalFilesystemStorageBackend: vi.fn(),
  createSupabaseStorageBackend: vi.fn(),
  managedEnsureReady: vi.fn(),
  managedUploadObject: vi.fn(),
  managedDeleteObject: vi.fn(),
  generateContent: vi.fn(),
  googleGenAI: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  ThinkingLevel: { HIGH: "HIGH", MINIMAL: "MINIMAL" },
  GoogleGenAI: mocks.googleGenAI,
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
  getUserProviderCredentials: mocks.getUserProviderCredentials,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/plans", () => ({
  normalizeUserPlan: mocks.normalizeUserPlan,
  getGenerationLimit: mocks.getGenerationLimit,
}));

vi.mock("@/lib/google-drive", () => ({
  extensionForMimeType: (mimeType: string) => {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/heic") return "heic";
    if (mimeType === "image/heif") return "heif";
    return "png";
  },
  createGoogleDriveFolder: mocks.createGoogleDriveFolder,
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection: mocks.getGoogleDriveConnection,
  isGoogleDriveMissingError: mocks.isGoogleDriveMissingError,
  markGoogleDriveFolderMissing: mocks.markGoogleDriveFolderMissing,
  parseImageDataUrl: (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  },
  updateGoogleDriveFolder: mocks.updateGoogleDriveFolder,
  uploadGoogleDriveFile: mocks.uploadGoogleDriveFile,
}));

vi.mock("@/modules/storage/backends/supabase-storage/supabase-storage-backend", () => ({
  createSupabaseStorageBackend: mocks.createSupabaseStorageBackend,
}));

vi.mock("@/modules/storage/backends/local-filesystem/local-filesystem-backend", () => ({
  createLocalFilesystemStorageBackend: mocks.createLocalFilesystemStorageBackend,
}));

import { POST } from "./route";

type TableName = "user_metadata" | "generation_runs" | "generated_images";
type FetchMock = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function okImageResponse(data = "AAAA", text = "Generated text") {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text },
            { inlineData: { mimeType: "image/png", data } },
          ],
        },
      },
    ],
  };
}

function multiImageResponse(images: Array<{ data: string; mimeType?: string }>, text = "Generated text") {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text },
            ...images.map((image) => ({
              inlineData: { mimeType: image.mimeType ?? "image/png", data: image.data },
            })),
          ],
        },
      },
    ],
  };
}

function textOnlyResponse(text = "Only text") {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

function gatewayImageResponse(data = "BBBB", text = "Gateway generated text") {
  return {
    choices: [
      {
        message: {
          content: text,
          images: [
            {
              image_url: {
                url: `data:image/png;base64,${data}`,
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
  };
}

function gatewayJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "req-generate-1",
      "x-litellm-call-id": "call-generate-1",
      ...init.headers,
    },
  });
}

function enableGateway() {
  process.env.KAVERO_MODEL_GATEWAY = "litellm";
  process.env.KAVERO_LITELLM_BASE_URL = "http://litellm:4000";
  process.env.KAVERO_LITELLM_API_KEY = "sk-test-secret";
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function request(body: unknown) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function referenceImage(index: number, mimeType = "image/png") {
  return {
    dataUrl: `data:${mimeType};base64,AAAA${index}`,
    mimeType,
    name: `reference-${index}.png`,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Generate a polished product image.",
    model: "gemini-3.1-flash-image-preview",
    count: 1,
    thinking: "balanced",
    aspectRatio: "auto",
    imageSize: "1K",
    schema: "none",
    referenceImages: [],
    ...overrides,
  };
}

function createSupabaseClient(
  options: {
    user?: { id: string } | null;
    userError?: Error | null;
    metadataResult?: { data: { plan?: string; preferences?: unknown } | null; error: unknown | null };
    countResult?: { count: number | null; error: unknown | null };
  } = {},
) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  const userError = options.userError ?? null;
  const countResult = options.countResult ?? { count: 0, error: null };
  const metadataResult = options.metadataResult ?? { data: { plan: "premium", preferences: {} }, error: null };

  const from = vi.fn((table: TableName) => {
    if (table === "user_metadata") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => metadataResult),
      };
    }

    if (table === "generation_runs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(async () => countResult),
      };
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
  });

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: userError,
      })),
    },
    from,
  };
}

function createAdminClient() {
  const generationRunInsert = vi.fn(async (): Promise<{ error: unknown | null }> => ({ error: null }));
  const generatedImageInsert = vi.fn(async (): Promise<{ error: unknown | null }> => ({ error: null }));
  const generationRunDeleteEqUser = vi.fn(async (): Promise<{ error: unknown | null }> => ({ error: null }));
  const generationRunDeleteEqId = vi.fn(() => ({ eq: generationRunDeleteEqUser }));
  const generationRunDelete = vi.fn(() => ({ eq: generationRunDeleteEqId }));
  const from = vi.fn((table: TableName) => {
    if (table === "generation_runs") {
      return {
        insert: generationRunInsert,
        delete: generationRunDelete,
      };
    }

    if (table === "generated_images") {
      return {
        insert: generatedImageInsert,
      };
    }

    return {};
  });

  return {
    from,
    __mocks: {
      generationRunInsert,
      generatedImageInsert,
      generationRunDelete,
      generationRunDeleteEqId,
      generationRunDeleteEqUser,
    },
  };
}

function managedObject(
  purpose: "generated-image" | "generated-metadata",
  name: string,
  mimeType: string,
  objectKey = `users/user-1/${purpose}/${name}`,
  backendProviderId = "supabase-storage",
) {
  return {
    ref: {
      providerId: "kavero-managed",
      kind: "managed",
      purpose,
      objectKey,
      bucket: purpose === "generated-image" ? "kavero-generated-images" : "kavero-generated-metadata",
      path: objectKey,
      externalId: null,
      externalUrl: null,
      metadata: { backendProviderId, name, contentType: mimeType },
      status: "available",
      version: 1,
    },
    name,
    mimeType,
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("/api/generate POST", () => {
  let supabase: ReturnType<typeof createSupabaseClient>;
  let admin: ReturnType<typeof createAdminClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    supabase = createSupabaseClient();
    admin = createAdminClient();

    mocks.createClient.mockResolvedValue(supabase);
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.getUserProviderCredentials.mockResolvedValue(null);
    mocks.normalizeUserPlan.mockReturnValue("premium");
    mocks.getGenerationLimit.mockReturnValue(null);
    mocks.getGoogleDriveConnection.mockResolvedValue({
      folder_id: "folder-1",
    });
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mocks.uploadGoogleDriveFile.mockResolvedValue({
      id: "drive-file-1",
      name: "image.png",
      webViewLink: "https://drive.example/image",
    });
    mocks.createGoogleDriveFolder.mockResolvedValue({ id: "replacement-folder" });
    mocks.isGoogleDriveMissingError.mockReturnValue(false);
    mocks.managedEnsureReady.mockResolvedValue({
      providerId: "kavero-managed",
      kind: "managed",
      ready: true,
      connected: true,
    });
    mocks.managedUploadObject.mockImplementation(async (input: { purpose: "generated-image" | "generated-metadata"; name: string; mimeType: string; metadata?: Record<string, unknown> }) =>
      managedObject(
        input.purpose,
        input.name,
        input.mimeType,
        typeof input.metadata?.objectKey === "string" ? input.metadata.objectKey : undefined,
      ),
    );
    mocks.managedDeleteObject.mockResolvedValue(undefined);
    mocks.createSupabaseStorageBackend.mockReturnValue({
      id: "supabase-storage",
      kind: "managed",
      ensureReady: mocks.managedEnsureReady,
      uploadObject: mocks.managedUploadObject,
      deleteObject: mocks.managedDeleteObject,
    });
    mocks.createLocalFilesystemStorageBackend.mockReturnValue({
      id: "local-filesystem",
      kind: "managed",
      ensureReady: mocks.managedEnsureReady,
      uploadObject: vi.fn(async (input: { purpose: "generated-image" | "generated-metadata"; name: string; mimeType: string; metadata?: Record<string, unknown> }) =>
        managedObject(
          input.purpose,
          input.name,
          input.mimeType,
          typeof input.metadata?.objectKey === "string" ? input.metadata.objectKey : undefined,
          "local-filesystem",
        ),
      ),
      deleteObject: mocks.managedDeleteObject,
    });
    mocks.generateContent.mockResolvedValue(okImageResponse());
    mocks.googleGenAI.mockImplementation(function GoogleGenAI() {
      return {
      models: { generateContent: mocks.generateContent },
      };
    });
    delete process.env.KAVERO_STORAGE_PROVIDER;
    delete process.env.KAVERO_MANAGED_STORAGE_BACKEND;
    delete process.env.KAVERO_MODEL_GATEWAY;
    delete process.env.KAVERO_LITELLM_BASE_URL;
    delete process.env.KAVERO_LITELLM_API_KEY;
    delete process.env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE;
  });

  it("returns the current auth error for unauthenticated users", async () => {
    supabase = createSupabaseClient({ user: null });
    mocks.createClient.mockResolvedValueOnce(supabase);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toMatchObject({ error: "Sign in to generate images." });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
  });

  it("returns the current provider-key error when Gemini key is missing", async () => {
    mocks.getUserProviderApiKey.mockResolvedValueOnce(null);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(403);
    await expect(json(response)).resolves.toMatchObject({
      error: "Add your Gemini API key in Settings before generating.",
    });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns the current provider-key load error when the helper throws", async () => {
    mocks.getUserProviderApiKey.mockRejectedValueOnce(new Error("vault unavailable"));

    const response = await POST(request(validBody()));

    expect(response.status).toBe(500);
    await expect(json(response)).resolves.toMatchObject({
      error: "Unable to load your Gemini API key.",
    });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns the current invalid JSON error", async () => {
    const response = await POST(rawRequest("{"));

    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns the current validation error for missing prompt", async () => {
    const response = await POST(request(validBody({ prompt: "" })));
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid generation parameters.");
    expect(body.details).toMatchObject({ fieldErrors: { prompt: expect.any(Array) } });
  });

  it("returns the current validation error for invalid model", async () => {
    const response = await POST(request(validBody({ model: "not-a-model" })));
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid generation parameters.");
    expect(body.details).toMatchObject({ fieldErrors: { model: expect.any(Array) } });
  });

  it("returns the current validation error for invalid count bounds", async () => {
    const lowResponse = await POST(request(validBody({ count: 0 })));
    const highResponse = await POST(request(validBody({ count: 17 })));

    expect(lowResponse.status).toBe(400);
    expect(await json(lowResponse)).toMatchObject({
      error: "Invalid generation parameters.",
      details: { fieldErrors: { count: expect.any(Array) } },
    });
    expect(highResponse.status).toBe(400);
    expect(await json(highResponse)).toMatchObject({
      error: "Invalid generation parameters.",
      details: { fieldErrors: { count: expect.any(Array) } },
    });
  });

  it("returns the current validation error for unsupported reference image MIME type", async () => {
    const response = await POST(
      request(validBody({ referenceImages: [referenceImage(1, "image/gif")] })),
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid generation parameters.");
    expect(body.details).toMatchObject({ fieldErrors: { referenceImages: expect.any(Array) } });
  });

  it("enforces the current reference image limit for gemini-2.5-flash-image", async () => {
    const response = await POST(
      request(
        validBody({
          model: "gemini-2.5-flash-image",
          referenceImages: Array.from({ length: 4 }, (_, index) => referenceImage(index)),
        }),
      ),
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid generation parameters.",
      details: {
        fieldErrors: {
          referenceImages: ["Nano Banana supports up to 3 reference images."],
        },
      },
    });
  });

  it("enforces the current reference image limit for Gemini 3 image models", async () => {
    const response = await POST(
      request(
        validBody({
          model: "gemini-3-pro-image-preview",
          referenceImages: Array.from({ length: 15 }, (_, index) => referenceImage(index)),
        }),
      ),
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid generation parameters.",
      details: {
        fieldErrors: {
          referenceImages: ["Nano Banana Pro supports up to 14 reference images."],
        },
      },
    });
  });

  it("returns the current data URL MIME mismatch error after schema validation", async () => {
    const response = await POST(
      request(
        validBody({
          referenceImages: [
            {
              dataUrl: "data:image/jpeg;base64,AAAA",
              mimeType: "image/png",
              name: "reference.png",
            },
          ],
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({
      error: "reference.png mimeType does not match the data URL.",
    });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns generated image data URLs and model metadata from Gemini image output", async () => {
    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      model: "gemini-3.1-flash-image-preview",
      modelLabel: "Nano Banana 2",
      kind: "image",
      text: "Generated text",
      settings: {
        count: 1,
        thinking: "balanced",
        aspectRatio: "auto",
        imageSize: "1K",
        schema: "none",
      },
    });
    expect(body.images).toEqual([
      expect.objectContaining({
        variant: 1,
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
        text: "Generated text",
      }),
    ]);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
  });

  it("uses the selected image-generation alias through LiteLLM when the gateway is configured", async () => {
    enableGateway();
    const fetchImpl = vi.fn<FetchMock>(async () => gatewayJsonResponse(gatewayImageResponse()));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody({ count: 1 })));
    const body = await json(response);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      model: string;
      modalities: string[];
    };

    expect(response.status).toBe(200);
    expect(requestBody.model).toBe("kavero-image-generation-default");
    expect(requestBody.modalities).toEqual(["image", "text"]);
    expect(requestBody).not.toHaveProperty("api_key");
    expect(mocks.getUserProviderCredentials).toHaveBeenCalledWith("user-1", "google-gemini");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      model: "kavero-image-generation-default",
      modelLabel: "Nano Banana 2",
      kind: "image",
      text: "Gateway generated text",
    });
    expect(body.images).toEqual([
      expect.objectContaining({
        variant: 1,
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,BBBB",
        text: "Gateway generated text",
      }),
    ]);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('\\"credentialSource\\":\\"gateway-env\\"');
  });

  it("injects only trusted image credentials and strips reserved caller fields", async () => {
    enableGateway();
    mocks.getUserProviderCredentials.mockResolvedValueOnce({ apiKey: "user-gemini-key-0123456789" });
    const fetchImpl = vi.fn<FetchMock>(async () => gatewayJsonResponse(gatewayImageResponse()));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody({
      api_key: "browser-key",
      api_base: "https://browser.invalid",
      base_url: "https://browser.invalid",
      api_version: "browser-version",
      user_config: { api_key: "nested-browser-key" },
    })));
    const outbound = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    expect(response.status).toBe(200);
    expect(outbound.api_key).toBe("user-gemini-key-0123456789");
    expect(outbound).not.toHaveProperty("api_base");
    expect(outbound).not.toHaveProperty("base_url");
    expect(outbound).not.toHaveProperty("api_version");
    expect(outbound).not.toHaveProperty("user_config");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('\\"credentialSource\\":\\"user-byok\\"');
  });

  it("rejects missing required image credentials before any provider call", async () => {
    enableGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "user-required");
    const fetchImpl = vi.fn<FetchMock>();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(403);
    await expect(json(response)).resolves.toMatchObject({ details: { code: "provider-credentials-required" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("uses env-only without loading user credentials", async () => {
    enableGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "env-only");
    const fetchImpl = vi.fn<FetchMock>(async () => gatewayJsonResponse(gatewayImageResponse()));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody()));
    const outbound = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    expect(response.status).toBe(200);
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
    expect(outbound).not.toHaveProperty("api_key");
  });

  it("fails safely when the image credential store is unavailable", async () => {
    enableGateway();
    mocks.getUserProviderCredentials.mockRejectedValueOnce(new Error("vault secret payload"));
    const fetchImpl = vi.fn<FetchMock>();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ details: { code: "provider-credentials-unavailable" } });
    expect(JSON.stringify(body)).not.toContain("vault secret payload");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("falls back to the image-generation default when the stored alias is for the wrong slot", async () => {
    enableGateway();
    supabase = createSupabaseClient({
      metadataResult: {
        data: {
          plan: "premium",
          preferences: {
            modelProviders: {
              imageGenerationModelAlias: "kavero-chat-orchestration-default",
            },
          },
        },
        error: null,
      },
    });
    mocks.createClient.mockResolvedValue(supabase);
    const fetchImpl = vi.fn<FetchMock>(async () => gatewayJsonResponse(gatewayImageResponse()));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody()));
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { model: string };

    expect(response.status).toBe(200);
    expect(requestBody.model).toBe("kavero-image-generation-default");
  });

  it("persists gateway generations with generic alias and label metadata", async () => {
    enableGateway();
    vi.stubGlobal("fetch", vi.fn(async () => gatewayJsonResponse(gatewayImageResponse("CCCC"))));

    const response = await POST(request(validBody({ prompt: "Gateway product image" })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.model).toBe("kavero-image-generation-default");
    expect(admin.__mocks.generationRunInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        prompt: "Gateway product image",
        model_id: "kavero-image-generation-default",
        model_label: "Nano Banana 2",
        storage_provider: "google-drive",
      }),
    );
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mime_type: "image/png",
        storage_provider: "google-drive",
      }),
    );
  });

  it("preserves partial generation warning behavior on the gateway path", async () => {
    enableGateway();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(gatewayJsonResponse(gatewayImageResponse("DDDD", "First gateway result")))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "contains data:image/png;base64,SECRET" } }), {
          status: 503,
          headers: { "x-litellm-call-id": "call-failed" },
        }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody({ count: 2 })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(body.text).toBe("First gateway result");
    expect(body.warnings).toEqual([
      "One or more generations failed. Please try again.",
      "Saved 1 image to Google Drive.",
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("returns a safe error for empty gateway image responses", async () => {
    enableGateway();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        gatewayJsonResponse({
          choices: [{ message: { content: "No image", images: [] } }],
        }),
      ),
    );

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Image generation returned an invalid response.",
      details: { warnings: ["One or more generations failed. Please try again."] },
    });
    expect(JSON.stringify(body)).not.toContain("data:image");
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns a safe gateway configuration error without falling back to Gemini", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    delete process.env.KAVERO_LITELLM_BASE_URL;
    process.env.KAVERO_LITELLM_API_KEY = "sk-test-secret";

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    await expect(json(response)).resolves.toMatchObject({
      error: "Image generation model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("preserves current partial Gemini failure warning behavior", async () => {
    mocks.generateContent
      .mockReset()
      .mockResolvedValueOnce(okImageResponse("AAAA", "First result"))
      .mockRejectedValueOnce(new Error("Gemini failed"));

    const response = await POST(request(validBody({ count: 2 })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(body.text).toBe("First result");
    expect(body.warnings).toEqual([
      "One or more generations failed. Please try again.",
      "Saved 1 image to Google Drive.",
    ]);
  });

  it("returns the current error when the model returns no image", async () => {
    mocks.generateContent.mockResolvedValueOnce(textOnlyResponse("Only text"));

    const response = await POST(request(validBody()));

    expect(response.status).toBe(500);
    await expect(json(response)).resolves.toMatchObject({
      error: "Only text",
      details: { warnings: [] },
    });
  });

  it("keeps current imageSize behavior for gemini-2.5-flash-image", async () => {
    const response = await POST(
      request(validBody({ model: "gemini-2.5-flash-image", aspectRatio: "auto", imageSize: "4K" })),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash-image",
        config: expect.objectContaining({
          imageConfig: undefined,
          thinkingConfig: undefined,
        }),
      }),
    );
    expect(body.warnings).toContain(
      "Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.",
    );
  });

  it("keeps current imageSize and aspectRatio behavior for Gemini 3 image models", async () => {
    const response = await POST(
      request(
        validBody({
          model: "gemini-3-pro-image-preview",
          aspectRatio: "16:9",
          imageSize: "2K",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3-pro-image-preview",
        config: expect.objectContaining({
          imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
          thinkingConfig: undefined,
        }),
      }),
    );
  });

  it("sends thinking config only for gemini-3.1-flash-image-preview", async () => {
    await POST(request(validBody({ model: "gemini-3.1-flash-image-preview", thinking: "deep" })));
    expect(mocks.generateContent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-flash-image-preview",
        config: expect.objectContaining({ thinkingConfig: { thinkingLevel: "HIGH" } }),
      }),
    );

    mocks.generateContent.mockClear();
    await POST(request(validBody({ model: "gemini-3-pro-image-preview", thinking: "deep" })));

    expect(mocks.generateContent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "gemini-3-pro-image-preview",
        config: expect.objectContaining({ thinkingConfig: undefined }),
      }),
    );
  });

  it("attempts generation run insert, Drive uploads, and generated image insert on successful generation", async () => {
    const response = await POST(request(validBody({ prompt: "A clean product image" })));

    expect(response.status).toBe(200);
    expect(admin.__mocks.generationRunInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        prompt: "A clean product image",
        model_id: "gemini-3.1-flash-image-preview",
        model_label: "Nano Banana 2",
        storage_provider: "google-drive",
      }),
    );
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(2);
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        variant: 1,
        mime_type: "image/png",
        drive_file_id: "drive-file-1",
        drive_file_name: "image.png",
        drive_web_view_link: "https://drive.example/image",
        drive_metadata_file_id: "drive-file-1",
        drive_status: "available",
        storage_provider: "google-drive",
        storage_kind: "connected",
        storage_status: "available",
        storage_ref: expect.objectContaining({
          providerId: "google-drive",
          kind: "connected",
          purpose: "generated-image",
          externalId: "drive-file-1",
          externalUrl: "https://drive.example/image",
          status: "available",
        }),
        metadata_storage_ref: expect.objectContaining({
          providerId: "google-drive",
          kind: "connected",
          purpose: "generated-metadata",
          externalId: "drive-file-1",
          status: "available",
        }),
        storage_metadata: {
          providerId: "google-drive",
          imageObjectName: "image.png",
          metadataObjectName: "image.png",
        },
        storage_external_id: "drive-file-1",
        storage_external_url: "https://drive.example/image",
      }),
    );
  });

  it("uses the current Google Drive path when storage provider env is missing", async () => {
    delete process.env.KAVERO_STORAGE_PROVIDER;

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(2);
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
  });

  it("uses the current Google Drive path when storage provider env is empty", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "   ";

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(2);
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
  });

  it("falls back to Google Drive when storage provider env is invalid", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "typo-provider";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring invalid KAVERO_STORAGE_PROVIDER value"),
    );
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(2);
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
  });

  it("saves generated image and metadata through managed storage when explicitly enabled", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";

    const response = await POST(request(validBody({ prompt: "Managed product image" })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Kavero storage."]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(mocks.createSupabaseStorageBackend).toHaveBeenCalledTimes(1);
    expect(mocks.managedEnsureReady).toHaveBeenCalledWith({
      userId: "user-1",
      purpose: "generated-image",
    });
    expect(mocks.managedEnsureReady).toHaveBeenCalledWith({
      userId: "user-1",
      purpose: "generated-metadata",
    });
    expect(mocks.managedUploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        purpose: "generated-image",
        mimeType: "image/png",
        metadata: expect.objectContaining({
          objectKey: expect.stringContaining("/generated-images/"),
        }),
      }),
    );
    expect(mocks.managedUploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        purpose: "generated-metadata",
        mimeType: "application/json",
        metadata: expect.objectContaining({
          objectKey: expect.stringContaining("/generated-metadata/"),
        }),
      }),
    );
    expect(admin.__mocks.generationRunInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_provider: "kavero-managed",
      }),
    );
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        storage_provider: "kavero-managed",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          purpose: "generated-image",
          metadata: expect.objectContaining({ backendProviderId: "supabase-storage" }),
        }),
        metadata_storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          purpose: "generated-metadata",
          metadata: expect.objectContaining({ backendProviderId: "supabase-storage" }),
        }),
        storage_external_id: null,
        storage_external_url: null,
      }),
    );
  });

  it("saves generated image and metadata through local filesystem when configured", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    process.env.KAVERO_MANAGED_STORAGE_BACKEND = "local-filesystem";

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Kavero storage."]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).toHaveBeenCalledWith({
      env: expect.objectContaining({ KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem" }),
    });
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_provider: "kavero-managed",
        storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          metadata: expect.objectContaining({ backendProviderId: "local-filesystem" }),
        }),
        metadata_storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          metadata: expect.objectContaining({ backendProviderId: "local-filesystem" }),
        }),
        storage_metadata: expect.objectContaining({
          providerId: "kavero-managed",
          backendProviderId: "local-filesystem",
        }),
      }),
    );
  });

  it("returns a non-blocking warning when managed buckets are not configured", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.managedEnsureReady.mockRejectedValueOnce(new Error("bucket missing"));

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Generated images are ready, but Kavero could not save them to managed storage.",
    ]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(mocks.managedUploadObject).not.toHaveBeenCalled();
    expect(admin.__mocks.generationRunInsert).not.toHaveBeenCalled();
  });

  it("preserves managed partial image-save warning behavior when multiple generated images exist", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.generateContent.mockResolvedValueOnce(
      multiImageResponse([
        { data: "AAAA" },
        { data: "BBBB" },
      ]),
    );
    admin.__mocks.generatedImageInsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("second image insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Saved 1/2 images to Kavero storage. Download any unsaved images you want to keep.",
    ]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.generationRunDelete).not.toHaveBeenCalled();
  });

  it("cleans up managed image and metadata objects when DB image insert fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    admin.__mocks.generatedImageInsert.mockResolvedValueOnce({
      error: new Error("image insert failed"),
    });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to managed storage."]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.managedDeleteObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "kavero-managed",
        purpose: "generated-image",
      }),
    });
    expect(mocks.managedDeleteObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "kavero-managed",
        purpose: "generated-metadata",
      }),
    });
    expect(admin.__mocks.generationRunDelete).toHaveBeenCalled();
  });

  it("cleans up managed image object when metadata upload fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.managedUploadObject.mockImplementation(
      async (input: { purpose: "generated-image" | "generated-metadata"; name: string; mimeType: string }) => {
        if (input.purpose === "generated-metadata") {
          throw new Error("metadata upload failed");
        }
        return managedObject(input.purpose, input.name, input.mimeType);
      },
    );

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to managed storage."]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(1);
    expect(mocks.managedDeleteObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "kavero-managed",
        purpose: "generated-image",
      }),
    });
    expect(admin.__mocks.generationRunDelete).toHaveBeenCalled();
  });

  it("cleans up only failed managed image refs during partial saves", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.generateContent.mockResolvedValueOnce(
      multiImageResponse([
        { data: "AAAA" },
        { data: "BBBB" },
      ]),
    );
    admin.__mocks.generatedImageInsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("second image insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);
    const deletedObjectKeys = mocks.managedDeleteObject.mock.calls.map(
      ([input]) => input.ref.objectKey,
    );
    const insertedRows = (
      admin.__mocks.generatedImageInsert.mock.calls as unknown as Array<[
        {
          storage_ref: { objectKey: string };
          metadata_storage_ref: { objectKey: string };
        },
      ]>
    ).map(([row]) => row);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Saved 1/2 images to Kavero storage. Download any unsaved images you want to keep.",
    ]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(2);
    expect(
      insertedRows.some(
        (row) =>
          deletedObjectKeys.includes(row.storage_ref.objectKey) &&
          deletedObjectKeys.includes(row.metadata_storage_ref.objectKey),
      ),
    ).toBe(true);
    expect(
      insertedRows.some(
        (row) =>
          !deletedObjectKeys.includes(row.storage_ref.objectKey) &&
          !deletedObjectKeys.includes(row.metadata_storage_ref.objectKey),
      ),
    ).toBe(true);
    expect(admin.__mocks.generationRunDelete).not.toHaveBeenCalled();
  });

  it("cleans up all uploaded managed refs when every image insert fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.generateContent.mockResolvedValueOnce(
      multiImageResponse([
        { data: "AAAA" },
        { data: "BBBB" },
      ]),
    );
    admin.__mocks.generatedImageInsert
      .mockResolvedValueOnce({ error: new Error("first image insert failed") })
      .mockResolvedValueOnce({ error: new Error("second image insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to managed storage."]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(4);
    expect(admin.__mocks.generationRunDelete).toHaveBeenCalled();
  });

  it("does not crash generation when managed cleanup fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    admin.__mocks.generatedImageInsert.mockResolvedValueOnce({
      error: new Error("image insert failed"),
    });
    mocks.managedDeleteObject.mockRejectedValueOnce(new Error("cleanup failed"));

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to managed storage."]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(2);
    expect(admin.__mocks.generationRunDelete).toHaveBeenCalled();
  });

  it("treats managed missing-object cleanup as safe when backend delete resolves", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    admin.__mocks.generatedImageInsert.mockResolvedValueOnce({
      error: new Error("image insert failed"),
    });
    mocks.managedDeleteObject.mockResolvedValue(undefined);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to managed storage."]);
    expect(mocks.managedDeleteObject).toHaveBeenCalledTimes(2);
  });

  it("does not upload or clean up managed objects when generation run insert fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    admin.__mocks.generationRunInsert.mockResolvedValueOnce({
      error: new Error("generation run insert failed"),
    });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Generated images are ready, but Kavero could not save the generation metadata.",
    ]);
    expect(mocks.managedUploadObject).not.toHaveBeenCalled();
    expect(mocks.managedDeleteObject).not.toHaveBeenCalled();
  });

  it("preserves current non-blocking warning behavior when Drive connection is missing", async () => {
    mocks.getGoogleDriveConnection.mockResolvedValueOnce(null);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Connect Google Drive in Settings or Gallery to save generated history."]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
  });

  it("preserves current quota full warning behavior", async () => {
    supabase = createSupabaseClient({ countResult: { count: 20, error: null } });
    mocks.createClient.mockResolvedValue(supabase);
    mocks.normalizeUserPlan.mockReturnValue("free");
    mocks.getGenerationLimit.mockReturnValue(20);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Free plan gallery storage is full (20/20 generations). Remove a generation from Gallery or upgrade before saving more.",
    ]);
    expect(mocks.getGoogleDriveConnection).not.toHaveBeenCalled();
    expect(admin.__mocks.generationRunInsert).not.toHaveBeenCalled();
  });

  it("preserves current quota count failure warning behavior", async () => {
    supabase = createSupabaseClient({
      countResult: { count: null, error: new Error("count failed") },
    });
    mocks.createClient.mockResolvedValue(supabase);
    mocks.normalizeUserPlan.mockReturnValue("free");
    mocks.getGenerationLimit.mockReturnValue(20);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Generated images are ready, but Kavero could not check your gallery generation limit.",
    ]);
    expect(mocks.getGoogleDriveConnection).not.toHaveBeenCalled();
    expect(admin.__mocks.generationRunInsert).not.toHaveBeenCalled();
  });

  it("preserves current missing Drive token warning behavior", async () => {
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValueOnce(null);

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Google Drive is connected, but Kavero could not refresh Drive access.",
    ]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.generationRunInsert).not.toHaveBeenCalled();
  });

  it("recovers from a missing Drive folder and retries upload in the replacement folder", async () => {
    const missingFolderError = new Error("missing folder");
    mocks.uploadGoogleDriveFile
      .mockRejectedValueOnce(missingFolderError)
      .mockResolvedValueOnce({
        id: "replacement-image-file",
        name: "replacement-image.png",
        webViewLink: "https://drive.example/replacement-image",
      })
      .mockResolvedValueOnce({
        id: "replacement-metadata-file",
        name: "replacement-image.json",
        webViewLink: "https://drive.example/replacement-metadata",
      });
    mocks.isGoogleDriveMissingError.mockImplementation((error) => error === missingFolderError);
    mocks.createGoogleDriveFolder.mockResolvedValueOnce({ id: "replacement-folder" });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Saved 1 image to Google Drive."]);
    expect(mocks.isGoogleDriveMissingError).toHaveBeenCalledWith(missingFolderError);
    expect(mocks.markGoogleDriveFolderMissing).toHaveBeenCalledWith("user-1");
    expect(mocks.createGoogleDriveFolder).toHaveBeenCalledWith("drive-token");
    expect(mocks.updateGoogleDriveFolder).toHaveBeenCalledWith("user-1", "replacement-folder");
    expect(mocks.uploadGoogleDriveFile).toHaveBeenNthCalledWith(
      2,
      "drive-token",
      expect.objectContaining({ folderId: "replacement-folder" }),
    );
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledWith(
      expect.objectContaining({ drive_file_id: "replacement-image-file" }),
    );
  });

  it("preserves current partial image-save warning when multiple generated images exist", async () => {
    mocks.generateContent.mockResolvedValueOnce(
      multiImageResponse([
        { data: "AAAA" },
        { data: "BBBB" },
      ]),
    );
    admin.__mocks.generatedImageInsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("second image insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.images).toEqual([
      expect.objectContaining({ dataUrl: "data:image/png;base64,AAAA", variant: 1 }),
      expect.objectContaining({ dataUrl: "data:image/png;base64,BBBB", variant: 1 }),
    ]);
    expect(body.warnings).toEqual([
      "Saved 1/2 images to Google Drive. Download any unsaved images you want to keep.",
    ]);
    expect(admin.__mocks.generatedImageInsert).toHaveBeenCalledTimes(2);
    expect(admin.__mocks.generationRunDelete).not.toHaveBeenCalled();
  });

  it("preserves current generation run metadata insert failure warning behavior", async () => {
    admin.__mocks.generationRunInsert.mockResolvedValueOnce({ error: new Error("run insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual([
      "Generated images are ready, but Kavero could not save the generation metadata.",
    ]);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.generatedImageInsert).not.toHaveBeenCalled();
  });

  it("cleans up the generation run when zero generated images are saved", async () => {
    admin.__mocks.generatedImageInsert.mockResolvedValueOnce({ error: new Error("insert failed") });

    const response = await POST(request(validBody()));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.warnings).toEqual(["Generated images could not be saved to Google Drive."]);
    expect(admin.__mocks.generationRunDelete).toHaveBeenCalled();
    expect(admin.__mocks.generationRunDeleteEqId).toHaveBeenCalledWith("id", expect.any(String));
    expect(admin.__mocks.generationRunDeleteEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });
});
