import path from "node:path";
import {
  getEnabledAuthModes,
  getEnabledStorageChoices,
  getSetupProfile,
  getSetupStorageChoice,
  setupProfiles,
} from "./config.mjs";
import { createDockerSecrets } from "./jwt.mjs";
import { writeEnvFileSafely } from "./env-file.mjs";
import { runLocalDockerStack } from "./run.mjs";

const localLiteLlmBaseUrl = "http://litellm:4000";

export const setupGatewayProviders = [
  { value: "gemini", label: "Google Gemini", hint: "Chat orchestration and image generation" },
  { value: "openai", label: "OpenAI", hint: "Chat orchestration and GPT Image 2" },
  { value: "groq", label: "Groq", hint: "Chat orchestration" },
  { value: "azure-openai", label: "Azure OpenAI", hint: "Chat orchestration" },
  { value: "azure-openai-image", label: "Azure OpenAI (image)", hint: "Independent GPT Image 2 deployment" },
];

function gatewayProviderEnv(inputs = {}) {
  return {
    OPENAI_API_KEY: inputs.OPENAI_API_KEY ?? "",
    GEMINI_API_KEY: inputs.GEMINI_API_KEY ?? "",
    GROQ_API_KEY: inputs.GROQ_API_KEY ?? "",
    AZURE_API_KEY: inputs.AZURE_API_KEY ?? "",
    AZURE_API_BASE: inputs.AZURE_API_BASE ?? "",
    AZURE_API_VERSION: inputs.AZURE_API_VERSION ?? "",
    AZURE_DEPLOYMENT_NAME: inputs.AZURE_DEPLOYMENT_NAME ?? "",
    AZURE_BASE_MODEL: inputs.AZURE_BASE_MODEL ?? "",
    AZURE_IMAGE_API_KEY: inputs.AZURE_IMAGE_API_KEY ?? "",
    AZURE_IMAGE_API_BASE: inputs.AZURE_IMAGE_API_BASE ?? "",
    AZURE_IMAGE_API_VERSION: inputs.AZURE_IMAGE_API_VERSION ?? "",
    AZURE_IMAGE_DEPLOYMENT_NAME: inputs.AZURE_IMAGE_DEPLOYMENT_NAME ?? "",
    AZURE_IMAGE_BASE_MODEL: inputs.AZURE_IMAGE_BASE_MODEL ?? "",
    OLLAMA_BASE_URL: inputs.OLLAMA_BASE_URL ?? "",
  };
}

