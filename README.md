<div align="center">

# Kavero Studio

### The open-source Canva alternative for AI design

**Bring your own models · own your files · canvas AI · self-hostable · local-first**

The open design workspace for the AI era.

**Canva made design easy. Kavero makes it yours.**

</div>

Kavero is an open-source design workspace where creators can generate visual assets, place them into a real editable canvas, collaborate with an AI canvas copilot, and keep control of their models, credentials, files, and deployment.

## Highlights

- Creates editable designs with text, shapes, images, layers, pages, and uploaded assets.
- Generates images, refines prompts, and saves results in Gallery.
- Uses Canvas Copilot for controlled, structured canvas actions.
- Supports independent orchestration and image-generation models.
- Supports bring-your-own-key providers and local managed storage.

## Run Locally — Recommended for Judges

> [!IMPORTANT]
> **Docker is required.** The hosted/cloud environment is not the recommended judging path. Please run Kavero locally with the bundled Docker Compose stack.

The OpenAI API key needed for AI features is supplied separately in the Devpost submission. Do not add it to the repository.

### Prerequisites

- Docker Desktop or Docker Engine with Docker Compose
- Node.js 22 or 24
- pnpm

### 1. Install and configure

```bash
pnpm install
pnpm setup
```

Choose **Local Docker** at the first prompt, then use all default settings:

- Email/password authentication
- Kavero-managed local filesystem storage
- App port `3000`
- Supabase port `54321`
- No model providers selected during setup
- Do not overwrite existing non-secret values
- Do not start immediately when the final prompt appears

Leaving the model-provider selection empty is intentional. The supplied OpenAI key can be added securely inside Kavero after creating the local judge account.

The wizard generates `.env.docker.local`, including the local database, authentication, storage, LiteLLM, and routing secrets required by the Docker stack.

### 2. Start Kavero

Make sure Docker is running, then execute:

```bash
pnpm setup:run
```

The first run builds the containers and can take several minutes. When the services are ready, open:

```txt
http://127.0.0.1:3000
```

### 3. Add the supplied OpenAI key

1. Create a local account with any test email and password.
2. Open **Settings → API Providers**.
3. Add the OpenAI API key supplied with the Devpost submission.
4. Select **GPT-5.6** as the orchestration model.
5. Select **GPT Image 2** as the image-generation model.

The local profile does not require Google OAuth, Google Drive, a hosted Supabase project, or cloud deployment.

### 4. Suggested judge walkthrough

1. Open **Generate**.
2. Enter a rough prompt such as: `A launch graphic for an open-source AI design workspace`.
3. Use **Refine prompt** to exercise GPT-5.6 orchestration.
4. Generate an image with GPT Image 2.
5. Open **Gallery** and confirm the generation and its settings were saved.
6. Open **Canvas**, create a design, and add or upload an image.
7. Open **Copilot** and ask it to add or arrange content on the design.
8. Edit the result and export the design as PNG.

No sample dataset is required. A new local account starts with an empty workspace so the complete Generate → Gallery → Canvas workflow can be evaluated directly.

### Stop the local stack

Press `Ctrl+C` in the terminal running Compose. To stop the containers from another terminal:

```bash
docker compose --env-file .env.docker.local down
```

The named Docker volumes retain local database and file data. Do not add `-v` unless you intentionally want to delete that local data.

## How GPT-5.6 Is Used

GPT-5.6 is an orchestration model in Kavero rather than an image renderer.

- **Prompt Refiner:** interprets an incomplete creative brief, asks focused questions when necessary, and returns a structured refined prompt.
- **Canvas Copilot:** reasons over the current canvas context and selects validated editor tools to modify the design.
- **Provider architecture:** GPT-5.6 is exposed through stable Kavero model aliases and routed through the server-side LiteLLM boundary.
- **Capability-aware controls:** the UI exposes only controls supported by the selected model and omits incompatible request parameters.

GPT Image 2 handles image generation independently. Keeping orchestration and image generation in separate slots allows users to select the best provider and model for each task without hard-coding the product to one vendor.

## How Codex Was Used

I used Codex throughout Build Week to:

