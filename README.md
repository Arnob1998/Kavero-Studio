<div align="center">

```txt
██╗  ██╗ █████╗ ██╗   ██╗███████╗██████╗  ██████╗  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
██║ ██╔╝██╔══██╗██║   ██║██╔════╝██╔══██╗██╔═══██╗ ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
█████╔╝ ███████║██║   ██║█████╗  ██████╔╝██║   ██║ ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
██╔═██╗ ██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║   ██║ ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
██║  ██╗██║  ██║ ╚████╔╝ ███████╗██║  ██║╚██████╔╝ ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
```

### The open-source Canva alternative for AI design.

**bring your own models &middot; own your files &middot; canvas AI &middot; self-hostable &middot; local-first**

The open design workspace for the AI era.

Canva made design easy. Kavero makes it yours.

</div>

Kavero is an open-source design workspace for people who want AI-powered creative tools without being locked inside one closed platform. It gives you a familiar visual canvas, generated asset history, AI-assisted editing workflows, provider-key control, and a local-first path you can run on your own machine.

## Why Kavero

Creative tools are turning into closed bundles: their models, their storage, their workflow, their pricing. Kavero is built around a different idea.

You should be able to bring your own models, keep control of your files, run the core product yourself, and still get a polished design workspace that feels approachable from the first click.

Kavero is for creators, founders, marketers, small agencies, and builders who need to make social posts, launch graphics, ads, thumbnails, pitch visuals, and client assets without handing the whole workflow to a closed suite.

## Highlights

- **Familiar canvas**: create designs with text, shapes, images, pages, assets, and PNG export.
- **AI generation**: generate visuals with prompt presets, references, model settings, and saved history.
- **Canvas AI**: use AI workflows for layout help, segmentation, asset generation, and image judging.
- **Gallery**: keep generated images organized and bring them back into your work.
- **BYOK provider keys**: keep AI access tied to your own provider accounts.
- **Own your storage**: use local managed storage or connect external storage flows.
- **Local-first setup**: run Kavero with the bundled Docker Compose Supabase stack.
- **Self-hostable foundation**: configure Kavero against your own Supabase-backed deployment.

## Get Started

Prerequisites:

- Node.js 22+ or 24+
- pnpm
- Docker Desktop or Docker Engine

```bash
pnpm install
pnpm setup
pnpm setup:run
```

Open Kavero:

```txt
http://127.0.0.1:3000
```

The setup wizard creates local env files safely, protects existing secrets, and can start the local Docker stack for you.

## Choose Your Setup

### Local Docker

Recommended for trying Kavero with the full local stack.

```bash
pnpm setup
pnpm setup:run
```

Local Docker runs:

- Kavero app
- LiteLLM gateway, internal to the Docker network
- Supabase Auth
- Postgres
- PostgREST
- Supabase Storage
- Supabase bootstrap checks
- Local managed file storage through a Docker volume

Local Docker uses email/password sign-in and this storage contract:

```env
KAVERO_DEPLOYMENT_PROFILE=local-first
KAVERO_AUTH_MODE=password
KAVERO_STORAGE_PROVIDER=kavero-managed
KAVERO_MANAGED_STORAGE_BACKEND=local-filesystem
KAVERO_LOCAL_STORAGE_ROOT=/data/kavero-storage
```

`/data/kavero-storage` is a container path backed by the `kavero-local-storage` Docker volume.

Manual Docker command:

```bash
docker compose --env-file .env.docker.local up --build
```

The LiteLLM service is not published to the host by default. Kavero receives only server-side gateway envs inside the Docker network.

`pnpm setup` generates the local LiteLLM secrets and can collect optional server-side Gemini, OpenAI, Groq, and Ollama values for the gateway. Normal setup does not require editing `docker/litellm/config.yaml`.

### Host Development

Use this path when you want to run the Next.js dev server on your host machine while keeping LiteLLM in Docker as a local dependency.

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

Host development uses:

- `.env.local` for the Next.js app running on your machine
- `compose.dev.yml` to publish only LiteLLM on `127.0.0.1:4000`
- `compose.yml` for the same LiteLLM config used by Local Docker