export function buildSetupValues({
  profileId,
  authMode,
  storageChoiceId,
  inputs = {},
  dockerSecrets,
}) {
  const profile = getSetupProfile(profileId);
  if (!profile) throw new Error(`Unknown setup profile: ${profileId}`);

  const storageChoice = getSetupStorageChoice(storageChoiceId);
  if (!storageChoice || !storageChoice.enabled || !storageChoice.profileIds.includes(profileId)) {
    throw new Error(`Storage choice is not enabled for ${profileId}: ${storageChoiceId}`);
  }

  if (profileId === "local-docker") {
    if (authMode !== "password") {
      throw new Error("Local Docker setup supports password auth only.");
    }

    const secrets = dockerSecrets ?? createDockerSecrets();
    return {
      KAVERO_APP_PORT: inputs.KAVERO_APP_PORT ?? "3000",
      SUPABASE_KONG_PORT: inputs.SUPABASE_KONG_PORT ?? "54321",
      POSTGRES_DB: "postgres",
      POSTGRES_USER: "postgres",
      ...secrets,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${inputs.SUPABASE_KONG_PORT ?? "54321"}`,
      SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${inputs.KAVERO_APP_PORT ?? "3000"}`,
      KAVERO_API_ORIGIN: `http://127.0.0.1:${inputs.KAVERO_APP_PORT ?? "3000"}`,
      KAVERO_DEPLOYMENT_PROFILE: "local-first",
      KAVERO_AUTH_MODE: authMode,
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
      KAVERO_LOCAL_STORAGE_ROOT: "/data/kavero-storage",
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: localLiteLlmBaseUrl,
      KAVERO_LITELLM_API_KEY: secrets.KAVERO_LITELLM_API_KEY,
      KAVERO_LITELLM_ROUTING_SECRET: secrets.KAVERO_LITELLM_ROUTING_SECRET,
      LITELLM_MASTER_KEY: secrets.LITELLM_MASTER_KEY,
      ...gatewayProviderEnv(inputs),
    };
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: inputs.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: inputs.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: inputs.SUPABASE_SERVICE_ROLE_KEY ?? "",
    NEXT_PUBLIC_SITE_URL: inputs.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
    KAVERO_API_ORIGIN: inputs.KAVERO_API_ORIGIN ?? inputs.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
    KAVERO_DEPLOYMENT_PROFILE: "cloud",
    KAVERO_AUTH_MODE: authMode,
    ...storageChoice.env,
    ...(storageChoiceId === "kavero-managed-local-filesystem"
      ? { KAVERO_LOCAL_STORAGE_ROOT: inputs.KAVERO_LOCAL_STORAGE_ROOT ?? "" }
      : {}),
    KAVERO_MODEL_GATEWAY: inputs.KAVERO_MODEL_GATEWAY ?? "",
    KAVERO_LITELLM_BASE_URL: inputs.KAVERO_LITELLM_BASE_URL ?? "",
    KAVERO_LITELLM_API_KEY: inputs.KAVERO_LITELLM_API_KEY ?? "",
    KAVERO_LITELLM_ROUTING_SECRET: inputs.KAVERO_LITELLM_ROUTING_SECRET ?? "",
    LITELLM_MASTER_KEY: inputs.LITELLM_MASTER_KEY ?? "",
    ...gatewayProviderEnv(inputs),
    GOOGLE_DRIVE_CLIENT_ID: inputs.GOOGLE_DRIVE_CLIENT_ID ?? "",
    GOOGLE_DRIVE_CLIENT_SECRET: inputs.GOOGLE_DRIVE_CLIENT_SECRET ?? "",
  };
}

