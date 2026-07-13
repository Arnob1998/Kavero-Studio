import { describe, expect, it } from "vitest";
import {
  buildAzureOpenAiLiteLlmRequest,
  getAzureOpenAiEnvCredentials,
  getAzureOpenAiRoute,
} from "./azure-routing";

const credentials = {
  apiKey: "azure-key-012345678901234567890",
  apiBase: "https://kavero.openai.azure.com",
  apiVersion: "2025-04-01-preview",
  deploymentName: "deployment-one",
  baseModel: "gpt-4.1" as const,
};

describe("Azure OpenAI signed dynamic routing", () => {
  it("maps only curated route families", () => {
    expect(getAzureOpenAiRoute("gpt-4o", "deploy-o")).toBe("azure/deploy-o");
    expect(getAzureOpenAiRoute("gpt-4.1", "deploy-41")).toBe("azure/deploy-41");
    expect(getAzureOpenAiRoute("gpt-5", "deploy-5")).toBe("azure/gpt5_series/deploy-5");
  });

  it("strips caller routing fields and constructs trusted user_config", () => {
    const result = buildAzureOpenAiLiteLlmRequest(
      {
        model: "browser-model",
        messages: [],
        api_key: "browser-key",
        api_base: "https://browser.invalid",
        api_version: "browser-version",
        user_config: { model_list: [] },
      },
      credentials,
    );

    expect(result).toEqual({
      monitoringModel: "gpt-4.1",
      body: {
        model: "kavero-chat-azure-openai",
        messages: [],
        user_config: {
          model_list: [
            {
              model_name: "kavero-chat-azure-openai",
              litellm_params: {
                model: "azure/deployment-one",
                api_key: credentials.apiKey,
                api_base: credentials.apiBase,
                api_version: credentials.apiVersion,
              },
            },
          ],
        },
      },
    });
  });

  it("accepts only complete valid environment configuration", () => {
    expect(getAzureOpenAiEnvCredentials({
      AZURE_API_KEY: credentials.apiKey,
      AZURE_API_BASE: credentials.apiBase,
      AZURE_API_VERSION: credentials.apiVersion,
      AZURE_DEPLOYMENT_NAME: credentials.deploymentName,
      AZURE_BASE_MODEL: credentials.baseModel,
    })).toEqual(credentials);
    expect(getAzureOpenAiEnvCredentials({ AZURE_API_KEY: credentials.apiKey })).toBeNull();
    expect(buildAzureOpenAiLiteLlmRequest({}, { ...credentials, deploymentName: "bad/name" })).toBeNull();
    expect(buildAzureOpenAiLiteLlmRequest({}, { ...credentials, baseModel: "azure/arbitrary" })).toBeNull();
  });
});
