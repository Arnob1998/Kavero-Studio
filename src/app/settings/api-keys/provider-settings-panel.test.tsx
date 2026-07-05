import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";
import { ProviderSettingsPanel } from "./provider-settings-panel";

describe("ProviderSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(fetchMock));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders separate orchestration and image selectors from safe catalog data", async () => {
    render(<ProviderSettingsPanel />);

    expect(await screen.findByText("Orchestration/chat model")).toBeInTheDocument();
    expect(screen.getByText("Image-generation model")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain(
      "OpenAI - OpenAI GPT-4o Mini",
    );
    expect(screen.getByText("Nano Banana 2")).toBeInTheDocument();
    expect(screen.queryByText("http://litellm:4000")).not.toBeInTheDocument();
    expect(screen.queryByText("sk-secret")).not.toBeInTheDocument();
  });

  it("checks Gemini keys through the Kavero server route", async () => {
    const user = userEvent.setup();
    render(<ProviderSettingsPanel />);

    const input = await screen.findByPlaceholderText(/Paste Gemini API key/i);
    await user.type(input, "AIzaSy0123456789012345678901234");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/provider-keys/check",
        expect.objectContaining({ method: "POST" }),
      );
    }, { timeout: 2000 });

    const calledUrls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes("generativelanguage.googleapis.com"))).toBe(false);
  });
});

async function fetchMock(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);

  if (url === "/api/provider-keys") {
    return jsonResponse({
      providerKeys: [],
    });
  }

  if (url === "/api/model-providers") {
    return jsonResponse({
      gateway: {
        status: "configured",
        gateway: "litellm",
        configured: true,
        issues: [],
      },
      selected: {
        chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
      catalog: [
        {
          provider: "gemini",
          providerLabel: "Google Gemini",
          providerLogoPath: "/llm-providers/google-gemini-icon.png",
          modelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
          displayLabel: "Gemini 3.1 Pro Preview",
          capabilities: { slots: ["chatOrchestration"], requirements: [] },
        },
        {
          provider: "gemini",
          providerLabel: "Google Gemini",
          providerLogoPath: "/llm-providers/google-gemini-icon.png",
          modelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
          displayLabel: "Nano Banana 2",
          capabilities: { slots: ["imageGeneration"], requirements: [] },
        },
        {
          provider: "openai",
          providerLabel: "OpenAI",
          providerLogoPath: "/llm-providers/openai.png",
          modelAlias: "kavero-chat-openai-example",
          displayLabel: "OpenAI GPT-4o Mini",
          capabilities: { slots: ["chatOrchestration"], requirements: [] },
        },
      ],
    });
  }

  if (url === "/api/provider-keys/check" && init?.method === "POST") {
    return jsonResponse({ status: "passed", checkedAt: "2026-07-05T00:00:00.000Z" });
  }

  return jsonResponse({}, { status: 404 });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}
