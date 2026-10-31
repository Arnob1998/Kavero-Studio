export const LOCAL_FAILURE_STAGES = ["staging", "package", "hardware", "intent", "input", "launch", "inference"] as const;
export const LOCAL_FAILURE_CODES = ["gpu-memory-low", "system-memory-low", "disk-space-low", "resources-busy", "device-changed", "backend-unknown", "hardware-tools-unavailable", "hardware-check-timeout", "package-changed", "package-missing", "intent-changed", "staging-unavailable", "preflight-rejected", "native-outcome-unknown"] as const;
export type LocalFailure = { stage: typeof LOCAL_FAILURE_STAGES[number]; code: typeof LOCAL_FAILURE_CODES[number]; recordedAt: string };
export function validateLocalFailure(value: unknown): LocalFailure {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "code,recordedAt,stage") throw Error("invalid-failure-receipt");
  const record = value as LocalFailure;
  if (!LOCAL_FAILURE_STAGES.includes(record.stage) || !LOCAL_FAILURE_CODES.includes(record.code)
    || typeof record.recordedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.recordedAt)
    || !Number.isFinite(Date.parse(record.recordedAt))) throw Error("invalid-failure-receipt");
  return record;
}
export function failureReceipt(stage: LocalFailure["stage"], error: unknown): LocalFailure {
  const detail = error as { message?: string; code?: string; killed?: boolean; failureCode?: string } | null;
  const messages: Record<string, LocalFailure["code"]> = {
    "device-or-staging-busy": "resources-busy", "device-identity-changed": "device-changed", "backend-mapping-unknown": "backend-unknown", "host-not-verified": "backend-unknown",
    "package-identity-changed": "package-changed", "package-manifest-changed": "package-changed", "package-component-changed": "package-changed", "package-readiness-stale": "package-changed", "unsafe-package-path": "package-changed", "identity-changed": "intent-changed", "unsafe-staging-path": "staging-unavailable",
  };
  let code: LocalFailure["code"] = messages[detail?.message ?? ""] ?? "preflight-rejected";
  if (stage === "hardware") {
    if (["gpu-memory-low", "system-memory-low", "disk-space-low"].includes(detail?.failureCode ?? "")) code = detail!.failureCode as LocalFailure["code"];
    else if (detail?.code === "ENOENT") code = "hardware-tools-unavailable";
    else if (detail?.code === "ETIMEDOUT" || detail?.killed === true) code = "hardware-check-timeout";
  } else if (stage === "package" && detail?.code === "ENOENT") code = "package-missing";
  else if (stage === "staging" && ["ENOENT", "EACCES", "ENOSPC"].includes(detail?.code ?? "")) code = "staging-unavailable";
  if (stage === "inference") code = "native-outcome-unknown";
  return validateLocalFailure({ stage, code, recordedAt: new Date().toISOString() }); // Never persist arbitrary messages, paths, stderr or prompts.
}
export function assertLocalResources(resources: { freeVramMiB: number; freeRamBytes: number; freeDiskBytes: number }) {
  if (Object.values(resources).some(value => !Number.isFinite(value) || value < 0)) throw Error("backend-mapping-unknown");
  const code = resources.freeVramMiB < 6144 ? "gpu-memory-low" : resources.freeRamBytes < 8 * 1024 ** 3 ? "system-memory-low" : resources.freeDiskBytes < 1024 ** 3 ? "disk-space-low" : null;
  if (code) throw Object.assign(Error("device-or-staging-busy"), { failureCode: code });
}
export function localFailureMessage(code: LocalFailure["code"]): string {
  switch (code) {
    case "gpu-memory-low": return "Not enough available GPU memory. Close other GPU apps before starting a new job.";
    case "system-memory-low": return "Not enough available system memory. Close other apps before starting a new job.";
    case "disk-space-low": return "Not enough space on the inference drive. Free space before starting a new job.";
    case "package-changed": case "package-missing": return "The model package is missing or changed. Repair it before starting a new job.";
    case "device-changed": case "backend-unknown": return "The inference device no longer matches the verified configuration. Check compatibility again.";
    case "hardware-tools-unavailable": case "hardware-check-timeout": return "The hardware check could not finish. Check the host and try again explicitly.";
    case "native-outcome-unknown": return "The inference outcome is uncertain. Reconnect to this job; do not submit it again.";
    default: return "Local generation could not pass its preflight checks. Check the host before starting a new job.";
  }
}