- Inspect the existing architecture and trace dependencies across a large codebase.
- Plan module boundaries that preserved canvas, authentication, storage, and history behavior.
- Implement the model catalog, provider routing, runtime availability, and credential boundaries.
- Integrate GPT-5.6 and GPT Image 2 across Generate and Canvas workflows.
- Debug real provider differences, including unsupported GPT-5.6 sampling parameters and Azure tool-call routing behavior.
- Generate focused regression tests and verify changes with TypeScript, Vitest, production builds, Docker, and credentialed provider smokes.
- Maintain evidence-based implementation reports and roadmap decisions throughout the work.

Codex was most valuable as an engineering collaborator across connected surfaces: it helped identify risky boundaries, make focused changes, and verify that foundational AI work did not casually rewrite unrelated product behavior.

The final Build Week repair and verification pass covered **101 test files and 825 tests**, a successful production build, and credentialed Prompt Refiner, image-generation, and Canvas Copilot provider smokes.

## Architecture

Kavero is built with Next.js, React, TypeScript, Fabric.js, Tailwind CSS, Supabase, PostgreSQL, and LiteLLM.

```txt
src/app                    Next.js routes and API entrypoints
src/modules/canvas         Canvas editor runtime
src/modules/canvas/ai      Canvas Copilot and other Canvas AI workflows
src/modules/generation     Standalone Generate workspace
src/modules/gallery        Generated-image history and Gallery
src/modules/model-providers Model catalogs, capabilities, routing, and transport
src/modules/storage        Managed and connected storage foundation
src/modules/assets         Canvas asset helpers
src/modules/editor-panels  Canvas panel UI
src/lib                    Shared auth, Supabase, Drive, plans, and utilities
supabase                   Schema and local foundation SQL
docker                     Local Supabase and LiteLLM support
scripts                    Setup, bootstrap, and verification helpers
```

Important boundaries:

- Provider credentials and routing secrets remain server-side.
- Dynamic provider routes are signed and validated at the LiteLLM boundary.
- Product UI consumes capability and availability metadata instead of embedding provider-specific rules.
- Orchestration and image-generation models are configured independently.
- Local-first storage uses a Docker volume and does not require Google Drive.

## Other Setup Options

The local Docker path above is the supported judging path. The following options are intended for contributors and self-hosters.

### Host development

Run the Next.js development server on the host while keeping LiteLLM in Docker:

```bash
cp .env.local.example .env.local
pnpm gateway:up
pnpm dev
```

On Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
pnpm gateway:up
pnpm dev
```

The gateway is published only on `127.0.0.1:4000`. Stop it with:

```bash
pnpm gateway:down
```

### Cloud / self-host

Use this only with an existing Supabase project or compatible hosted stack:

```bash
pnpm setup
pnpm kavero doctor cloud-self-host
pnpm build
pnpm start
```

The cloud path requires deployment-specific Supabase, authentication, storage, and model-gateway configuration. It is not required for judging this submission.

## Configuration Files

| File | Purpose |
|---|---|
| `.env.docker.local` | Local Docker stack; created by `pnpm setup`. |
| `.env.docker.local.example` | Manual Local Docker reference. |
| `.env.local` | Host development or Cloud/self-host environment. |
| `.env.local.example` | Host development reference. |
| `.env.example` | Manual Cloud/self-host reference. |
| `compose.yml` | Local Docker stack and shared LiteLLM configuration. |
| `compose.dev.yml` | Host-development override that publishes LiteLLM locally. |

The setup CLI keeps existing non-empty values by default, asks before replacing secrets, writes through a backup, and never echoes secrets back to the terminal.

## Commands

| Command | Description |
|---|---|
| `pnpm setup` | Run the guided setup wizard. |
| `pnpm setup:doctor` | Check Local Docker configuration. |
| `pnpm setup:run` | Build and run the Local Docker stack. |
| `pnpm gateway:up` | Start the LiteLLM dependency for host development. |
| `pnpm gateway:down` | Stop the host-development gateway. |
| `pnpm dev` | Start the Next.js development server. |
| `pnpm build` | Create a production build. |
| `pnpm start` | Start the production server. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:smoke` | Run Playwright smoke tests. |

## License

Kavero is released under the Apache License 2.0.
