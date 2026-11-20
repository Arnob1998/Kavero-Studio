import { describe, expect, it } from "vitest";
import {
  buildSetupValues,
  promptForGatewayProviders,
  setupGatewayProviders,
  promptForImageGeneration,
  runSetupWizard,
  setupImageGenerationChoices,
  setupLocalModels,
  setupApiModels,
  starterModelHubUrl,
} from "./setup-flow.mjs";
import { localProfiles } from "../../src/modules/model-providers/local/browser-profiles";
import { modelCatalog } from "../../src/modules/model-providers/catalog";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnvContent } from "./env-file.mjs";

function localDockerSecrets() {
  return {
    POSTGRES_PASSWORD: "postgres-secret",
    SUPABASE_JWT_SECRET: "jwt-secret",
    SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    LITELLM_MASTER_KEY: "sk-local-litellm",
    KAVERO_LITELLM_API_KEY: "sk-local-litellm",
    KAVERO_LITELLM_ROUTING_SECRET: "localRoutingSecret_012345678901234567890123456789",
  };
}

describe("setup flow values", () => {
  it.each(["local", "providers", "later"])("uses %s as a starter choice without disabling other sources", async source => {
    const inputs = {}, notes = [];
    const prompts = { isCancel: () => false, note: (...args) => notes.push(args), password: async () => "test-openai-key", select: async ({message}) => ({"Choose your first image-model source":source,"Choose your starting local image model":setupLocalModels[0].value,"Choose your starting image provider":"openai","Choose your starting provider image model":"kavero-image-openai-gpt-image-2"}[message]) };
    expect(await promptForImageGeneration({ prompts, inputs, platform: "win32", arch: "x64" })).toBe(source);
    const values = buildSetupValues({ profileId: "local-docker", authMode: "password", storageChoiceId: "kavero-managed-local-filesystem", inputs, dockerSecrets: localDockerSecrets() });
    expect(values.KAVERO_LOCAL_GENERATION_ENABLED).toBe(source === "local" ? "1" : undefined);
    expect(values.KAVERO_STORAGE_PROVIDER).toBe("kavero-managed");
    expect(Object.hasOwn(values, "OPENAI_API_KEY")).toBe(source === "providers");
    expect(Object.hasOwn(values, "GEMINI_API_KEY")).toBe(false);
    expect(notes.some(([text]) => text.includes("No model download or terms acceptance"))).toBe(source === "local");
    expect(notes.some(([text]) => text.includes("not an exclusive mode"))).toBe(true);
  });

  it("keeps Local first and offers only committed runtime/catalog models", () => {
    expect(setupImageGenerationChoices.map(choice => choice.value)).toEqual(["local", "providers", "later"]);
    expect(setupLocalModels.map(model => model.value)).toEqual(localProfiles.map(model => model.profile));
    for (const option of setupApiModels) expect(modelCatalog.some(model => model.modelAlias === option.value && model.displayLabel === option.label && model.capabilities.slots.includes("imageGeneration"))).toBe(true);
  });

  it.each([["linux", "x64"], ["win32", "arm64"]])("does not offer unsupported local Qwen on %s/%s", async (platform, arch) => {
    const inputs = {}, notes = [];
    const prompts = { isCancel: () => false, note: (...args) => notes.push(args), select: async options => { expect(options.options[0]).toMatchObject({value:"local",disabled:true});return "later"; } };
    expect(await promptForImageGeneration({ prompts, inputs, platform, arch })).toBe("later");
    expect(inputs.imageGeneration).toBe("later");
  });

  it.each([false, true])("local-only wizard skips API credentials and respects existing settings (allow updates: %s)", async allowUpdates => {
    const cwd = mkdtempSync(path.join(tmpdir(), "kavero-cli-local-test-")), notes = [];
    try {
      writeFileSync(path.join(cwd, ".env.docker.local"), "KAVERO_LOCAL_GENERATION_ENABLED=0\nOPENAI_API_KEY=keep-test-provider-key\n");
      const prompts = {
        intro() {}, outro() {}, isCancel: () => false, note: (...args) => notes.push(args),
        spinner: () => ({ start() {}, stop() {} }),
        select: async ({ message }) => ({ "Choose where Kavero runs": "local-docker", "Choose storage": "kavero-managed-local-filesystem", "Choose your first image-model source": "local", "Choose your starting local image model": setupLocalModels[1].value }[message]),
        text: async ({ initialValue }) => initialValue,
        confirm: async ({ message }) => message.startsWith("Update existing") && allowUpdates,
        multiselect: async () => { throw Error("Local-only wizard asked for API providers"); },
        password: async () => { throw Error("Local-only wizard asked for a provider key"); },
      };
      const result = await runSetupWizard({ prompts, cwd, platform: "win32", arch: "x64", runLocalDocker: async () => { throw Error("Unexpected Docker startup"); } });
      const values = parseEnvContent(readFileSync(path.join(cwd, ".env.docker.local"), "utf8")).values;
      expect(values.KAVERO_LOCAL_GENERATION_ENABLED).toBe(allowUpdates ? "1" : "0");
      expect(values.OPENAI_API_KEY).toBe("keep-test-provider-key");
      expect(values.KAVERO_AUTH_MODE).toBe("password");
      expect(values.KAVERO_MANAGED_STORAGE_BACKEND).toBe("local-filesystem");
      expect(result.preserved.includes("KAVERO_LOCAL_GENERATION_ENABLED")).toBe(!allowUpdates);
      expect(notes.some(([, title]) => title === "Existing setting preserved")).toBe(!allowUpdates);
      expect(notes.some(([text,title]) => title === "Your starting model" && text.includes("starterProfile=qwen-image-2.1-q3-evaluation"))).toBe(true);
    } finally {
      if (!path.resolve(cwd).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(cwd).startsWith("kavero-cli-local-test-")) throw Error("Unsafe CLI test cleanup");
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds model-specific Model Hub handoffs without making them global model defaults", () => {
    expect(starterModelHubUrl({KAVERO_APP_PORT:"3000",imageGeneration:"local",starterLocalProfile:setupLocalModels[1].value})).toBe("http://127.0.0.1:3000/settings/models?source=local&starterProfile=qwen-image-2.1-q3-evaluation");
    expect(starterModelHubUrl({KAVERO_APP_PORT:"3001",imageGeneration:"providers",starterModelAlias:setupApiModels[3].value})).toContain("source=cloud&starterModel=kavero-image-openai-gpt-image-2");
    expect(starterModelHubUrl({KAVERO_APP_PORT:"3000",imageGeneration:"later"})).toBe("http://127.0.0.1:3000/settings/models");
  });

  it("offers only supported gateway providers", () => {
    expect(setupGatewayProviders.map((provider) => provider.value)).toEqual([
      "gemini",
      "openai",
      "groq",
      "azure-openai",
      "azure-openai-image",
    ]);
  });

  it("prompts only for the selected gateway providers", async () => {
    const calls = [];
    const prompts = {
      isCancel: () => false,
      multiselect: async (options) => {
        calls.push(["multiselect", options]);
        return ["openai", "azure-openai-image"];
      },
      password: async (options) => {
        calls.push(["password", options]);
        return options.message.startsWith("OpenAI") ? "openai-key" : "azure-image-key";
      },
      text: async (options) => {
        calls.push(["text", options]);
        if (options.message.endsWith("endpoint")) return "https://images.openai.azure.com";
        if (options.message.endsWith("API version")) return "2024-02-01";
        return "image-deployment";
      },
    };
    const inputs = {};

    await promptForGatewayProviders({ prompts, inputs });

    expect(inputs).toEqual({
      OPENAI_API_KEY: "openai-key",
      AZURE_IMAGE_API_KEY: "azure-image-key",
      AZURE_IMAGE_API_BASE: "https://images.openai.azure.com",
      AZURE_IMAGE_API_VERSION: "2024-02-01",
      AZURE_IMAGE_DEPLOYMENT_NAME: "image-deployment",
      AZURE_IMAGE_BASE_MODEL: "gpt-image-2",
    });
    expect(calls[0][1].options.some((option) => option.value === "ollama")).toBe(false);
    expect(calls.some(([, options]) => options.message?.includes("Gemini"))).toBe(false);
    expect(calls.some(([, options]) => options.message?.includes("Groq"))).toBe(false);
    expect(calls.some(([, options]) => options.message === "Azure OpenAI endpoint")).toBe(false);
  });

  it("builds local Docker env values", () => {
    const values = buildSetupValues({
      profileId: "local-docker",
      authMode: "password",
      storageChoiceId: "kavero-managed-local-filesystem",
      inputs: {
        KAVERO_APP_PORT: "3001",
        SUPABASE_KONG_PORT: "54322",
        GEMINI_API_KEY: "gemini-key",
        OLLAMA_BASE_URL: "http://host.docker.internal:11434",
        AZURE_API_KEY: "azure-key-012345678901234567890",
        AZURE_API_BASE: "https://kavero.openai.azure.com",
        AZURE_API_VERSION: "2025-04-01-preview",
        AZURE_DEPLOYMENT_NAME: "deployment-one",
        AZURE_BASE_MODEL: "gpt-5.6-luna",
      },
      dockerSecrets: localDockerSecrets(),
    });

    expect(values).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54322",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3001",
      KAVERO_DEPLOYMENT_PROFILE: "local-first",
      KAVERO_AUTH_MODE: "password",
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
      KAVERO_LOCAL_STORAGE_ROOT: "/data/kavero-storage",
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: "http://litellm:4000",
      KAVERO_LITELLM_API_KEY: "sk-local-litellm",
      KAVERO_LITELLM_ROUTING_SECRET: "localRoutingSecret_012345678901234567890123456789",
      LITELLM_MASTER_KEY: "sk-local-litellm",
      GEMINI_API_KEY: "gemini-key",
      OPENAI_API_KEY: "",
      GROQ_API_KEY: "",
      OLLAMA_BASE_URL: "http://host.docker.internal:11434",
      AZURE_API_KEY: "azure-key-012345678901234567890",
      AZURE_API_BASE: "https://kavero.openai.azure.com",
      AZURE_API_VERSION: "2025-04-01-preview",
      AZURE_DEPLOYMENT_NAME: "deployment-one",
      AZURE_BASE_MODEL: "gpt-5.6-luna",
    });
  });

  it("rejects non-password auth for local Docker", () => {
    expect(() =>
      buildSetupValues({
        profileId: "local-docker",
        authMode: "google",
        storageChoiceId: "kavero-managed-local-filesystem",
        dockerSecrets: localDockerSecrets(),
      }),
    ).toThrow("Local Docker setup supports password auth only.");
  });

  it("builds cloud/self-host env values from selected storage", () => {
    const values = buildSetupValues({
      profileId: "cloud-self-host",
      authMode: "google-password",
      storageChoiceId: "kavero-managed-supabase",
      inputs: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
      },
    });

    expect(values).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      KAVERO_DEPLOYMENT_PROFILE: "cloud",
      KAVERO_AUTH_MODE: "google-password",
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "supabase-storage",
      KAVERO_MODEL_GATEWAY: "",
      KAVERO_LITELLM_BASE_URL: "",
      KAVERO_LITELLM_API_KEY: "",
      KAVERO_LITELLM_ROUTING_SECRET: "",
      LITELLM_MASTER_KEY: "",
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
      GROQ_API_KEY: "",
      OLLAMA_BASE_URL: "",
    });
  });

  it("builds cloud/self-host hosted LiteLLM gateway values when provided", () => {
    const values = buildSetupValues({
      profileId: "cloud-self-host",
      authMode: "password",
      storageChoiceId: "google-drive",
      inputs: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
        KAVERO_MODEL_GATEWAY: "litellm",
        KAVERO_LITELLM_BASE_URL: "https://litellm.example.com",
        KAVERO_LITELLM_API_KEY: "sk-hosted-app",
        KAVERO_LITELLM_ROUTING_SECRET: "hostedRoutingSecret_0123456789012345678901234567",
        OPENAI_API_KEY: "openai-key",
        OLLAMA_BASE_URL: "https://ollama.example.com",
      },
    });

    expect(values).toMatchObject({
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: "https://litellm.example.com",
      KAVERO_LITELLM_API_KEY: "sk-hosted-app",
      KAVERO_LITELLM_ROUTING_SECRET: "hostedRoutingSecret_0123456789012345678901234567",
      LITELLM_MASTER_KEY: "",
      OPENAI_API_KEY: "openai-key",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      OLLAMA_BASE_URL: "https://ollama.example.com",
    });
  });
});
