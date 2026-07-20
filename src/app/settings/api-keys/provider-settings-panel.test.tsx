import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";
import { ProviderSettingsPanel } from "./provider-settings-panel";

type CredentialMode = "env-or-user" | "user-required" | "env-only";

let credentialMode: CredentialMode;
let savedProviderKeys: Array<Record<string, unknown>>;

describe("ProviderSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialMode = "env-or-user";
    savedProviderKeys = [];
    vi.stubGlobal("fetch", vi.fn(fetchMock));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all supported provider-key providers and keeps model slots separate", async () => {
    render(<ProviderSettingsPanel />);

    expect(await screen.findByText("Orchestration/chat model")).toBeInTheDocument();
    expect(screen.getByText("Image-generation model")).toBeInTheDocument();
    const [chatSelect, imageSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect([chatSelect, imageSelect]).toHaveLength(2);
    for (const label of ["Google Gemini", "OpenAI", "Groq", "Azure OpenAI", "OpenAI-compatible"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Hugging Face")).not.toBeInTheDocument();
    expect(screen.queryByText("Ollama", { selector: "button *" })).not.toBeInTheDocument();
    expect(screen.queryByText("http://litellm:4000")).not.toBeInTheDocument();
    expect(screen.queryByText("sk-secret")).not.toBeInTheDocument();

    expect(Array.from(chatSelect!.options, (option) => option.value)).toContain("kavero-chat-azure-openai");
    expect(Array.from(chatSelect!.options, (option) => option.value)).toContain("kavero-chat-openai-gpt-5-6");
    expect(Array.from(imageSelect!.options, (option) => option.value)).not.toContain("kavero-chat-azure-openai");
    expect(Array.from(imageSelect!.options, (option) => option.value)).toContain("kavero-image-openai-gpt-image-2");

    const azureButton = screen.getByRole("button", { name: "Azure OpenAI provider settings" });
    expect(azureButton.querySelector("img")).toHaveAttribute("src", "/llm-providers/Microsoft_Azure.svg");
  });

  it("keeps existing Gemini saved metadata compatible without displaying secret values", async () => {
    savedProviderKeys = [
      {
        id: "key-gemini",
        provider_id: "google-gemini",
        provider_label: "Google Gemini",
        key_hint: "...1234",
        status: "active",
        last_checked_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
        api_key: "AIza-hidden-secret",
        api_base: "https://saved-base.example/private",
      },
    ];

    render(<ProviderSettingsPanel />);

    expect(await screen.findByText("Saved ...1234")).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.1234 is saved/)).toBeInTheDocument();
    expect(screen.queryByText(/AIza-hidden-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved-base\.example/)).not.toBeInTheDocument();
  });

  it.each([
    ["OpenAI", "openai", "sk-openai-012345678901234567890"],
    ["Groq", "groq", "gsk_groq_012345678901234567890"],
  ])("checks and saves %s with the exact single-key payload", async (label, providerId, apiKey) => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);

    await screen.findByText("Provider keys");
    await user.click(screen.getByRole("button", { name: `${label} provider settings` }));
    const input = screen.getByLabelText(`${label} API key`);
    await user.type(input, apiKey);
    await user.click(screen.getByRole("button", { name: "Check key" }));

    await screen.findByText("Live check passed. Credentials are ready to save.");
    await user.click(screen.getByRole("button", { name: "Save credentials" }));
    await screen.findByText("Credentials saved. Re-enter all required fields to replace them.");

    expect(requestBodies("/api/provider-keys/check")).toContainEqual({
      providerId,
      credentials: { apiKey },
    });
    expect(requestBodies("/api/provider-keys")).toContainEqual({
      providerId,
      credentials: { apiKey },
    });
    expect(input).toHaveValue("");
  });

  it("live-checks and saves Azure OpenAI credentials, then clears every field", async () => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);
    await screen.findByText("Provider keys");
    await user.click(screen.getByRole("button", { name: "Azure OpenAI provider settings" }));

    const apiKeyInput = screen.getByLabelText("Azure OpenAI API key");
    const apiBaseInput = screen.getByLabelText("Azure OpenAI Azure endpoint");
    const apiVersionInput = screen.getByLabelText("Azure OpenAI API version");
    const deploymentInput = screen.getByLabelText("Azure OpenAI Deployment name");
    const baseModelInput = screen.getByLabelText("Azure OpenAI Model family");
    await user.type(apiKeyInput, "azure-key-012345678901234567890");
    await user.type(apiBaseInput, "https://kavero.openai.azure.com");
    await user.type(apiVersionInput, "2025-04-01-preview");
    await user.type(deploymentInput, "deployment-one");
    await user.selectOptions(baseModelInput, "gpt-4.1");
    await user.click(screen.getByRole("button", { name: "Check key" }));
    await screen.findByText("Live check passed. Credentials are ready to save.");
    await user.click(screen.getByRole("button", { name: "Save credentials" }));

    const expected = {
      providerId: "azure-openai",
      credentials: {
        apiKey: "azure-key-012345678901234567890",
        apiBase: "https://kavero.openai.azure.com",
        apiVersion: "2025-04-01-preview",
        deploymentName: "deployment-one",
        baseModel: "gpt-4.1",
      },
    };
    expect(requestBodies("/api/provider-keys/check")).toContainEqual(expected);
    expect(requestBodies("/api/provider-keys")).toContainEqual(expected);
    expect(apiKeyInput).toHaveValue("");
    expect(apiBaseInput).toHaveValue("");
    expect(apiVersionInput).toHaveValue("");
    expect(deploymentInput).toHaveValue("");
    expect(baseModelInput).toHaveValue("");
  });

  it("omits the optional OpenAI-compatible API key when it is blank", async () => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);
    await screen.findByText("Provider keys");
    await user.click(screen.getByRole("button", { name: "OpenAI-compatible provider settings" }));
    await user.type(screen.getByLabelText("OpenAI-compatible API base URL"), "https://models.example.com/v1");
    await user.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("Credentials validated locally. A live check is not available.");
    await user.click(screen.getByRole("button", { name: "Save credentials" }));

    expect(requestBodies("/api/provider-keys/check")).toContainEqual({
      providerId: "openai-compatible",
      credentials: { apiBase: "https://models.example.com/v1" },
    });
    expect(requestBodies("/api/provider-keys")).toContainEqual({
      providerId: "openai-compatible",
      credentials: { apiBase: "https://models.example.com/v1" },
    });
  });

  it("renders fixed safe check failure copy instead of raw provider payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/provider-keys/check") {
        return jsonResponse({ status: "failed", message: "raw sk-secret provider response" });
      }
      return fetchMock(input, init);
    }));
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);

    const input = await screen.findByLabelText("Google Gemini API key");
    await user.type(input, "AIzaSy0123456789012345678901234");
    await user.click(screen.getByRole("button", { name: "Check key" }));

    expect(await screen.findByText("Check failed. Confirm the submitted fields and try again.")).toBeInTheDocument();
    expect(screen.queryByText(/raw sk-secret/)).not.toBeInTheDocument();
  });

  it.each([
    ["env-or-user", /saved user key is used when available.*gateway environment credentials are used/i],
    ["user-required", /requires a saved Google Gemini key before it can run/i],
    ["env-only", /gateway runtime uses administrator\/environment credentials/i],
  ] as const)("renders the %s credential-mode advisory", async (mode, expected) => {
    credentialMode = mode;
    render(<ProviderSettingsPanel />);
    expect(await screen.findAllByText(expected)).not.toHaveLength(0);
  });

  it("preserves model selection saves and gateway connectivity checks", async () => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);
    const selectors = await screen.findAllByRole("combobox");
    await user.selectOptions(selectors[0]!, "kavero-chat-openai-gpt-5-6");
    await user.click(screen.getByRole("button", { name: "Save models" }));
    await screen.findByText("Model settings saved.");
    await user.click(screen.getByRole("button", { name: "Check connectivity" }));

    expect(requestBodies("/api/model-providers")).toContainEqual({
      chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    });
    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        "/api/model-providers/connectivity",
        { method: "POST" },
      );
    });
  });

  it("saves GPT Image 2 independently from the orchestration model", async () => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);
    const selectors = await screen.findAllByRole("combobox");
    await user.selectOptions(selectors[0]!, "kavero-chat-azure-openai");
    await user.selectOptions(selectors[1]!, "kavero-image-openai-gpt-image-2");
    await user.click(screen.getByRole("button", { name: "Save models" }));

    expect(requestBodies("/api/model-providers")).toContainEqual({
      chatOrchestrationModelAlias: "kavero-chat-azure-openai",
      imageGenerationModelAlias: "kavero-image-openai-gpt-image-2",
    });
  });
});

