"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ProviderKeyManager,
  type BrowserProviderKeyCatalogEntry,
  type ProviderKeyMetadata,
} from "./provider-key-manager";

type CapabilitySlot = "chatOrchestration" | "imageGeneration";

type BrowserModelCatalogEntry = {
  provider: string;
  providerLabel: string;
  providerLogoPath: string;
  providerKeyId: string | null;
  modelAlias: string;
  displayLabel: string;
  capabilities: {
    slots: CapabilitySlot[];
    requirements: string[];
    supportsTools: boolean;
    supportsStructuredJson: boolean;
    supportsMultimodalImageInput: boolean;
    supportsImageOutput: boolean;
    supportsStreaming: boolean;
  };
};

type GatewayStatus = {
  status: "disabled" | "configured" | "error";
  gateway: "litellm" | null;
  configured: boolean;
  issues: Array<{ code: string; message: string }>;
};

type ModelProviderSettings = {
  gateway: GatewayStatus;
  credentialMode: "env-or-user" | "user-required" | "env-only";
  catalog: BrowserModelCatalogEntry[];
  selected: {
    chatOrchestrationModelAlias: string;
    imageGenerationModelAlias: string;
  };
};

type ConnectivityResult = GatewayStatus & {
  checkedAt: string;
  checkedBy: "configuration" | "model-info" | "model-list";
};

type StatusTone = "idle" | "checking" | "passed" | "failed";

