// Display/selection descriptors for committed, runtime-verified recipes only.
// Server and native admission independently validate their immutable identities.
export const localProfiles = [
  { profile: "qwen-image-2.1-q4-evaluation", label: "Qwen Image 2.1 · Q4", recipeId: "qwen-image-2-1", manifest: "35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822", packageId: "qwen-2-1-internal-evaluation", file: "qwen_image_2.1_Q4_K_M.gguf" },
  { profile: "qwen-image-2.1-q3-evaluation", label: "Qwen Image 2.1 · Q3", recipeId: "qwen-image-2-1-q3", manifest: "d730d6d53b7c7fb0c39d5fce0a60c93ae1b00113db3ec4009854463e0c5c29bb", packageId: "qwen-2-1-q3-internal-evaluation", file: "qwen_image_2.1_Q3_K_M.gguf" },
] as const;
export type LocalProfile = typeof localProfiles[number]["profile"];
export function localProfile(value: unknown) { return localProfiles.find(model => model.profile === value); }
export const localImageLimits = { width: 512, height: 512, count: 1, maxPromptCharacters: 1000, references: false, editing: false, planning: false, sequence: false } as const;