async function fetchMock(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);

  if (url === "/api/provider-keys" && !init?.method) {
    return jsonResponse({ providerKeys: savedProviderKeys, providers: providerCatalog });
  }
  if (url === "/api/provider-keys/check" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { providerId: string };
    const validationOnly = body.providerId === "openai-compatible";
    return jsonResponse({ status: validationOnly ? "validation_only" : "passed" });
  }
  if (url === "/api/provider-keys" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { providerId: string };
    return jsonResponse({
      providerKey: {
        id: `key-${body.providerId}`,
        providerId: body.providerId,
        providerLabel: body.providerId,
        keyHint: "...7890",
        status: "active",
        lastCheckedAt: null,
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    });
  }
  if (url === "/api/model-providers" && init?.method === "PATCH") {
    const selected = JSON.parse(String(init.body));
    return jsonResponse(modelSettings(selected));
  }
  if (url === "/api/model-providers" && !init?.method) {
    return jsonResponse(modelSettings());
  }
  if (url === "/api/model-providers/connectivity" && init?.method === "POST") {
    return jsonResponse({
      status: "configured",
      gateway: "litellm",
      configured: true,
      issues: [],
      checkedAt: "2026-07-10T00:00:00.000Z",
      checkedBy: "model-info",
    });
  }
  return jsonResponse({}, { status: 404 });
}

