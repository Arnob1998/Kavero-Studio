import { describe, expect, it } from "vitest";
import { buildSetupValues } from "./setup-flow.mjs";

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
        AZURE_BASE_MODEL: "gpt-4.1",
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
      AZURE_BASE_MODEL: "gpt-4.1",
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