export function ProviderSettingsPanel() {
  const [providerCatalog, setProviderCatalog] = useState<BrowserProviderKeyCatalogEntry[]>([]);
  const [savedProviderKeys, setSavedProviderKeys] = useState<ProviderKeyMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [settings, setSettings] = useState<ModelProviderSettings | null>(null);
  const [chatAlias, setChatAlias] = useState("");
  const [imageAlias, setImageAlias] = useState("");
  const [modelSaveStatus, setModelSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [connectivityStatus, setConnectivityStatus] = useState<"idle" | "checking" | "checked" | "failed">("idle");

  const chatModels = useMemo(
    () => settings?.catalog.filter((entry) => entry.capabilities.slots.includes("chatOrchestration")) ?? [],
    [settings],
  );
  const imageModels = useMemo(
    () => settings?.catalog.filter((entry) => entry.capabilities.slots.includes("imageGeneration")) ?? [],
    [settings],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const [providerKeyResponse, modelResponse] = await Promise.all([
          fetch("/api/provider-keys"),
          fetch("/api/model-providers"),
        ]);

        if (providerKeyResponse.ok) {
          const payload = (await providerKeyResponse.json()) as {
            providerKeys?: ProviderKeyMetadata[];
            providers?: BrowserProviderKeyCatalogEntry[];
          };
          if (isMounted) {
            setSavedProviderKeys(payload.providerKeys ?? []);
            setProviderCatalog(payload.providers ?? []);
          }
        } else if (isMounted) {
          setLoadFailed(true);
        }

        if (modelResponse.ok) {
          const modelSettings = (await modelResponse.json()) as ModelProviderSettings;
          if (isMounted) {
            setSettings(modelSettings);
            setChatAlias(modelSettings.selected.chatOrchestrationModelAlias);
            setImageAlias(modelSettings.selected.imageGenerationModelAlias);
          }
        } else if (isMounted) {
          setLoadFailed(true);
        }
      } catch {
        if (isMounted) setLoadFailed(true);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  async function saveModelSettings() {
    if (!chatAlias || !imageAlias) return;

    setModelSaveStatus("saving");

    const response = await fetch("/api/model-providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatOrchestrationModelAlias: chatAlias,
        imageGenerationModelAlias: imageAlias,
      }),
    });

    if (!response.ok) {
      setModelSaveStatus("failed");
      return;
    }

    const nextSettings = (await response.json()) as ModelProviderSettings;
    setSettings(nextSettings);
    setChatAlias(nextSettings.selected.chatOrchestrationModelAlias);
    setImageAlias(nextSettings.selected.imageGenerationModelAlias);
    setModelSaveStatus("saved");
  }

  async function checkGatewayConnectivity() {
    setConnectivityStatus("checking");

    const response = await fetch("/api/model-providers/connectivity", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as ConnectivityResult | null;

    if (!payload) {
      setConnectivityStatus("failed");
      return;
    }

    setConnectivity(payload);
    setConnectivityStatus(response.ok && payload.status !== "error" ? "checked" : "failed");
  }

  const gateway = connectivity ?? settings?.gateway ?? null;
  const hasModelChanges =
    settings &&
    (chatAlias !== settings.selected.chatOrchestrationModelAlias ||
      imageAlias !== settings.selected.imageGenerationModelAlias);

  return (
    <section
      className="grid gap-4 rounded-lg border border-white/[0.1] bg-white/[0.045] p-4 shadow-[0_18px_70px_rgb(0_0_0_/_0.28)] sm:p-5"
      aria-busy={isLoading}
    >
      <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/llm-providers/google.svg" alt="Google" className="h-6 w-auto" />
          <span className="h-5 w-px bg-white/[0.14]" aria-hidden="true" />
          <img
            src="/llm-providers/google-gemini-icon.png"
            alt=""
            className="h-7 w-7 rounded-md bg-white object-contain p-1"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[18px] font-semibold text-white">Providers and models</h2>
            <p className="m-0 mt-0.5 text-[12px] font-medium text-white/42">
              Saved settings. Runtime stable.
            </p>
          </div>
        </div>
        <GatewayBadge gateway={gateway} loading={isLoading} />
      </div>

      {loadFailed ? (
        <StatusLine status="failed" message="Settings could not be loaded. Refresh and try again." />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-4">
          <ProviderKeyManager
            providers={providerCatalog}
            savedKeys={savedProviderKeys}
            loading={isLoading}
            onSaved={(providerKey) => {
              setSavedProviderKeys((current) => [
                providerKey,
                ...current.filter((key) => key.provider_id !== providerKey.provider_id),
              ]);
            }}
          />

          <PanelBlock icon={Server} title="Gateway status">
            <div className="grid gap-3">
              <StatusLine
                status={gateway?.status === "configured" ? "passed" : gateway?.status === "error" ? "failed" : "idle"}
                message={gatewayMessage(gateway)}
              />
              <Button
                className="h-10 rounded-lg border border-white/[0.12] bg-white/[0.06] px-4 text-white hover:bg-white/[0.1]"
                disabled={isLoading || connectivityStatus === "checking"}
                onClick={() => void checkGatewayConnectivity()}
              >
                <RefreshCw size={15} className={cn(connectivityStatus === "checking" && "animate-spin")} />
                {connectivityStatus === "checking" ? "Checking" : "Check connectivity"}
              </Button>
            </div>
          </PanelBlock>
        </div>

        <PanelBlock icon={ShieldCheck} title="Default models">
          <div className="grid gap-4">
            <ModelSelector
              label="Orchestration/chat model"
              value={chatAlias}
              models={chatModels}
              disabled={isLoading || !settings}
              onChange={(value) => {
                setChatAlias(value);
                setModelSaveStatus("idle");
              }}
            />
            <ModelCredentialAdvisory
              model={chatModels.find((model) => model.modelAlias === chatAlias)}
              credentialMode={settings?.credentialMode ?? "env-or-user"}
              savedProviderKeys={savedProviderKeys}
            />
            <ModelSelector
              label="Image-generation model"
              value={imageAlias}
              models={imageModels}
              disabled={isLoading || !settings}
              onChange={(value) => {
                setImageAlias(value);
                setModelSaveStatus("idle");
              }}
            />
            <ModelCredentialAdvisory
              model={imageModels.find((model) => model.modelAlias === imageAlias)}
              credentialMode={settings?.credentialMode ?? "env-or-user"}
              savedProviderKeys={savedProviderKeys}
            />

            <div className="grid gap-2">
              <div className="flex flex-col gap-2 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <StatusText status={modelSaveStatus} hasChanges={Boolean(hasModelChanges)} />
                <Button
                  className="h-10 rounded-lg bg-accent px-4 text-white hover:bg-accent-hover"
                  disabled={isLoading || !settings || !hasModelChanges || modelSaveStatus === "saving"}
                  onClick={() => void saveModelSettings()}
                >
                  <Save size={15} />
                  {modelSaveStatus === "saving" ? "Saving" : "Save models"}
                </Button>
              </div>
            </div>
          </div>
        </PanelBlock>
      </div>
    </section>
  );
}

function PanelBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-black/16 p-4">
      <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-white">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-white/58">
          <Icon size={16} />
        </span>
        {title}
      </div>
      {children}
    </section>
  );
}

