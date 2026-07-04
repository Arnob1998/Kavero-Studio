import { describe, expect, it, vi } from "vitest";
import { createGeminiCanvasAssistantProvider } from "./gemini-assistant-provider";
import type { CanvasAssistantProviderInput } from "./assistant-orchestrator";

const generateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  FunctionCallingConfigMode: { AUTO: "AUTO" },
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
  ThinkingLevel: { HIGH: "HIGH" },
}));

const providerInput: CanvasAssistantProviderInput = {
  messages: [{ role: "user", content: "Move the title down a little." }],
  phase: "propose",
  context: {
    designId: "design-1",
    pageId: "page-1",
    sceneSnapshot: { objects: [{ id: "title-1", type: "textbox" }] },
    relationMap: { nodes: [], edges: [] },
    selectedObjectIds: ["title-1"],
    visualPreview: {
      status: "available",
      pageId: "page-1",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
      width: 900,
      height: 600,
      bytes: 3,
    },
    inspectedAssets: [{ assetId: "asset-1", status: "available", mimeType: "image/png", bytes: 100, publicUrl: "/api/canvas/assets/asset-1" }],
    imageGeneration: null,
  },
  tools: [
    {
      name: "transform_object",
      description: "Move or resize an object.",
      riskLevel: "medium",
      inputSchema: {
        type: "object",
        properties: { objectId: { type: "string" }, top: { type: "number" } },
        required: ["objectId"],
      },
    },
  ],
};

describe("Gemini canvas assistant provider", () => {
  it("sends safe canvas context, visual preview, and tool schemas to Gemini", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: "Moved the title." }] } }],
      functionCalls: [{ id: "call-1", name: "transform_object", args: { objectId: "title-1", top: 120 } }],
    });

    const provider = createGeminiCanvasAssistantProvider({ apiKey: "test-key", model: "test-model" });
    const result = await provider.generate(providerInput);

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        config: expect.objectContaining({
          systemInstruction: expect.stringContaining("Kavero"),
          tools: [
            {
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({
                  name: "transform_object",
                  parametersJsonSchema: providerInput.tools[0].inputSchema,
                }),
              ]),
            },
          ],
        }),
      }),
    );
    const request = generateContent.mock.calls[0][0];
    expect(request.contents[0].parts[0].text).toContain('"sceneSnapshot"');
    expect(request.contents[0].parts[0].text).not.toContain("data:image");
    expect(request.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
    expect(result).toEqual({
      message: { role: "assistant", content: "Moved the title." },
      toolCalls: [{ id: "call-1", name: "transform_object", input: { objectId: "title-1", top: 120 } }],
    });
  });

  it("does not invent generic assistant text when Gemini only returns tool calls", async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [] } }],
      functionCalls: [{ id: "call-1", name: "transform_object", args: { objectId: "title-1", top: 120 } }],
    });

    const provider = createGeminiCanvasAssistantProvider({ apiKey: "test-key", model: "test-model" });
    const result = await provider.generate(providerInput);

    expect(result.message.content).toBe("");
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "transform_object", input: { objectId: "title-1", top: 120 } },
    ]);
  });
});
