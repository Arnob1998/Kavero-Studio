"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Eye, EyeOff, KeyRound, LockKeyhole, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CredentialFieldId = "apiKey" | "apiBase" | "apiVersion" | "deploymentName" | "baseModel";

export type BrowserProviderKeyCatalogEntry = {
  id: string;
  label: string;
  logoPath: string;
  checkMode: "live" | "validation-only";
  credentialFields: Array<{
    id: CredentialFieldId;
    label: string;
    required: boolean;
    secret: boolean;
    inputType: "password" | "url" | "text" | "select";
    options?: Array<{ value: string; label: string }>;
  }>;
};

export type ProviderKeyMetadata = {
  id: string;
  provider_id: string;
  provider_label: string;
  key_hint: string | null;
  status: "active" | "disabled";
  last_checked_at: string | null;
  created_at?: string | null;
  updated_at: string | null;
};

type FormValues = Partial<Record<CredentialFieldId, string>>;
type CheckState = "idle" | "checking" | "live-passed" | "validated" | "failed";
type SaveState = "idle" | "saving" | "saved" | "failed";

export function ProviderKeyManager({
  providers,
  savedKeys,
  loading,
  onSaved,
}: {
  providers: BrowserProviderKeyCatalogEntry[];
  savedKeys: ProviderKeyMetadata[];
  loading: boolean;
  onSaved: (providerKey: ProviderKeyMetadata) => void;
}) {
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>("google-gemini");
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [checkedFingerprints, setCheckedFingerprints] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  const savedByProvider = useMemo(
    () => new Map(savedKeys.map((key) => [key.provider_id, key])),
    [savedKeys],
  );

  function updateField(providerId: string, fieldId: CredentialFieldId, value: string) {
    setForms((current) => ({
      ...current,
      [providerId]: { ...current[providerId], [fieldId]: value },
    }));
    setCheckStates((current) => ({ ...current, [providerId]: "idle" }));
    setSaveStates((current) => ({ ...current, [providerId]: "idle" }));
    setCheckedFingerprints((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  }

  function getCredentials(provider: BrowserProviderKeyCatalogEntry) {
    const values = forms[provider.id] ?? {};
    return Object.fromEntries(
      provider.credentialFields.flatMap((field) => {
        const value = values[field.id]?.trim() ?? "";
        return value ? [[field.id, value]] : [];
      }),
    );
  }

  function hasRequiredFields(provider: BrowserProviderKeyCatalogEntry) {
    const values = forms[provider.id] ?? {};
    return provider.credentialFields.every(
      (field) => !field.required || Boolean(values[field.id]?.trim()),
    );
  }

  async function checkProvider(provider: BrowserProviderKeyCatalogEntry) {
    if (!hasRequiredFields(provider)) return;

    const credentials = getCredentials(provider);
    const fingerprint = JSON.stringify(credentials);
    setCheckStates((current) => ({ ...current, [provider.id]: "checking" }));
    setSaveStates((current) => ({ ...current, [provider.id]: "idle" }));

    try {
      const response = await fetch("/api/provider-keys/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, credentials }),
      });
      const payload = (await response.json().catch(() => null)) as { status?: string } | null;
      const state =
        response.ok && payload?.status === "passed"
          ? "live-passed"
          : response.ok && payload?.status === "validation_only"
            ? "validated"
            : "failed";

      setCheckStates((current) => ({ ...current, [provider.id]: state }));
      if (state === "live-passed" || state === "validated") {
        setCheckedFingerprints((current) => ({ ...current, [provider.id]: fingerprint }));
      }
    } catch {
      setCheckStates((current) => ({ ...current, [provider.id]: "failed" }));
    }
  }

  async function saveProvider(provider: BrowserProviderKeyCatalogEntry) {
    const credentials = getCredentials(provider);
    const fingerprint = JSON.stringify(credentials);
    const checkState = checkStates[provider.id] ?? "idle";
    if (
      !hasRequiredFields(provider) ||
      !["live-passed", "validated"].includes(checkState) ||
      checkedFingerprints[provider.id] !== fingerprint
    ) {
      return;
    }

    setSaveStates((current) => ({ ...current, [provider.id]: "saving" }));

    try {
      const response = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, credentials }),
      });
      const payload = (await response.json().catch(() => null)) as {
        providerKey?: {
          id: string;
          providerId: string;
          providerLabel: string;
          keyHint: string | null;
          status: "active" | "disabled";
          lastCheckedAt: string | null;
          updatedAt: string | null;
        };
      } | null;

      if (!response.ok || !payload?.providerKey) {
        setSaveStates((current) => ({ ...current, [provider.id]: "failed" }));
        return;
      }

      onSaved({
        id: payload.providerKey.id,
        provider_id: payload.providerKey.providerId,
        provider_label: payload.providerKey.providerLabel,
        key_hint: payload.providerKey.keyHint,
        status: payload.providerKey.status,
        last_checked_at: payload.providerKey.lastCheckedAt,
        updated_at: payload.providerKey.updatedAt,
      });
      setForms((current) => ({ ...current, [provider.id]: {} }));
      setVisibleSecrets((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${provider.id}:`))),
      );
      setCheckStates((current) => ({ ...current, [provider.id]: "idle" }));
      setSaveStates((current) => ({ ...current, [provider.id]: "saved" }));
      setCheckedFingerprints((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
    } catch {
      setSaveStates((current) => ({ ...current, [provider.id]: "failed" }));
    }
  }

  return (
    <section className="rounded-lg border border-white/[0.08] bg-black/16 p-4">
      <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-white">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-white/58">
          <KeyRound size={16} />
        </span>
        Provider keys
      </div>
      <div className="grid gap-2">
        {providers.map((provider) => {
          const savedKey = savedByProvider.get(provider.id);
          const expanded = expandedProviderId === provider.id;
          const checkState = checkStates[provider.id] ?? "idle";
          const saveState = saveStates[provider.id] ?? "idle";
          const canSubmit = hasRequiredFields(provider);

          return (
            <div key={provider.id} className="rounded-lg border border-white/[0.08] bg-white/[0.025]">
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 px-3 text-left"
                aria-expanded={expanded}
                aria-label={`${provider.label} provider settings`}
                onClick={() => setExpandedProviderId(expanded ? null : provider.id)}
              >
                <span className="grid h-8 w-8 place-items-center rounded-md bg-white">
                  <img src={provider.logoPath} alt="" className="h-6 w-6 object-contain" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white/82">{provider.label}</span>
                  <span className="block truncate text-[11px] font-medium text-white/40">
                    {savedKey?.status === "active"
                      ? `Saved ${savedKey.key_hint ?? "Configured"}`
                      : savedKey?.status === "disabled"
                        ? "Disabled"
                        : "Not configured"}
                  </span>
                </span>
                <span
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                    provider.checkMode === "live"
                      ? "border-accent/30 bg-accent/10 text-blue-100"
                      : "border-white/[0.1] bg-white/[0.04] text-white/46",
                  )}
                >
                  {provider.checkMode === "live" ? "Live check" : "Validation only"}
                </span>
                <ChevronDown size={16} className={cn("text-white/36 transition", expanded && "rotate-180")} />
              </button>

              {expanded ? (
                <div className="grid gap-3 border-t border-white/[0.07] p-3">
                  {provider.credentialFields.map((field) => {
                    const visibilityKey = `${provider.id}:${field.id}`;
                    const showSecret = Boolean(visibleSecrets[visibilityKey]);
                    return (
                      <label key={field.id} className="grid gap-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-white/42">
                          {field.label}{field.required ? " *" : " (optional)"}
                        </span>
                        <span className="relative">
                          {field.inputType === "select" ? (
                            <select
                              className="h-10 w-full rounded-lg border border-white/[0.08] bg-black/40 px-3 text-[13px] font-medium text-white outline-none focus:border-accent/70"
                              aria-label={`${provider.label} ${field.label}`}
                              value={forms[provider.id]?.[field.id] ?? ""}
                              disabled={loading || saveState === "saving"}
                              onChange={(event) => updateField(provider.id, field.id, event.target.value)}
                            >
                              <option value="">Select a supported family</option>
                              {field.options?.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          ) : (
                          <input
                            className="h-10 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 pr-10 text-[13px] font-medium text-white outline-none placeholder:text-white/25 focus:border-accent/70"
                            aria-label={`${provider.label} ${field.label}`}
                            type={field.secret && !showSecret ? "password" : field.inputType === "password" ? "text" : field.inputType}
                            autoComplete="off"
                            value={forms[provider.id]?.[field.id] ?? ""}
                            placeholder={
                              field.secret
                                ? "Enter a new secret"
                                : field.id === "apiBase"
                                  ? provider.id === "azure-openai"
                                    ? "https://resource.openai.azure.com"
                                    : "https://provider.example/v1"
                                  : field.id === "deploymentName"
                                    ? "Enter deployment name"
                                    : "Enter API version"
                            }
                            disabled={loading || saveState === "saving"}
                            onChange={(event) => updateField(provider.id, field.id, event.target.value)}
                          />
                          )}
                          {field.secret ? (
                            <button
                              type="button"
                              className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-white/40 hover:bg-white/[0.08] hover:text-white"
                              aria-label={showSecret ? `Hide ${provider.label} ${field.label}` : `Show ${provider.label} ${field.label}`}
                              onClick={() => setVisibleSecrets((current) => ({ ...current, [visibilityKey]: !current[visibilityKey] }))}
                            >
                              {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}

                  <ProviderActionStatus
                    provider={provider}
                    savedKey={savedKey}
                    checkState={checkState}
                    saveState={saveState}
                  />

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      className="h-9 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 text-white hover:bg-white/[0.1]"
                      disabled={loading || !canSubmit || checkState === "checking" || saveState === "saving"}
                      onClick={() => void checkProvider(provider)}
                    >
                      <CheckCircle2 size={14} />
                      {checkState === "checking" ? "Checking" : provider.checkMode === "live" ? "Check key" : "Validate"}
                    </Button>
                    <Button
                      className="h-9 rounded-lg bg-accent px-3 text-white hover:bg-accent-hover"
                      disabled={loading || !["live-passed", "validated"].includes(checkState) || saveState === "saving"}
                      onClick={() => void saveProvider(provider)}
                    >
                      <Save size={14} />
                      {saveState === "saving" ? "Saving" : savedKey ? "Replace credentials" : "Save credentials"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProviderActionStatus({
  provider,
  savedKey,
  checkState,
  saveState,
}: {
  provider: BrowserProviderKeyCatalogEntry;
  savedKey?: ProviderKeyMetadata;
  checkState: CheckState;
  saveState: SaveState;
}) {
  const message =
    saveState === "saved"
      ? "Credentials saved. Re-enter all required fields to replace them."
      : saveState === "failed"
        ? "Could not save credentials. Check the fields and try again."
        : checkState === "checking"
          ? provider.checkMode === "live" ? "Running a server-side live check." : "Validating credential fields."
          : checkState === "live-passed"
            ? "Live check passed. Credentials are ready to save."
            : checkState === "validated"
              ? "Credentials validated locally. A live check is not available."
              : checkState === "failed"
                ? "Check failed. Confirm the submitted fields and try again."
                : savedKey?.status === "disabled"
                  ? `Saved credentials are disabled. ${formatMetadataTimes(savedKey)}`
                  : savedKey
                    ? `${savedKey.key_hint ?? "Configured"} is saved. ${formatMetadataTimes(savedKey)} Re-enter required fields to replace it.`
                  : "Saved values are never displayed after submission.";
  const failed = saveState === "failed" || checkState === "failed";
  const passed = saveState === "saved" || checkState === "live-passed" || checkState === "validated";

  return (
    <div className={cn(
      "flex min-h-10 items-center gap-2 rounded-lg border px-3 text-[12px] font-medium",
      failed
        ? "border-red-400/30 bg-red-500/10 text-red-100"
        : passed
          ? "border-accent/40 bg-accent/10 text-blue-100"
          : "border-white/[0.08] bg-white/[0.03] text-white/44",
    )}>
      {failed ? <XCircle size={14} /> : passed ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}
      <span>{message}</span>
    </div>
  );
}

function formatMetadataTimes(savedKey: ProviderKeyMetadata) {
  const checked = formatTimestamp(savedKey.last_checked_at);
  const saved = formatTimestamp(savedKey.updated_at);
  return [checked ? `Last checked ${checked}.` : "", saved ? `Last saved ${saved}.` : ""]
    .filter(Boolean)
    .join(" ");
}

function formatTimestamp(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}
