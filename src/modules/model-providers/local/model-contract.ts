// Dependency-free: shared by Next.js and Node's native TypeScript stripping.
// Source config requests discovery. It never grants installation/runtime access.
export type LocalModelSource = {
  id: string;
  source: string;
  preferredFile?: string;
};
export type LocalModelConfig = { schemaVersion: 1; models: LocalModelSource[] };
export type LocalImageCapabilities = {
  textToImage: boolean;
  referenceEditing: boolean;
  masks: boolean;
  planning: boolean;
  sequence: boolean;
  maximumReferences: number;
  sizes: ReadonlyArray<{ width: number; height: number }>;
  counts: readonly number[];
  prompt: { maximum: number; unit: "utf16-code-units"; overflow: "reject" };
  quality: readonly string[];
  background: readonly string[];
  reasoning: readonly string[];
};
export type ModelLicenseReference = {
  component: "image-weights" | "text-encoder" | "vae" | "engine";
  identifier: string | null;
  attribution: "cached-upstream-license" | "cached-model-card" | "unknown";
  sourceUrl: string;
  // Exact cached upstream text is a reference, not executable HTML/Markdown.
  text: null | { sha256: string; bytes: number; path: string };
};
export type ResolvedLocalRecipe = {
  schemaVersion: 1;
  id: string;
  recipeVersion: 1;
  source: LocalModelSource & { revision: string; preferredFile: string };
  label: string;
  runtime: { adapter: "stable-diffusion-cpp"; revision: string; platform: "win32"; arch: "x64"; backend: "vulkan" };
  // Preserve legacy identities until the versioned MH-3 job migration.
  legacy: { profile: string; packageId: string; packageFingerprint: string; receiptHash: string; manifestHash: string; termsDigest: string };
  components: ReadonlyArray<{
    role: "engine" | "image-weights" | "text-encoder" | "vae";
    url: string; revision: string; bytes: number; sha256: string; path: string;
  }>;
  capabilities: LocalImageCapabilities;
  defaults: { steps: number; cfg: number; seed: number; sampler: string };
  execution: { diffusion: "gpu"; encoder: "cpu"; vae: "gpu"; offloadToCpu: boolean; maxVramGiB: number; flashAttention: boolean; vaeTiling: boolean };
  hardware: { minimumVramMiB: number; minimumRamBytes: number; maximumDevices: 1; deviceFamilies: readonly string[] };
  licenses: readonly ModelLicenseReference[];
  evidence: {
    source: "pinned-existing-recipe";
    runtime: "verified-existing-workload";
    hardware: "check-required";
    installed: "check-required";
    // Existing proof is for the pinned workload, not every importing machine.
    performance: "device-specific";
  };
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid-model-config");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw Error("unsupported-model-config-field");
}
const modelId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
export function modelRelativePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 180 || !/^[-a-zA-Z0-9_./]+$/.test(value)
    || value.split("/").some(part => !part || part === "." || part === ".." || part.endsWith(".") || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Error("invalid-model-file");
  return value;
}
export function parseLocalModelSource(input: unknown): LocalModelSource {
  const value = object(input);
  keys(value, ["id", "source"], ["preferredFile"]);
  if (!modelId(value.id) || typeof value.source !== "string" || value.source.length > 512) throw Error("invalid-model-source");
  let url: URL;
  try { url = new URL(value.source); } catch { throw Error("invalid-model-source"); }
  // MH-1 accepts canonical repository links. MH-2 normalizes supported file links
  // before calling this same parser; metadata fetching belongs to that resolver.
  if (url.protocol !== "https:" || url.hostname !== "huggingface.co" || url.port || url.username || url.password || url.search || url.hash
    || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)
    || url.pathname.split("/").some(part => part === "." || part === "..")
    || value.source !== url.href) throw Error("invalid-model-source");
  const source = url.href.replace(/\/$/, "");
  return { id: value.id, source, ...(Object.hasOwn(value, "preferredFile") ? { preferredFile: modelRelativePath(value.preferredFile) } : {}) };
}
export function parseLocalModelConfig(input: unknown): LocalModelConfig {
  const value = object(input); keys(value, ["schemaVersion", "models"]);
  if (value.schemaVersion !== 1 || !Array.isArray(value.models) || value.models.length > 100) throw Error("invalid-model-config");
  const models = value.models.map(parseLocalModelSource);
  if (new Set(models.map(model => model.id)).size !== models.length) throw Error("duplicate-model-id");
  return { schemaVersion: 1, models };
}

