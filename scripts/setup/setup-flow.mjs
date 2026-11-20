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

export const setupImageGenerationChoices = [
  { value: "local", label: "Local models", hint: "Start with a supported image model on your PC; no API key." },
  { value: "providers", label: "API provider", hint: "Start with a provider image model; you can add Local later." },
  { value: "later", label: "Set up models later", hint: "Launch Kavero and choose models in Model Hub." },
];

export const setupLocalModels = [
  { value: "qwen-image-2.1-q4-evaluation", label: "Qwen Image 2.1 · Q4", hint: "Recommended starting profile; hardware and terms checked after launch." },
  { value: "qwen-image-2.1-q3-evaluation", label: "Qwen Image 2.1 · Q3", hint: "Smaller quantization; hardware and terms checked after launch." },
];
export const setupApiModels = [
  { provider: "gemini", value: "kavero-image-generation-default", label: "Nano Banana 2" },
  { provider: "gemini", value: "kavero-image-gemini-3-pro", label: "Nano Banana Pro" },
  { provider: "gemini", value: "kavero-image-gemini-2-5-flash", label: "Nano Banana" },
  { provider: "openai", value: "kavero-image-openai-gpt-image-2", label: "GPT Image 2" },
  { provider: "azure-openai-image", value: "kavero-image-azure-gpt-image-2", label: "Azure GPT Image 2" },
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

    if (inputs.imageGeneration !== undefined && !setupImageGenerationChoices.some(choice => choice.value === inputs.imageGeneration)) {
      throw new Error("Unknown image generation choice.");
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
      ...(inputs.imageGeneration === "local" ? { KAVERO_LOCAL_GENERATION_ENABLED: "1" } : {}),
      // A starter choice never disables another source or clears its credentials.
      ...(inputs.imageGeneration === undefined ? gatewayProviderEnv(inputs) : Object.fromEntries(Object.entries(gatewayProviderEnv(inputs)).filter(([key]) => Object.hasOwn(inputs, key)))),
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

export async function promptForGatewayProviders({ prompts, inputs, target = "gateway", selectedProviders: configuredProviders }) {
  const selectedProviders = configuredProviders ?? assertNotCanceled(
    await prompts.multiselect({
      message: "Optional API providers — leave empty to skip",
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

export async function promptForImageGeneration({ prompts, inputs, platform = process.platform, arch = process.arch }) {
  const localSupported = platform === "win32" && arch === "x64";
  inputs.imageGeneration = assertNotCanceled(await prompts.select({
    message: "Choose your first image-model source",
    initialValue: localSupported ? "local" : "providers",
    options: setupImageGenerationChoices.map(choice => choice.value === "local" && !localSupported ? { ...choice, disabled: true, hint: "Currently requires Windows x64." } : choice),
  }), prompts);
  if (!setupImageGenerationChoices.some(choice => choice.value === inputs.imageGeneration)) throw new Error("Unknown image generation choice.");
  if (inputs.imageGeneration === "local") {
    if (!localSupported) throw new Error("Local models currently require Windows x64.");
    inputs.starterLocalProfile = assertNotCanceled(await prompts.select({ message: "Choose your starting local image model", initialValue: setupLocalModels[0].value, options: setupLocalModels }), prompts);
    if (!setupLocalModels.some(model => model.value === inputs.starterLocalProfile)) throw new Error("Unknown starting local model.");
    prompts.note("The current runnable local catalog contains Qwen Q4/Q3. After launch, sign in and follow the Model Hub link to review your starting model, check hardware and accept component terms. No model download or terms acceptance happens in this wizard. Other imports are not automatically runnable.", "Starting local model");
  } else if (inputs.imageGeneration === "providers") {
    const options = setupGatewayProviders.filter(provider => setupApiModels.some(model => model.provider === provider.value));
    inputs.starterProvider = assertNotCanceled(await prompts.select({ message: "Choose your starting image provider", options }), prompts);
    if (!options.some(provider => provider.value === inputs.starterProvider)) throw new Error("Unknown starting image provider.");
    await promptForGatewayProviders({ prompts, inputs, selectedProviders: [inputs.starterProvider] });
    const models = setupApiModels.filter(model => model.provider === inputs.starterProvider);
    inputs.starterModelAlias = assertNotCanceled(await prompts.select({ message: "Choose your starting provider image model", initialValue: models[0].value, options: models }), prompts);
    if (!models.some(model => model.value === inputs.starterModelAlias)) throw new Error("Unknown starting provider model.");
  }
  prompts.note("This is a starting choice, not an exclusive mode. In Model Hub you can add more Local or API models, change the active model, and remove configurations where supported. Deleting downloaded files is separate. Chat models for features such as Copilot are configured independently.", "Manage models later");
  return inputs.imageGeneration;
}

export function starterModelHubUrl(inputs) {
  const url = new URL(`http://127.0.0.1:${inputs.KAVERO_APP_PORT}/settings/models`);
  if (inputs.imageGeneration === "local") { url.searchParams.set("source", "local"); url.searchParams.set("starterProfile", inputs.starterLocalProfile); }
  if (inputs.imageGeneration === "providers") { url.searchParams.set("source", "cloud"); url.searchParams.set("starterModel", inputs.starterModelAlias); }
  return url.href;
}

export async function runSetupWizard({
  prompts,
  cwd = process.cwd(),
  now = new Date(),
  runLocalDocker = runLocalDockerStack,
  platform = process.platform,
  arch = process.arch,
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
    await promptForImageGeneration({ prompts, inputs, platform, arch });
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

  if (result.preserved.includes("KAVERO_LOCAL_GENERATION_ENABLED")) {
    prompts.note("Your existing local-generation setting was kept. To apply the image-generation choice you just selected, rerun setup and allow updates to existing non-secret values.", "Existing setting preserved");
  }

  if (profileId === "local-docker") {
    prompts.note(`After Kavero starts, sign in and open:\n${starterModelHubUrl(inputs)}\n\nReview and activate your starting model there. You can add more models later.`, "Your starting model");
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
      const runResult = await runLocalDocker({ cwd });
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