Set these in `.env.local`:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
KAVERO_API_ORIGIN=http://localhost:3000
KAVERO_MODEL_GATEWAY=litellm
KAVERO_LITELLM_BASE_URL=http://127.0.0.1:4000
KAVERO_LITELLM_API_KEY=sk-change-me
LITELLM_MASTER_KEY=sk-change-me
GEMINI_API_KEY=
```

For the current local dev gateway, `KAVERO_LITELLM_API_KEY` should match `LITELLM_MASTER_KEY`. Add a real `GEMINI_API_KEY` or another provider key for live model calls.

If you use Google auth while developing on `localhost:3000`, add this redirect URL in Supabase Auth:

```txt
http://localhost:3000/auth/callback
```

Stop the dev gateway when finished:

```bash
pnpm gateway:down
```

### Cloud / Self-Host

Use this path when you already have a Supabase project or a hosted Supabase-compatible stack.

```bash
pnpm setup
pnpm kavero doctor cloud-self-host
pnpm build
pnpm start
```

Minimum env shape:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
KAVERO_DEPLOYMENT_PROFILE=cloud
KAVERO_AUTH_MODE=google
```

Optional provider-owned storage:

```env
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
```

Optional Kavero-managed storage:

```env
KAVERO_STORAGE_PROVIDER=kavero-managed
KAVERO_MANAGED_STORAGE_BACKEND=supabase-storage
```

Optional hosted LiteLLM gateway:

```env
KAVERO_MODEL_GATEWAY=litellm
KAVERO_LITELLM_BASE_URL=
KAVERO_LITELLM_API_KEY=
KAVERO_LITELLM_ROUTING_SECRET=
```

Keep LiteLLM credentials, the routing secret, upstream provider keys, and internal gateway URLs server-only. A hosted external LiteLLM service must run the matching Kavero custom-auth hook with the same routing secret and pinned LiteLLM contract; an unmodified LiteLLM endpoint is not supported for dynamic client routing.

Azure OpenAI orchestration and image generation use independent logical configurations. Orchestration uses the `AZURE_API_*` record; Azure GPT Image 2 uses the `AZURE_IMAGE_*` record. The same resource URL and key may be entered explicitly in both records, but values are never copied or inferred between them. See [Azure OpenAI setup](docs/azure-openai-setup.md).

OpenAI orchestration offers stable Kavero aliases for `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.

## First Run

1. Open `http://127.0.0.1:3000`.
2. Create an account.
3. Go to Settings -> API keys.
4. Add your AI provider key.
5. Open `/generate` or `/canvas`.

From there, generate assets, keep them in Gallery, place them into the canvas, edit the design, and export when ready.

## Configuration

| File | Purpose |
|---|---|
| `.env.docker.local` | Local Docker stack. Created by `pnpm setup`. |
| `.env.local` | Local development or Cloud/self-host env. |
| `.env.local.example` | Host development reference for `pnpm dev` plus Docker LiteLLM. |
| `.env.example` | Manual Cloud/self-host reference. |
| `.env.docker.local.example` | Manual Local Docker reference. |
| `compose.dev.yml` | Host development override that publishes LiteLLM to localhost. |

Important envs:

