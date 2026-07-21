import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const image = "docker.litellm.ai/berriai/litellm@sha256:e4b91a2de9367ab0987baaa767b2283390badd5a361357993de1a05f027edc22";
const network = "kavero-mp9f1-gate";
const proxy = "mp9f1-litellm";
const mock = "mp9f1-mock";
const broken = "mp9f1-broken-hook";
const missingSecret = "mp9f1-missing-secret";
const proxyPort = 41401;
const mockPort = 41402;
const masterKey = "sk-gateway-canary-MP9F1-012345678901234567890";
const routingSecret = "routing_secret_canary_MP9F1_012345678901234567890123456789";
const providerCanary = "provider-credential-canary-MP9F1";
const promptCanary = "prompt-canary-MP9F1-never-log";
const imageCanary = "image-canary-MP9F1-never-log";
const signatureCanary = "signature-canary-MP9F1-never-log";
const repo = process.cwd();
const results = [];

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: repo,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
  });
  if (options.allowFailure || result.status === 0) return result;
  throw new Error(`Docker command failed (${args[0]}): ${result.stderr || result.stdout}`);
}

function mount(file) {
  return path.resolve(repo, file).replaceAll("\\", "/");
}

async function request(pathname, { method = "POST", body, key = masterKey, signature, contentType = "application/json" } = {}) {
  const headers = { authorization: `Bearer ${key}` };
  if (body !== undefined) headers["content-type"] = contentType;
  if (signature) Object.assign(headers, signature);
  return fetch(`http://127.0.0.1:${proxyPort}${pathname}`, {
    method,
    headers,
    body,
  });
}

function signedHeaders(pathname, body, { method = "POST", timestamp = Math.floor(Date.now() / 1000), secret = routingSecret } = {}) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = ["kavero-litellm-routing", "v1", String(timestamp), method, pathname, bodyHash].join("\n");
  return {
    "x-kavero-routing-version": "v1",
    "x-kavero-routing-timestamp": String(timestamp),
    "x-kavero-routing-signature": createHmac("sha256", secret).update(canonical, "utf8").digest("hex"),
  };
}

function imageEditFixture() {
  const boundary = "kavero-security-gate-boundary";
  const body = Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nkavero-image-gate\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nsecurity-gate-image-edit\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nhigh\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="background"\r\n\r\nopaque\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="gate.png"\r\nContent-Type: image/png\r\n\r\nKAVERO_MULTIPART_IMAGE_CANARY\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="mask"; filename="mask.png"\r\nContent-Type: image/png\r\n\r\nKAVERO_MULTIPART_MASK_CANARY\r\n`,
    `--${boundary}--\r\n`,
  ].join(""), "utf8");
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function hits() {
  const response = await fetch(`http://127.0.0.1:${mockPort}/hits`);
  return response.json();
}

async function resetHits() {
  await fetch(`http://127.0.0.1:${mockPort}/hits`, { method: "DELETE" });
}

function record(name, passed, details) {
  results.push({ name, passed, ...details });
  if (!passed) throw new Error(`${name} failed`);
}

async function rejection(name, send) {
  await resetHits();
  const response = await send();
  const observed = await hits();
  record(name, !response.ok && observed.count === 0, { status: response.status, upstreamHits: observed.count });
}