function ModelSelector({
  label,
  value,
  models,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  models: BrowserModelCatalogEntry[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = models.find((model) => model.modelAlias === value);

  return (
    <label className="grid gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/38">{label}</span>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-center">
        <div className="flex min-h-11 items-center gap-3 rounded-lg border border-white/[0.08] bg-black/20 px-3">
          {selected ? (
            <img src={selected.providerLogoPath} alt="" className="h-6 w-6 rounded-md bg-white object-contain p-1" />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-white">
              {selected?.displayLabel ?? "Select a model"}
            </span>
            <span className="block truncate text-[11px] font-medium text-white/36">
              {selected?.providerLabel ?? "No model selected"}
            </span>
          </span>
        </div>
        <select
          className="h-11 rounded-lg border border-white/[0.08] bg-black/40 px-3 text-[13px] font-medium text-white outline-none transition focus:border-accent/70"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {models.map((model) => (
            <option key={model.modelAlias} value={model.modelAlias}>
              {model.providerLabel} - {model.displayLabel}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function ModelCredentialAdvisory({
  model,
  credentialMode,
  savedProviderKeys,
}: {
  model?: BrowserModelCatalogEntry;
  credentialMode: "env-or-user" | "user-required" | "env-only";
  savedProviderKeys: ProviderKeyMetadata[];
}) {
  if (!model) return null;

  const savedKey = model.providerKeyId
    ? savedProviderKeys.find(
        (key) => key.provider_id === model.providerKeyId && key.status === "active",
      )
    : null;
  const keyState = model.providerKeyId
    ? savedKey ? `Saved ${savedKey.key_hint ?? "Configured"}` : "No saved provider key"
    : "Settings BYOK is not supported for this provider";
  const message =
    credentialMode === "env-only"
      ? "Settings keys remain saved, but gateway runtime uses administrator/environment credentials."
      : credentialMode === "user-required"
        ? model.providerKeyId
          ? savedKey
            ? "A saved provider key is available for required-key mode when runtime enforcement is enabled."
            : `This selected model needs a saved ${model.providerLabel} key before runtime enforcement is enabled.`
          : "This provider cannot satisfy required-key mode through Settings."
        : model.providerKeyId
          ? "A saved user key will be used when available after runtime enforcement; otherwise gateway environment credentials may be used."
          : "This model uses gateway environment configuration because it has no Settings provider-key mapping.";

  return (
    <div className="-mt-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[11px] font-medium text-white/44">
      <span className="text-white/68">{model.providerLabel}: {keyState}.</span>{" "}{message}
    </div>
  );
}

function GatewayBadge({ gateway, loading }: { gateway: GatewayStatus | null; loading: boolean }) {
  const label = loading
    ? "Loading"
    : gateway?.status === "configured"
      ? "Gateway configured"
      : gateway?.status === "error"
        ? "Gateway needs setup"
        : "Gateway disabled";

  return (
    <span
      className={cn(
        "inline-flex h-8 w-fit items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold",
        gateway?.status === "configured"
          ? "border-accent/45 bg-accent/12 text-blue-100"
          : gateway?.status === "error"
            ? "border-red-400/30 bg-red-500/10 text-red-100"
            : "border-white/[0.1] bg-white/[0.045] text-white/50",
      )}
    >
      {gateway?.status === "configured" ? <CheckCircle2 size={14} /> : <Server size={14} />}
      {label}
    </span>
  );
}

function StatusLine({ status, message }: { status: StatusTone; message: string }) {
  const statusClassName =
    status === "passed"
      ? "border-accent/45 bg-accent/12 text-blue-100"
      : status === "failed"
        ? "border-red-400/30 bg-red-500/10 text-red-100"
        : status === "checking"
          ? "border-white/[0.14] bg-white/[0.07] text-white/72"
          : "border-white/[0.08] bg-white/[0.035] text-white/44";

  return (
    <div className={cn("flex min-h-10 items-center gap-3 rounded-lg border px-3 text-[13px] font-medium", statusClassName)}>
      {status === "passed" ? (
        <CheckCircle2 size={15} className="shrink-0 text-accent" />
      ) : status === "failed" ? (
        <XCircle size={15} className="shrink-0 text-red-200" />
      ) : status === "checking" ? (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/24 border-t-white/80" />
      ) : (
        <LockKeyhole size={15} className="shrink-0 text-white/34" />
      )}
      <span>{message}</span>
    </div>
  );
}

function StatusText({
  status,
  hasChanges,
}: {
  status: "idle" | "saving" | "saved" | "failed";
  hasChanges: boolean;
}) {
  const text =
    status === "saving"
      ? "Saving model settings."
      : status === "saved"
        ? "Model settings saved."
        : status === "failed"
          ? "Could not save model settings."
          : hasChanges
            ? "Unsaved model changes."
            : "Model settings saved.";

  return <p className="m-0 text-[12px] font-medium text-white/42">{text}</p>;
}

function gatewayMessage(gateway: GatewayStatus | null) {
  if (!gateway) return "Loading gateway status.";
  if (gateway.status === "configured") return "Server-side model gateway is reachable for settings.";
  if (gateway.status === "error") return gateway.issues[0]?.message ?? "Gateway needs setup.";
  return "Gateway is disabled. Direct Gemini runtime remains available.";
}
