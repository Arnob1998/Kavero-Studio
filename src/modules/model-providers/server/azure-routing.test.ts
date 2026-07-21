import { describe, expect, it } from "vitest";
import {
  buildAzureOpenAiImageGenerationUrl,
  buildAzureOpenAiImageLiteLlmRequest,
  buildAzureOpenAiLiteLlmRequest,
  getAzureOpenAiEnvCredentials,
  getAzureOpenAiImageEnvCredentials,
  getAzureOpenAiRoute,
} from "./azure-routing";

const credentials = {
  apiKey: "azure-key-012345678901234567890",
  apiBase: "https://kavero.openai.azure.com",
  apiVersion: "2025-04-01-preview",
  deploymentName: "deployment-one",
  baseModel: "gpt-4.1" as const,
};
const imageCredentials = {
  apiKey: "azure-image-key-012345678901234567890",
  apiBase: "https://images.openai.azure.com",
  apiVersion: "2024-02-01" as const,
  deploymentName: "image-deployment",
  baseModel: "gpt-image-2" as const,
};

describe("Azure OpenAI signed dynamic routing", () => {
  it("maps only curated route families", () => {
    expect(getAzureOpenAiRoute("gpt-4o", "deploy-o")).toBe("azure/deploy-o");
    expect(getAzureOpenAiRoute("gpt-4.1", "deploy-41")).toBe("azure/deploy-41");
    expect(getAzureOpenAiRoute("gpt-5", "deploy-5")).toBe("azure/gpt5_series/deploy-5");
    expect(getAzureOpenAiRoute("gpt-5.6-sol", "custom-sol")).toBe("azure/gpt5_series/custom-sol");
    expect(getAzureOpenAiRoute("gpt-5.6-terra", "custom-terra")).toBe("azure/gpt5_series/custom-terra");
    expect(getAzureOpenAiRoute("gpt-5.6-luna", "custom-luna")).toBe("azure/gpt5_series/custom-luna");
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

  it("resolves the Azure image environment record independently", () => {
    const env = {
      AZURE_API_KEY: credentials.apiKey,
      AZURE_API_BASE: credentials.apiBase,
      AZURE_API_VERSION: credentials.apiVersion,
      AZURE_DEPLOYMENT_NAME: credentials.deploymentName,
      AZURE_BASE_MODEL: credentials.baseModel,
      AZURE_IMAGE_API_KEY: imageCredentials.apiKey,
      AZURE_IMAGE_API_BASE: imageCredentials.apiBase,
      AZURE_IMAGE_API_VERSION: imageCredentials.apiVersion,
      AZURE_IMAGE_DEPLOYMENT_NAME: imageCredentials.deploymentName,
      AZURE_IMAGE_BASE_MODEL: imageCredentials.baseModel,
    };
    expect(getAzureOpenAiEnvCredentials(env)).toEqual(credentials);
    expect(getAzureOpenAiImageEnvCredentials(env)).toEqual(imageCredentials);
    expect(getAzureOpenAiImageEnvCredentials({
      AZURE_API_KEY: imageCredentials.apiKey,
      AZURE_API_BASE: imageCredentials.apiBase,
      AZURE_IMAGE_API_VERSION: imageCredentials.apiVersion,
      AZURE_IMAGE_DEPLOYMENT_NAME: imageCredentials.deploymentName,
      AZURE_IMAGE_BASE_MODEL: imageCredentials.baseModel,
    })).toBeNull();
  });

  it("constructs only the validated Azure image route and trusted dynamic mapping", () => {
    expect(buildAzureOpenAiImageGenerationUrl(imageCredentials)?.toString()).toBe(
      "https://images.openai.azure.com/openai/deployments/image-deployment/images/generations?api-version=2024-02-01",
    );
    const result = buildAzureOpenAiImageLiteLlmRequest({
      model: "caller-model",
      prompt: "safe prompt",
      api_key: "caller-key",
      api_version: "caller-version",
      user_config: { caller: true },
    }, imageCredentials);
    expect(result).toMatchObject({
      monitoringModel: "gpt-image-2",
      body: {
        model: "kavero-image-azure-gpt-image-2",
        prompt: "safe prompt",
        user_config: {
          model_list: [{
            model_name: "kavero-image-azure-gpt-image-2",
            litellm_params: {
              model: "azure/image-deployment",
              api_key: imageCredentials.apiKey,
              api_base: imageCredentials.apiBase,
              api_version: "2024-02-01",
            },
          }],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("caller-key");
    expect(JSON.stringify(result)).not.toContain("caller-version");
    expect(buildAzureOpenAiImageLiteLlmRequest({}, { ...imageCredentials, apiVersion: "2025-04-01-preview" })).toBeNull();
  });
});
