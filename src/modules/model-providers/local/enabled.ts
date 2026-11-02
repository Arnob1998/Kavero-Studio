/** Server-only opt-in. An explicit normal setting overrides legacy proof flags. */
export function localGenerationEnabled() {
  const setting = process.env.KAVERO_LOCAL_GENERATION_ENABLED;
  return setting !== undefined ? setting === "1" : process.env.KAVERO_LOCAL_GENERATION_INTERNAL === "1";
}
export function localGenerationUIEnabled() {
  return localGenerationEnabled() && (process.env.KAVERO_LOCAL_GENERATION_ENABLED === "1" || process.env.KAVERO_LOCAL_GENERATION_UI_INTERNAL === "1");
}