async function waitForReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/health/readiness`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("LiteLLM did not become ready");
}

async function waitForExit(container, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "-f", "{{.State.Status}}|{{.State.ExitCode}}", container]).stdout.trim();
    if (state.startsWith("exited|")) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return docker(["inspect", "-f", "{{.State.Status}}|{{.State.ExitCode}}", container]).stdout.trim();
}

function dynamicBody({ alias, model, apiBase }) {
  return JSON.stringify({
    model: alias,
    messages: [{ role: "user", content: "security-gate" }],
    user_config: {
      model_list: [
        {
          model_name: alias,
          litellm_params: {
            model,
            api_key: providerCanary,
            api_base: apiBase,
            api_version: "2025-04-01-preview",
          },
        },
      ],
    },
  });
}

function dynamicImageBody({ alias, deployment, apiBase }) {
  return JSON.stringify({
    model: alias,
    prompt: "security-gate-azure-image",
    n: 1,
    size: "1024x1024",
    quality: "low",
    user_config: {
      model_list: [
        {
          model_name: alias,
          litellm_params: {
            model: `azure/${deployment}`,
            api_key: providerCanary,
            api_base: apiBase,
            api_version: "2024-02-01",
          },
        },
      ],
    },
  });
}

async function main() {
  cleanup();
  docker(["network", "create", network]);
  docker([
    "run", "-d", "--name", mock, "--network", network, "-p", `${mockPort}:8080`,
    "-v", `${mount("docker/litellm/security-gate/mock_upstream.py")}:/app/mock_upstream.py:ro`,
    "--entrypoint", "python", image, "/app/mock_upstream.py",
  ]);
  docker([
    "run", "-d", "--name", proxy, "--network", network, "-p", `${proxyPort}:4000`,
    "-e", `LITELLM_MASTER_KEY=${masterKey}`,
    "-e", `KAVERO_LITELLM_ROUTING_SECRET=${routingSecret}`,
    "-v", `${mount("docker/litellm/security-gate/config.yaml")}:/app/config.yaml:ro`,
    "-v", `${mount("docker/litellm/kavero_auth.py")}:/app/kavero_auth.py:ro`,
    "-v", `${mount("docker/litellm/start.py")}:/app/start.py:ro`,
    "--entrypoint", "python", image, "/app/start.py",
  ]);
  await waitForReady();

  const version = docker(["exec", proxy, "python", "-c", "import importlib.metadata; print(importlib.metadata.version('litellm'))"]).stdout.trim();
  record("pinned LiteLLM identity", version === "1.90.3", { version, digest: image.split("@")[1] });

  await resetHits();
  const staticBody = JSON.stringify({ model: "kavero-static-gate", messages: [{ role: "user", content: promptCanary }] });
  let response = await request("/v1/chat/completions", { body: staticBody, signature: signedHeaders("/v1/chat/completions", staticBody) });
  let observed = await hits();
  record("signed static alias", response.ok && observed.count === 1 && observed.hits[0].path.startsWith("/static/v1/chat/completions"), { status: response.status, upstreamHits: observed.count, paths: observed.hits.map((hit) => hit.path) });

  await resetHits();
  const largeBody = JSON.stringify({
    model: "kavero-static-gate",
    messages: [{ role: "user", content: [{ type: "text", text: "KAVERO_LARGE_MULTIMODAL_MARKER" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(2_000_000)}${imageCanary}` } }] }],
  });
  response = await request("/v1/chat/completions", { body: largeBody, signature: signedHeaders("/v1/chat/completions", largeBody) });
  observed = await hits();
  record("large multimodal exact-body preservation", response.ok && observed.count === 1 && observed.hits[0].hasLargeMarker && observed.hits[0].bodyBytes > 1_900_000, { status: response.status, upstreamHits: observed.count, upstreamBodyBytes: observed.hits[0]?.bodyBytes ?? 0 });

  await resetHits();
  const imageGenerationBody = JSON.stringify({ model: "kavero-image-gate", prompt: "security-gate-image", n: 1, size: "auto", quality: "auto" });
  response = await request("/v1/images/generations", { body: imageGenerationBody, signature: signedHeaders("/v1/images/generations", imageGenerationBody) });
  observed = await hits();
  const imageGenerationError = response.ok ? "" : await response.text();
  record("signed GPT Image generation", response.ok && observed.count === 1 && observed.hits[0].path.includes("/images/generations"), { status: response.status, upstreamHits: observed.count, paths: observed.hits.map((hit) => hit.path), error: imageGenerationError.slice(0, 500) });

  await resetHits();
  const azureImageDeployment = "gate-azure-image";
  const azureImageBase = "http://mp9f1-mock:8080/azure-image";
  const azureImageBody = dynamicImageBody({
    alias: "kavero-image-azure-gpt-image-2",
    deployment: azureImageDeployment,
    apiBase: azureImageBase,
  });
  response = await request("/v1/images/generations", {
    body: azureImageBody,
    signature: signedHeaders("/v1/images/generations", azureImageBody),
  });
  observed = await hits();
  record(
    "signed Azure GPT Image mapping",
    response.ok &&
      observed.count === 1 &&
      observed.hits[0].path.startsWith("/azure-image/") &&
      observed.hits[0].path.includes(`/deployments/${azureImageDeployment}/images/generations`) &&
      observed.hits[0].path.includes("api-version=2024-02-01"),
    { status: response.status, upstreamHits: observed.count, paths: observed.hits.map((hit) => hit.path) },
  );

  const editFixture = imageEditFixture();
  await rejection("signed GPT Image multipart edit remains fail-closed", () => request("/v1/images/edits", {
    body: editFixture.body,
    contentType: editFixture.contentType,
    signature: signedHeaders("/v1/images/edits", editFixture.body),
  }));

  for (const fixture of [
    { name: "signed Azure GPT-4.1/4o mapping", alias: "gate-azure-four", model: "azure/gate-gpt-4o", deployment: "gate-gpt-4o", base: "http://mp9f1-mock:8080/azure-four" },
    { name: "signed Azure GPT-5 mapping", alias: "gate-azure-five", model: "azure/gpt5_series/gate-gpt-5", deployment: "gate-gpt-5", base: "http://mp9f1-mock:8080/azure-five" },
    { name: "signed Azure GPT-5.6 Sol mapping", alias: "gate-azure-sol", model: "azure/gpt5_series/custom-sol", deployment: "custom-sol", base: "http://mp9f1-mock:8080/azure-sol" },
    { name: "signed Azure GPT-5.6 Terra mapping", alias: "gate-azure-terra", model: "azure/gpt5_series/custom-terra", deployment: "custom-terra", base: "http://mp9f1-mock:8080/azure-terra" },
    { name: "signed Azure GPT-5.6 Luna mapping", alias: "gate-azure-luna", model: "azure/gpt5_series/custom-luna", deployment: "custom-luna", base: "http://mp9f1-mock:8080/azure-luna" },
  ]) {
    await resetHits();
    const body = dynamicBody({ alias: fixture.alias, model: fixture.model, apiBase: fixture.base });
    response = await request("/v1/chat/completions", { body, signature: signedHeaders("/v1/chat/completions", body) });
    observed = await hits();
    record(
      fixture.name,
      response.ok &&
        observed.count === 1 &&
        observed.hits[0].path.startsWith(new URL(fixture.base).pathname) &&
        observed.hits[0].path.includes(`/deployments/${fixture.deployment}/`),
      { status: response.status, upstreamHits: observed.count, paths: observed.hits.map((hit) => hit.path) },
    );
  }

  const dynamic = dynamicBody({ alias: "unsigned-dynamic", model: "openai/arbitrary-model", apiBase: "http://mp9f1-mock:8080/arbitrary" });
  await rejection("gateway key without signature", () => request("/v1/chat/completions", { body: dynamic }));
  await rejection("wrong gateway key", () => request("/v1/chat/completions", { body: staticBody, key: "sk-wrong-key", signature: signedHeaders("/v1/chat/completions", staticBody) }));
  await rejection("missing signature", () => request("/v1/chat/completions", { body: staticBody }));
  await rejection("invalid signature", () => request("/v1/chat/completions", { body: staticBody, signature: { ...signedHeaders("/v1/chat/completions", staticBody), "x-kavero-routing-signature": signatureCanary } }));
  await rejection("stale timestamp", () => request("/v1/chat/completions", { body: staticBody, signature: signedHeaders("/v1/chat/completions", staticBody, { timestamp: Math.floor(Date.now() / 1000) - 90 }) }));
  await rejection("body modified after signing", () => request("/v1/chat/completions", { body: `${staticBody} `, signature: signedHeaders("/v1/chat/completions", staticBody) }));
  await rejection("path modified after signing", () => request("/v1/images/generations", { body: staticBody, signature: signedHeaders("/v1/chat/completions", staticBody) }));
  await rejection("tampered multipart image edit", () => request("/v1/images/edits", {
    body: Buffer.concat([editFixture.body, Buffer.from("tampered")]),
    contentType: editFixture.contentType,
    signature: signedHeaders("/v1/images/edits", editFixture.body),
  }));
  await rejection("missing multipart signature", () => request("/v1/images/edits", {
    body: editFixture.body,
    contentType: editFixture.contentType,
  }));
  await rejection("stale multipart signature", () => request("/v1/images/edits", {
    body: editFixture.body,
    contentType: editFixture.contentType,
    signature: signedHeaders("/v1/images/edits", editFixture.body, { timestamp: Math.floor(Date.now() / 1000) - 90 }),
  }));
  await rejection("method modified after signing", () => request("/v1/chat/completions", { method: "PUT", body: staticBody, signature: signedHeaders("/v1/chat/completions", staticBody) }));
  await rejection("arbitrary unsigned provider mapping", () => request("/v1/chat/completions", { body: dynamic }));
  await rejection("unknown signed route", () => request("/v1/responses", { body: staticBody, signature: signedHeaders("/v1/responses", staticBody) }));

  response = await fetch(`http://127.0.0.1:${proxyPort}/health/readiness`);
  record("readiness", response.ok, { status: response.status, upstreamHits: 0 });
  response = await fetch(`http://127.0.0.1:${proxyPort}/health/liveliness`);
  record("liveness", response.ok, { status: response.status, upstreamHits: 0 });
  response = await request("/model/info", { method: "GET" });
  record("model info", response.ok, { status: response.status, upstreamHits: 0 });
  response = await request("/v1/models", { method: "GET" });
  record("model list", response.ok, { status: response.status, upstreamHits: 0 });

  docker([
    "run", "-d", "--name", broken,
    "-e", `LITELLM_MASTER_KEY=${masterKey}`,
    "-e", `KAVERO_LITELLM_ROUTING_SECRET=${routingSecret}`,
    "-v", `${mount("docker/litellm/start.py")}:/app/start.py:ro`,
    "--entrypoint", "python", image, "/app/start.py",
  ]);
  const brokenState = await waitForExit(broken);
  record("hook import failure prevents startup", brokenState.startsWith("exited|") && !brokenState.endsWith("|0"), { containerState: brokenState, upstreamHits: 0 });

  docker([
    "run", "-d", "--name", missingSecret,
    "-e", `LITELLM_MASTER_KEY=${masterKey}`,
    "-v", `${mount("docker/litellm/kavero_auth.py")}:/app/kavero_auth.py:ro`,
    "-v", `${mount("docker/litellm/start.py")}:/app/start.py:ro`,
    "--entrypoint", "python", image, "/app/start.py",
  ]);
  const missingSecretState = await waitForExit(missingSecret);
  record("hook configuration failure prevents startup", missingSecretState.startsWith("exited|") && !missingSecretState.endsWith("|0"), { containerState: missingSecretState, upstreamHits: 0 });

  const logs = [docker(["logs", proxy], { allowFailure: true }), docker(["logs", mock], { allowFailure: true }), docker(["logs", broken], { allowFailure: true }), docker(["logs", missingSecret], { allowFailure: true })]
    .map((result) => `${result.stdout}${result.stderr}`).join("\n");
  const forbidden = [masterKey, routingSecret, providerCanary, promptCanary, imageCanary, signatureCanary, staticBody, largeBody];
  const leaks = forbidden.filter((value) => logs.includes(value)).length;
  record("secret-free container logs", leaks === 0, { leakedCanaries: leaks, upstreamHits: 0 });

  process.stdout.write(`${JSON.stringify({ image, results }, null, 2)}\n`);
}

function cleanup() {
  docker(["rm", "-f", proxy, mock, broken, missingSecret], { allowFailure: true, timeout: 30_000 });
  docker(["network", "rm", network], { allowFailure: true, timeout: 30_000 });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write(`${JSON.stringify({ image, results }, null, 2)}\n`);
  process.exitCode = 1;
}).finally(cleanup);
