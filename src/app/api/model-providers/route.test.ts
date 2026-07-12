import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET, PATCH } from "./route";

const envKeys = [
  "KAVERO_MODEL_GATEWAY",
  "KAVERO_LITELLM_BASE_URL",
  "KAVERO_LITELLM_API_KEY",
  "KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe("/api/model-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires auth", async () => {
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: null }));

    const response = (await GET())!;

    expect(response.status).toBe(401);
  });

  it("returns safe defaults and browser catalog without secrets", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_BASE_URL = "http://litellm:4000";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
    mocks.createClient.mockResolvedValue(createSupabaseClient({ preferences: null }));

    const response = (await GET())!;
    const body = await response.json();

    expect(body).toMatchObject({
      gateway: {
        status: "configured",
        gateway: "litellm",
        configured: true,
        issues: [],
      },
      credentialMode: "env-or-user",
      selected: {
        chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
      defaults: {
        chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
    });
    expect(body.catalog.length).toBeGreaterThan(0);
    expect(body.catalog[0]).not.toHaveProperty("model");
    expect(JSON.stringify(body)).not.toContain("http://litellm:4000");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it.each(["env-or-user", "user-required", "env-only"] as const)(
    "returns the safe %s credential mode without environment details",
    async (mode) => {
      process.env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE = mode;
      mocks.createClient.mockResolvedValue(createSupabaseClient({ preferences: null }));

      const response = (await GET())!;
      const body = await response.json();

      expect(body.credentialMode).toBe(mode);
      expect(JSON.stringify(body)).not.toContain("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE");
    },
  );

  it("saves valid aliases and preserves existing preferences", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    mocks.createClient.mockResolvedValue(
      createSupabaseClient({
        preferences: {
          theme: "dark",
          modelProviders: {
            collapsed: true,
            chatOrchestrationModelAlias: "kavero-chat-groq-example",
          },
        },
        upsert,
      }),
    );

    const response = (await PATCH(
      jsonRequest({
        chatOrchestrationModelAlias: "kavero-chat-openai-example",
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      }),
    ))!;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "user-1",
        preferences: {
          theme: "dark",
          modelProviders: {
            collapsed: true,
            chatOrchestrationModelAlias: "kavero-chat-openai-example",
            imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
          },
        },
      },
      { onConflict: "user_id" },
    );
    expect(body.selected).toEqual({
      chatOrchestrationModelAlias: "kavero-chat-openai-example",
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    });
  });

  it("rejects unknown aliases and wrong-slot aliases", async () => {
    mocks.createClient.mockResolvedValue(createSupabaseClient({ preferences: {} }));

    const unknown = (await PATCH(jsonRequest({ chatOrchestrationModelAlias: "missing" })))!;
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toMatchObject({ code: "unknown-alias" });

    const wrongSlot = (await PATCH(
      jsonRequest({ chatOrchestrationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS }),
    ))!;
    expect(wrongSlot.status).toBe(400);
    await expect(wrongSlot.json()).resolves.toMatchObject({ code: "wrong-slot" });
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/model-providers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createSupabaseClient(options: {
  user?: { id: string } | null;
  preferences?: unknown;
  upsert?: ReturnType<typeof vi.fn>;
}) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  const upsert = options.upsert ?? vi.fn(async () => ({ error: null }));

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table !== "user_metadata") throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: options.preferences === null ? null : { preferences: options.preferences ?? {} },
          error: null,
        })),
        upsert,
      };
      return query;
    }),
  };
}
