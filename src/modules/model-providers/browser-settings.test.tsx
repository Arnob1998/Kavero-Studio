import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModelProviderSettings } from "./browser-settings";

describe("useModelProviderSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes only active models for a slot and saves only the changed slot", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(settingsPayload({
          chatOrchestrationModelAlias: "chat-active",
          imageGenerationModelAlias: "image-active",
        }));
      }
      return jsonResponse(settingsPayload());
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useModelProviderSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeModels("chatOrchestration").map((model) => model.modelAlias)).toEqual(["chat-active"]);
    expect(result.current.activeModels("imageGeneration").map((model) => model.modelAlias)).toEqual(["image-active"]);

    await act(async () => {
      await result.current.saveSelection({ imageGenerationModelAlias: "image-active" });
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ imageGenerationModelAlias: "image-active" });
  });
});

function settingsPayload(selected = {
  chatOrchestrationModelAlias: "chat-active",
  imageGenerationModelAlias: "image-active",
}) {
  return {
    gateway: { status: "configured", gateway: "litellm", configured: true, issues: [] },
    credentialMode: "env-or-user",
    selected,
    catalog: [
      model("chat-active", "chatOrchestration", true),
      model("chat-locked", "chatOrchestration", false),
      model("image-active", "imageGeneration", true),
      model("image-locked", "imageGeneration", false),
    ],
  };
}

function model(modelAlias: string, slot: "chatOrchestration" | "imageGeneration", active: boolean) {
  return {
    provider: "gemini",
    providerLabel: "Google Gemini",
    providerLogoPath: "/llm-providers/google-gemini-icon.png",
    providerKeyId: "google-gemini",
    modelAlias,
    displayLabel: modelAlias,
    availability: {
      active,
      source: active ? "saved-key" : null,
      reason: active ? null : "credentials-required",
      message: active ? null : "Add a key.",
    },
    capabilities: {
      slots: [slot],
      requirements: ["provider-key"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: false,
      supportsImageOutput: slot === "imageGeneration",
      supportsStreaming: false,
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