// Shape validation is NOT trust or runtime admission. Only a host-owned recipe
// registry can supply execution policy; external metadata cannot become one.
export function parseResolvedLocalRecipe(input: unknown): ResolvedLocalRecipe {
  const fail = () => { throw Error("invalid-resolved-model-recipe"); };
  const record = (value: unknown, names: string[]) => { const result = object(value); keys(result, names); return result; };
  const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 512;
  const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const revision = (value: unknown) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
  const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
  const list = (value: unknown, predicate: (item: unknown) => boolean) => Array.isArray(value) && value.length <= 64 && value.every(predicate);
  const https = (value: unknown) => {
    if (!text(value)) return false;
    try { const url = new URL(value as string); return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash; } catch { return false; }
  };
  const root = record(input, ["schemaVersion", "id", "recipeVersion", "source", "label", "runtime", "legacy", "components", "capabilities", "defaults", "execution", "hardware", "licenses", "evidence"]);
  if (root.schemaVersion !== 1 || root.recipeVersion !== 1 || !modelId(root.id) || !text(root.label)) fail();
  const source = record(root.source, ["id", "source", "revision", "preferredFile"]);
  // A resolved model always identifies one selected weight file.
  // preferredFile is optional in discovery, but mandatory in a runnable recipe.
  parseLocalModelSource({ id: source.id, source: source.source, preferredFile: source.preferredFile });
  if (!revision(source.revision) || source.id !== root.id) fail();
  const runtime = record(root.runtime, ["adapter", "revision", "platform", "arch", "backend"]);
  if (runtime.adapter !== "stable-diffusion-cpp" || !revision(runtime.revision) || runtime.platform !== "win32" || runtime.arch !== "x64" || runtime.backend !== "vulkan") fail();
  const legacy = record(root.legacy, ["profile", "packageId", "packageFingerprint", "receiptHash", "manifestHash", "termsDigest"]);
  if (!text(legacy.profile) || !modelId(legacy.packageId) || ![legacy.packageFingerprint, legacy.receiptHash, legacy.manifestHash, legacy.termsDigest].every(hash)) fail();
  const roles = ["engine", "image-weights", "text-encoder", "vae"];
  if (!Array.isArray(root.components) || root.components.length !== 4) fail();
  const components = root.components as unknown[];
  const seen = new Set();
  for (const item of components) {
    const part = record(item, ["role", "url", "revision", "bytes", "sha256", "path"]);
    if (!roles.includes(part.role as string) || seen.has(part.role) || !https(part.url) || !revision(part.revision) || !integer(part.bytes, 1, 32 * 1024 ** 3) || !hash(part.sha256)) fail();
    seen.add(part.role); modelRelativePath(part.path);
  }
  const caps = record(root.capabilities, ["textToImage", "referenceEditing", "masks", "planning", "sequence", "maximumReferences", "sizes", "counts", "prompt", "quality", "background", "reasoning"]);
  if (![caps.textToImage, caps.referenceEditing, caps.masks, caps.planning, caps.sequence].every(value => typeof value === "boolean") || !integer(caps.maximumReferences, 0, 64)
    || !list(caps.sizes, value => { const size = record(value, ["width", "height"]); return integer(size.width, 1, 16384) && integer(size.height, 1, 16384); })
    || !(caps.sizes as unknown[]).length || !list(caps.counts, value => integer(value, 1, 64)) || !(caps.counts as unknown[]).length
    || ![caps.quality, caps.background, caps.reasoning].every(value => list(value, text))) fail();
  if ((!caps.referenceEditing && caps.maximumReferences !== 0) || (caps.masks && !caps.referenceEditing)) fail();
  const prompt = record(caps.prompt, ["maximum", "unit", "overflow"]);
  if (!integer(prompt.maximum, 1, 1000000) || prompt.unit !== "utf16-code-units" || prompt.overflow !== "reject") fail();
  const defaults = record(root.defaults, ["steps", "cfg", "seed", "sampler"]);
  if (!integer(defaults.steps, 1, 10000) || typeof defaults.cfg !== "number" || !Number.isFinite(defaults.cfg) || defaults.cfg < 0 || defaults.cfg > 100
    || !integer(defaults.seed, 0) || !text(defaults.sampler)) fail();
  const execution = record(root.execution, ["diffusion", "encoder", "vae", "offloadToCpu", "maxVramGiB", "flashAttention", "vaeTiling"]);
  if (execution.diffusion !== "gpu" || execution.encoder !== "cpu" || execution.vae !== "gpu" || !integer(execution.maxVramGiB, 1, 1024)
    || ![execution.offloadToCpu, execution.flashAttention, execution.vaeTiling].every(value => typeof value === "boolean")) fail();
  const hardware = record(root.hardware, ["minimumVramMiB", "minimumRamBytes", "maximumDevices", "deviceFamilies"]);
  if (!integer(hardware.minimumVramMiB, 1) || !integer(hardware.minimumRamBytes, 1) || hardware.maximumDevices !== 1 || !list(hardware.deviceFamilies, text) || !(hardware.deviceFamilies as unknown[]).length) fail();
  if (!Array.isArray(root.licenses) || root.licenses.length !== 4) fail();
  const licenseRoles = new Set();
  for (const item of root.licenses as unknown[]) {
    const license = record(item, ["component", "identifier", "attribution", "sourceUrl", "text"]);
    if (!roles.includes(license.component as string) || licenseRoles.has(license.component) || !(license.identifier === null || text(license.identifier))
      || !["cached-upstream-license", "cached-model-card", "unknown"].includes(license.attribution as string) || !https(license.sourceUrl)) fail();
    licenseRoles.add(license.component);
    if (license.text !== null) {
      const cached = record(license.text, ["sha256", "bytes", "path"]);
      if (!hash(cached.sha256) || !integer(cached.bytes, 1, 256 * 1024)) fail();
      modelRelativePath(cached.path);
    }
  }
  const evidence = record(root.evidence, ["source", "runtime", "hardware", "installed", "performance"]);
  if (evidence.source !== "pinned-existing-recipe" || evidence.runtime !== "verified-existing-workload" || evidence.hardware !== "check-required" || evidence.installed !== "check-required" || evidence.performance !== "device-specific") fail();
  return structuredClone(input) as ResolvedLocalRecipe;
}

