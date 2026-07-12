import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("LiteLLM BYOK allowlist config", () => {
  const config = readFileSync(join(process.cwd(), "docker/litellm/config.yaml"), "utf8");

  it.each([
    ["kavero-chat-orchestration-default", "GEMINI_API_KEY"],
    ["kavero-image-generation-default", "GEMINI_API_KEY"],
    ["kavero-chat-openai-example", "OPENAI_API_KEY"],
    ["kavero-chat-groq-example", "GROQ_API_KEY"],
  ])("keeps env credentials and allows only api_key for %s", (alias, envKey) => {
    const block = modelBlock(alias);
    expect(block).toContain(`api_key: os.environ/${envKey}`);
    expect(block).toContain('configurable_clientside_auth_params: ["api_key"]');
    expect(block).not.toContain("api_base");
    expect(block).not.toContain("base_url");
    expect(block).not.toContain("api_version");
  });

  it("does not enable clientside credentials for Ollama", () => {
    expect(modelBlock("kavero-chat-ollama-example")).not.toContain(
      "configurable_clientside_auth_params",
    );
  });

  function modelBlock(alias: string) {
    const start = config.indexOf(`- model_name: ${alias}`);
    const next = config.indexOf("\n  - model_name:", start + 1);
    return config.slice(start, next === -1 ? config.indexOf("\ngeneral_settings:", start) : next);
  }
});