function assertNotCanceled(value, prompts) {
  if (prompts.isCancel(value)) {
    prompts.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value;
}

export async function promptForGatewayProviders({ prompts, inputs, target = "gateway" }) {
  const selectedProviders = assertNotCanceled(
    await prompts.multiselect({
      message: "Choose model providers to configure",
      options: setupGatewayProviders,
      required: false,
    }),
    prompts,
  );

  if (selectedProviders.includes("gemini")) {
    inputs.GEMINI_API_KEY = assertNotCanceled(
      await prompts.password({ message: `Gemini API key for the ${target}` }),
      prompts,
    );
  }
  if (selectedProviders.includes("openai")) {
    inputs.OPENAI_API_KEY = assertNotCanceled(
      await prompts.password({ message: `OpenAI API key for the ${target}` }),
      prompts,
    );
  }
  if (selectedProviders.includes("groq")) {
    inputs.GROQ_API_KEY = assertNotCanceled(
      await prompts.password({ message: `Groq API key for the ${target}` }),
      prompts,
    );
  }
  if (selectedProviders.includes("azure-openai")) {
    inputs.AZURE_API_KEY = assertNotCanceled(
      await prompts.password({ message: "Azure OpenAI API key" }),
      prompts,
    );
    inputs.AZURE_API_BASE = assertNotCanceled(
      await prompts.text({ message: "Azure OpenAI endpoint", placeholder: "https://resource.openai.azure.com" }),
      prompts,
    );
    inputs.AZURE_API_VERSION = assertNotCanceled(
      await prompts.text({ message: "Azure OpenAI API version", placeholder: "Optional" }),
      prompts,
    );
    inputs.AZURE_DEPLOYMENT_NAME = assertNotCanceled(
      await prompts.text({ message: "Azure OpenAI deployment name" }),
      prompts,
    );
    inputs.AZURE_BASE_MODEL = assertNotCanceled(
      await prompts.select({
        message: "Azure OpenAI model family",
        options: [
          { value: "gpt-4o", label: "GPT-4o family" },
          { value: "gpt-4.1", label: "GPT-4.1 family" },
          { value: "gpt-5", label: "GPT-5 family" },
          { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
          { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
          { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        ],
      }),
      prompts,
    );
  }
  if (selectedProviders.includes("azure-openai-image")) {
    inputs.AZURE_IMAGE_API_KEY = assertNotCanceled(
      await prompts.password({ message: "Azure image-slot API key" }),
      prompts,
    );
    inputs.AZURE_IMAGE_API_BASE = assertNotCanceled(
      await prompts.text({ message: "Azure image-slot endpoint", placeholder: "https://resource.openai.azure.com" }),
      prompts,
    );
    inputs.AZURE_IMAGE_API_VERSION = assertNotCanceled(
      await prompts.text({
        message: "Azure image-slot API version",
        initialValue: "2024-02-01",
        placeholder: "2024-02-01",
      }),
      prompts,
    );
    inputs.AZURE_IMAGE_DEPLOYMENT_NAME = assertNotCanceled(
      await prompts.text({ message: "Azure image-slot deployment name" }),
      prompts,
    );
    inputs.AZURE_IMAGE_BASE_MODEL = "gpt-image-2";
  }

  return selectedProviders;
}

export async function runSetupWizard({
  prompts,
  cwd = process.cwd(),
  now = new Date(),
  runLocalDocker = runLocalDockerStack,
}) {
  prompts.intro("Kavero setup");

  const profileId = assertNotCanceled(
    await prompts.select({
      message: "Choose where Kavero runs",
      options: setupProfiles.map((profile) => ({
        value: profile.id,
        label: profile.label,
        hint: profile.hint,
      })),
    }),
    prompts,
  );

  const profile = getSetupProfile(profileId);
  const authMode =
    profileId === "local-docker"
      ? "password"
      : assertNotCanceled(
          await prompts.select({
            message: "Choose sign-in",
            initialValue: profile.defaultAuthMode,
            options: getEnabledAuthModes(profileId).map((mode) => ({
              value: mode.id,
              label: mode.label,
              hint: mode.hint,
            })),
          }),
          prompts,
        );

  if (profileId === "local-docker") {
    prompts.note("Local Docker uses email/password sign-in for now.", "Sign-in");
  }

  const storageChoices = getEnabledStorageChoices(profileId);
  const storageChoiceId = assertNotCanceled(
    await prompts.select({
      message: "Choose storage",
      initialValue: profile.defaultStorageChoice,
      options: storageChoices.map((choice) => ({
        value: choice.id,
        label: choice.label,
        hint: choice.hint,
      })),
    }),
    prompts,
  );

  const inputs = {};
  if (profileId === "local-docker") {
    inputs.KAVERO_APP_PORT = assertNotCanceled(
      await prompts.text({
        message: "App port",
        initialValue: "3000",
        placeholder: "3000",
      }),
      prompts,
    );
    inputs.SUPABASE_KONG_PORT = assertNotCanceled(
      await prompts.text({
        message: "Supabase port",
        initialValue: "54321",
        placeholder: "54321",
      }),
      prompts,
    );
    prompts.note(
      "Select only the providers you want on the bundled gateway. The in-app API key screen remains unchanged.",
      "Model gateway",
    );
    await promptForGatewayProviders({ prompts, inputs });
  } else {
    inputs.NEXT_PUBLIC_SUPABASE_URL = assertNotCanceled(
      await prompts.text({ message: "Supabase public URL", placeholder: "https://project.supabase.co" }),
      prompts,
    );
    inputs.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = assertNotCanceled(
      await prompts.password({ message: "Supabase publishable key" }),
      prompts,
    );
    inputs.SUPABASE_SERVICE_ROLE_KEY = assertNotCanceled(
      await prompts.password({ message: "Supabase service-role key" }),
      prompts,
    );
    inputs.NEXT_PUBLIC_SITE_URL = assertNotCanceled(
      await prompts.text({
        message: "Kavero site URL",
        initialValue: "http://127.0.0.1:3000",
        placeholder: "https://app.example.com",
      }),
      prompts,
    );

    if (authMode === "google" || authMode === "google-password" || storageChoiceId === "google-drive") {
      inputs.GOOGLE_DRIVE_CLIENT_ID = assertNotCanceled(
        await prompts.text({
          message: "Google Drive client ID",
          placeholder: "Optional for now",
          defaultValue: "",
        }),
        prompts,
      );
      inputs.GOOGLE_DRIVE_CLIENT_SECRET = assertNotCanceled(
        await prompts.password({
          message: "Google Drive client secret",
          placeholder: "Optional for now",
        }),
        prompts,
      );
    }

    if (storageChoiceId === "kavero-managed-local-filesystem") {
      inputs.KAVERO_LOCAL_STORAGE_ROOT = assertNotCanceled(
        await prompts.text({
          message: "Local storage root",
          placeholder: process.platform === "win32" ? "C:\\kavero-storage" : "/var/lib/kavero/storage",
        }),
        prompts,
      );
    }

    const configureLiteLlm = assertNotCanceled(
      await prompts.confirm({
        message: "Configure a server-side LiteLLM gateway?",
        initialValue: false,
      }),
      prompts,
    );

    if (configureLiteLlm) {
      inputs.KAVERO_MODEL_GATEWAY = "litellm";
      inputs.KAVERO_LITELLM_BASE_URL = assertNotCanceled(
        await prompts.text({
          message: "LiteLLM base URL",
          placeholder: "https://litellm.example.com",
        }),
        prompts,
      );
      inputs.KAVERO_LITELLM_API_KEY = assertNotCanceled(
        await prompts.password({ message: "Kavero-to-LiteLLM API key" }),
        prompts,
      );
      inputs.KAVERO_LITELLM_ROUTING_SECRET = assertNotCanceled(
        await prompts.password({ message: "Matching LiteLLM routing secret" }),
        prompts,
      );
      await promptForGatewayProviders({ prompts, inputs, target: "server" });
    }
  }

  const overwriteNonSensitive = assertNotCanceled(
    await prompts.confirm({
      message: "Update existing non-secret values if they differ?",
      initialValue: false,
    }),
    prompts,
  );

  const values = buildSetupValues({
    profileId,
    authMode,
    storageChoiceId,
    inputs,
  });

  const envPath = path.join(cwd, profile.envFile);
  const spinner = prompts.spinner();
  spinner.start("Save local secrets");

  const result = await writeEnvFileSafely({
    filePath: envPath,
    values,
    overwriteNonSensitive,
    now,
    confirmOverwrite: async (key) => {
      spinner.stop("Existing secret found.");
      const confirmed = assertNotCanceled(
        await prompts.confirm({
          message: `Overwrite existing ${key}?`,
          initialValue: false,
        }),
        prompts,
      );
      spinner.start("Save local secrets");
      return confirmed;
    },
  });

  spinner.stop(result.wrote ? `Wrote ${profile.envFile}` : `${profile.envFile} already up to date`);

  if (profileId === "local-docker") {
    prompts.note(
      [
        "pnpm setup:run",
        "",
        "Manual Docker command:",
        "docker compose --env-file .env.docker.local up --build",
      ].join("\n"),
      "Run Docker",
    );

    const runNow = assertNotCanceled(
      await prompts.confirm({
        message: "Run Kavero now?",
        initialValue: false,
      }),
      prompts,
    );

    if (runNow) {
      prompts.outro(`Starting Kavero. Open http://127.0.0.1:${inputs.KAVERO_APP_PORT} when it is ready.`);
      const runResult = runLocalDocker({ cwd });
      if (runResult.status !== 0) {
        process.exitCode = runResult.status ?? 1;
      }
      return result;
    }
  } else {
    prompts.note("Run pnpm setup:doctor, then pnpm build.", "Next");
  }

  prompts.outro("Kavero setup complete.");
  return result;
}