function same(input: unknown, expected: unknown): boolean {
  if (input === expected) return true;
  if (!input || !expected || typeof input !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(input) !== Array.isArray(expected)) return false;
  const actual = input as Record<string, unknown>, trusted = expected as Record<string, unknown>;
  const names = Object.keys(trusted);
  return Object.keys(actual).length === names.length && names.every(key => Object.hasOwn(actual, key) && same(actual[key], trusted[key]));
}

// Only the host-owned registry supplies trustedRecipe. A parsed card/config must
// never be used as that argument. This compares ALL fields, including extras.
export function assertResolvedRecipeMatches(input: unknown, trustedRecipe: ResolvedLocalRecipe): void {
  if (!same(input, trustedRecipe)) throw Error("resolved-model-recipe-mismatch");
}

export function validateLocalRecipeIntent(recipe: ResolvedLocalRecipe, input: unknown): boolean {
  const caps = recipe.capabilities;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const intent = input as Record<string, unknown>;
  if (Object.keys(intent).sort().join(",") !== "count,height,profile,prompt,width") return false;
  return caps.textToImage && intent.profile === recipe.legacy.profile && typeof intent.prompt === "string"
    && !!intent.prompt.trim() && intent.prompt.length <= caps.prompt.maximum
    && caps.sizes.some(size => size.width === intent.width && size.height === intent.height)
    && caps.counts.includes(intent.count as number);
}