function modelSettings(selected = {
  chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
}) {
  return {
    gateway: { status: "configured", gateway: "litellm", configured: true, issues: [] },
    credentialMode,
    selected,
    catalog: modelCatalog,
  };
}

const providerCatalog = [
  provider("google-gemini", "Google Gemini", "live", [field("apiKey", "API key", true, true)]),
  provider("openai", "OpenAI", "live", [field("apiKey", "API key", true, true)]),
  provider("groq", "Groq", "live", [field("apiKey", "API key", true, true)]),
  provider("azure-openai", "Azure OpenAI", "live", [
    field("apiKey", "API key", true, true),
    field("apiBase", "Azure endpoint", true, false),
    field("apiVersion", "API version", true, false),
    field("deploymentName", "Deployment name", true, false),
    {
      ...field("baseModel", "Model family", true, false),
      inputType: "select",
      options: [
        { value: "gpt-4o", label: "GPT-4o family" },
        { value: "gpt-4.1", label: "GPT-4.1 family" },
        { value: "gpt-5", label: "GPT-5 family" },
        { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
        { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
        { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      ],
    },
  ]),
  provider("openai-compatible", "OpenAI-compatible", "validation-only", [
    field("apiKey", "API key", false, true),
    field("apiBase", "API base URL", true, false),
  ]),
];

function provider(id: string, label: string, checkMode: string, credentialFields: unknown[]) {
  return {
    id,
    label,
    logoPath: id === "azure-openai" ? "/llm-providers/Microsoft_Azure.svg" : "/llm-providers/openai.png",
    checkMode,
    credentialFields,
  };
}

function field(id: string, label: string, required: boolean, secret: boolean) {
  return { id, label, required, secret, inputType: secret ? "password" : id === "apiBase" ? "url" : "text" };
}

const modelCatalog = [
  model("gemini", "Google Gemini", "google-gemini", DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS, "Gemini 3.1 Pro Preview", "chatOrchestration"),
  model("gemini", "Google Gemini", "google-gemini", DEFAULT_IMAGE_GENERATION_MODEL_ALIAS, "Nano Banana 2", "imageGeneration"),
  model("openai", "OpenAI", "openai", "kavero-chat-openai-gpt-5-6", "GPT-5.6", "chatOrchestration"),
  model("openai", "OpenAI", "openai", "kavero-image-openai-gpt-image-2", "GPT Image 2", "imageGeneration"),
  model("azure-openai", "Azure OpenAI", "azure-openai", "kavero-chat-azure-openai", "Azure OpenAI deployment", "chatOrchestration"),
];

function model(providerId: string, providerLabel: string, providerKeyId: string, modelAlias: string, displayLabel: string, slot: string) {
  return {
    provider: providerId,
    providerLabel,
    providerLogoPath: providerId === "azure-openai" ? "/llm-providers/Microsoft_Azure.svg" : "/llm-providers/openai.png",
    providerKeyId,
    modelAlias,
    displayLabel,
    capabilities: { slots: [slot], requirements: [] },
  };
}

function requestBodies(url: string) {
  return vi.mocked(global.fetch).mock.calls.flatMap(([input, init]) =>
    String(input) === url && init?.body ? [JSON.parse(String(init.body))] : [],
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}