| Env | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-facing Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser/server Supabase client key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-backed app flows and provider-key storage. |
| `NEXT_PUBLIC_SITE_URL` | Public Kavero app origin. |
| `KAVERO_DEPLOYMENT_PROFILE` | `cloud` or `local-first`. |
| `KAVERO_AUTH_MODE` | `google`, `password`, or `google-password`. |
| `KAVERO_STORAGE_PROVIDER` | Selects new-write storage behavior. |
| `KAVERO_MANAGED_STORAGE_BACKEND` | `supabase-storage` or `local-filesystem`. |
| `KAVERO_LOCAL_STORAGE_ROOT` | Absolute storage root, or `/data/kavero-storage` in Docker. |
| `KAVERO_MODEL_GATEWAY` | Server-side model gateway selector for LiteLLM-backed model calls. |
| `KAVERO_LITELLM_BASE_URL` | Server-side LiteLLM base URL. Uses `http://litellm:4000` in Docker and `http://127.0.0.1:4000` for host development. |
| `KAVERO_LITELLM_API_KEY` | Server-side Kavero-to-LiteLLM credential. |
| `KAVERO_LITELLM_ROUTING_SECRET` | Separate server-only HMAC secret shared with the matching Kavero LiteLLM custom-auth hook. |
| `KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE` | Server-side credential policy: `env-or-user` (default), `user-required`, or `env-only`. |
| `LITELLM_MASTER_KEY` | Local LiteLLM service master key. Generated by setup for Local Docker. |
| `GEMINI_API_KEY` | Optional server-side Gemini key for the LiteLLM gateway. |
| `OPENAI_API_KEY` | Optional server-side OpenAI key for the LiteLLM gateway. |
| `GROQ_API_KEY` | Optional server-side Groq key for the LiteLLM gateway. |
| `AZURE_API_KEY` | Optional server-side Azure OpenAI key; requires all other Azure values. |
| `AZURE_API_BASE` | Azure OpenAI HTTPS endpoint such as `https://resource.openai.azure.com`. |
| `AZURE_API_VERSION` | Azure OpenAI API version used for orchestration requests. |
| `AZURE_DEPLOYMENT_NAME` | Account-specific Azure OpenAI deployment name; kept server-only. |
| `AZURE_BASE_MODEL` | Curated routing family: `gpt-4o`, `gpt-4.1`, `gpt-5`, `gpt-5.6-sol`, `gpt-5.6-terra`, or `gpt-5.6-luna`. GPT-5 families use LiteLLM's explicit `azure/gpt5_series/<deployment>` route. |
| `AZURE_IMAGE_API_KEY` | Azure image-slot key, supplied independently even when identical to `AZURE_API_KEY`. |
| `AZURE_IMAGE_API_BASE` | Azure image-slot resource URL, supplied independently even when identical to `AZURE_API_BASE`. |
| `AZURE_IMAGE_API_VERSION` | Validated Azure GPT Image 2 API version: `2024-02-01`. |
| `AZURE_IMAGE_DEPLOYMENT_NAME` | Azure GPT Image 2 deployment name; kept server-only. |
| `AZURE_IMAGE_BASE_MODEL` | Validated image family: `gpt-image-2`. |
| `OLLAMA_BASE_URL` | Optional server-side Ollama URL for the LiteLLM gateway. |

The setup CLI keeps existing non-empty values by default, asks before replacing secrets, writes through a backup, and never echoes secrets back to your terminal.

## Commands

| Command | Description |
|---|---|
| `pnpm setup` | Guided setup wizard. |
| `pnpm setup:doctor` | Check Local Docker configuration. |
| `pnpm kavero doctor cloud-self-host` | Check Cloud/self-host configuration. |
| `pnpm setup:run` | Run Local Docker with `docker compose up --build`. |
| `pnpm gateway:up` | Start the LiteLLM Docker dependency for host development. |
| `pnpm gateway:down` | Stop the LiteLLM Docker dependency for host development. |
| `pnpm dev` | Start the Next.js development server. |
| `pnpm build` | Build for production. |
| `pnpm start` | Start the production server. |
| `pnpm test` | Run Vitest. |
| `pnpm test:smoke` | Run Playwright smoke tests. |

## Architecture

```txt
src/app                    Next.js routes and API route entrypoints
src/modules/canvas         Canvas editor runtime
src/modules/canvas/ai      Canvas AI workflows
src/modules/generation     Standalone /generate runtime
src/modules/gallery        Generated image history and Gallery runtime
src/modules/storage        Managed and connected storage foundation
src/modules/assets         Canvas asset helpers
src/modules/editor-panels  Canvas panel UI
src/lib                    Shared auth, Supabase, Drive, provider-key, and utility code
supabase                   Schema and local foundation SQL
docker                     Local Supabase Compose support
scripts                    Setup, bootstrap, and verification helpers
```

## Development

```bash
pnpm install
cp .env.local.example .env.local
pnpm gateway:up
pnpm dev
```

`pnpm dev` runs the app on the host. If you want LiteLLM-backed AI features during host development, keep `pnpm gateway:up` running and point `.env.local` at `http://127.0.0.1:4000`.

Useful checks:

```bash
pnpm exec vitest run scripts/setup
pnpm exec vitest run src/modules/generation
pnpm exec tsc --noEmit
pnpm build
```

Local Supabase helper scripts are available when you want to work outside the Docker Compose app flow:

```bash
pnpm supabase:local:start
pnpm supabase:local:bootstrap
pnpm supabase:local:smoke
```

## License

Kavero is released under the Apache License 2.0.
