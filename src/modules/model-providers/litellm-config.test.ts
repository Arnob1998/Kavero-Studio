import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("LiteLLM guarded dynamic routing config", () => {
  const config = readFileSync(join(process.cwd(), "docker/litellm/config.yaml"), "utf8");
  const compose = readFileSync(join(process.cwd(), "compose.yml"), "utf8");
  const launcher = readFileSync(join(process.cwd(), "docker/litellm/start.py"), "utf8");

  it("enables client credentials only with custom auth and fail-closed startup", () => {
    expect(config).toContain("custom_auth: kavero_auth.user_api_key_auth");
    expect(config).toContain("allow_client_side_credentials: true");
    expect(compose).toContain("/app/kavero_auth.py:ro");
    expect(compose).toContain("/app/start.py:ro");
    expect(compose).toContain('entrypoint: ["python", "/app/start.py"]');
    expect(launcher).toContain("kavero_auth.validate_configuration()");
  });

  it("pins the verified LiteLLM image digest", () => {
    expect(compose).toContain(
      "docker.litellm.ai/berriai/litellm@sha256:e4b91a2de9367ab0987baaa767b2283390badd5a361357993de1a05f027edc22",
    );
    expect(compose).not.toMatch(/berriai\/litellm:latest/);
  });

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
