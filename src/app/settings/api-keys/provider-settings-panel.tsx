"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Provider = {
  id: string;
  name: string;
  label: string;
  status: "available" | "coming-soon";
  logo: string;
};

const providers: Provider[] = [
  {
    id: "google-gemini",
    name: "Google Gemini",
    label: "Available",
    status: "available",
    logo: "/llm-providers/google-gemini-icon.png",
  },
  {
    id: "openai",
    name: "OpenAI",
    label: "Coming later",
    status: "coming-soon",
    logo: "/llm-providers/openai.png",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    label: "Coming later",
    status: "coming-soon",
    logo: "/llm-providers/claude-ai-icon.png",
  },
  {
    id: "xai",
    name: "xAI Grok",
    label: "Coming later",
    status: "coming-soon",
    logo: "/llm-providers/grok-icon.png",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    label: "Coming later",
    status: "coming-soon",
    logo: "/llm-providers/huggingface-icon.png",
  },
];

const availableProvider = providers[0];
const minimumGeminiKeyLength = 30;

export function ProviderSettingsPanel() {
  const [search, setSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(availableProvider);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [checkStatus, setCheckStatus] = useState<"idle" | "checking" | "passed" | "failed">(
    "idle",
  );
  const [checkMessage, setCheckMessage] = useState("Paste a complete Gemini API key to test it.");
  const [savedKeyHint, setSavedKeyHint] = useState<string | null>(null);
  const [isProviderLoading, setIsProviderLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const lastCheckedKeyRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? providers.filter((provider) => provider.name.toLowerCase().includes(query))
      : providers;
  }, [search]);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedProvider() {
      try {
        const response = await fetch("/api/provider-keys");
        if (!response.ok) return;

        const payload = (await response.json()) as {
          providerKeys?: Array<{
            provider_id: string;
            key_hint: string | null;
            status: "active" | "disabled";
            updated_at: string;
          }>;
        };
        const geminiKey = payload.providerKeys?.find(
          (providerKey) => providerKey.provider_id === "google-gemini",
        );

        if (isMounted && geminiKey?.status === "active") {
          const keyHint = geminiKey.key_hint ?? "saved";
          setSavedKeyHint(keyHint);
          setCheckStatus("passed");
          setCheckMessage(`Gemini is connected with key ${keyHint}.`);
        }
      } catch {
        if (isMounted) {
          setSaveStatus("failed");
        }
      } finally {
        if (isMounted) {
          setIsProviderLoading(false);
        }
      }
    }

    void loadSavedProvider();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isProviderLoading) return;

    const key = apiKey.trim();

    abortControllerRef.current?.abort();

    if (!key) {
      setCheckStatus(savedKeyHint ? "passed" : "idle");
      setCheckMessage(
        savedKeyHint
          ? `Saved key ${savedKeyHint} is connected. Paste a new key to replace it.`
          : "Paste a complete Gemini API key to test it.",
      );
      return;
    }

    if (key.length < minimumGeminiKeyLength) {
      setCheckStatus("idle");
      setCheckMessage("Waiting for the full key.");
      return;
    }

    if (lastCheckedKeyRef.current === key) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setCheckStatus("checking");
      setCheckMessage("Checking key...");

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted) {
          return;
        }

        lastCheckedKeyRef.current = key;

        if (response.ok) {
          setCheckStatus("passed");
          setCheckMessage("Check passed. This key is ready to save.");
          return;
        }

        setCheckStatus("failed");
        setCheckMessage("Check failed. Confirm the key is active and try again.");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setCheckStatus("failed");
        setCheckMessage("Check failed. Confirm the key is active and try again.");
      }
    }, 900);

    return () => {
      window.clearTimeout(timeout);
      abortControllerRef.current?.abort();
    };
  }, [apiKey, isProviderLoading, savedKeyHint]);

  async function saveProvider() {
    if (checkStatus !== "passed" || !apiKey.trim()) return;

    setSaveStatus("saving");

    const response = await fetch("/api/provider-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "google-gemini",
        apiKey,
      }),
    });

    if (!response.ok) {
      setSaveStatus("failed");
      return;
    }

    const payload = (await response.json()) as {
      providerKey?: { keyHint?: string };
    };

    setSavedKeyHint(payload.providerKey?.keyHint ?? null);
    setApiKey("");
    setSaveStatus("saved");
    setCheckStatus("passed");
    setCheckMessage(
      payload.providerKey?.keyHint
        ? `Saved key ${payload.providerKey.keyHint} is connected.`
        : "Provider saved.",
    );
  }

  return (
    <section
      className="relative grid min-h-[620px] overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl lg:grid-cols-[300px_minmax(0,1fr)]"
      aria-busy={isProviderLoading}
    >
      <aside className="border-b border-white/[0.08] bg-black/22 lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center gap-3 border-b border-white/[0.08] px-4">
          <Search size={16} className="text-white/36" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white outline-none placeholder:text-white/34"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search providers..."
            disabled={isProviderLoading}
          />
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-white/42 transition hover:bg-white/[0.07] hover:text-white"
            type="button"
            aria-label="Provider options"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="p-3">
          <div className="mb-3 flex h-10 items-center gap-3 px-2 text-[13px] font-medium text-white/72">
            <Server size={16} className="text-white/42" />
            All providers
          </div>

          <div className="mb-2 flex items-center gap-1 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-white/34">
            Available
            <ChevronDown size={12} />
          </div>

          <div className="grid gap-1">
            {filteredProviders.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                selected={selectedProvider.id === provider.id}
                savedKeyHint={provider.id === "google-gemini" ? savedKeyHint : null}
                onSelect={() => {
                  if (isProviderLoading) return;
                  if (provider.status === "available") {
                    setSelectedProvider(provider);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </aside>

      <div className="min-w-0 p-5 sm:p-7 lg:p-8">
        <div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <img src="/llm-providers/google.svg" alt="Google" className="h-7 w-auto" />
            <span className="h-5 w-px bg-white/[0.14]" aria-hidden="true" />
            <img
              src="/llm-providers/google-gemini-icon.png"
              alt=""
              className="h-8 w-8 rounded-lg bg-white object-contain p-1"
              aria-hidden="true"
            />
            <span className="text-[26px] font-medium leading-none text-white">Gemini</span>
            {savedKeyHint ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/12 px-3 text-[12px] font-medium text-blue-100">
                <ShieldCheck size={14} className="text-accent" />
                Connected
              </span>
            ) : null}
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.08] text-[12px] font-semibold text-white/44">
              ?
            </span>
          </div>

          <ProviderToggle checked />
        </div>

        <div className="grid gap-7">
          <ProviderField
            icon={KeyRound}
            label="API Key"
            description="Enter your Google Gemini API key."
          >
            <div className="relative">
              <input
                className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.065] px-4 pr-12 text-[14px] font-medium text-white outline-none transition placeholder:text-white/28 focus:border-accent/70"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type={showKey ? "text" : "password"}
                disabled={isProviderLoading}
                placeholder={
                  savedKeyHint ? `Saved ${savedKeyHint}. Paste a new key to replace it.` : "Paste your Gemini API key"
                }
              />
              <button
                className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-white/34 transition hover:bg-white/[0.08] hover:text-white"
                type="button"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                disabled={isProviderLoading}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </ProviderField>

          <ProviderField
            icon={CheckCircle2}
            label="Connectivity Check"
            description="Runs automatically after a complete key is entered."
          >
            <ConnectivityStatus status={checkStatus} message={checkMessage} />
          </ProviderField>
        </div>

        <div className="mt-9 flex flex-col gap-3 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 inline-flex items-center gap-2 text-[12px] font-medium text-white/42">
            <LockKeyhole size={14} />
            {saveStatus === "failed"
              ? "Could not save. Try again."
              : savedKeyHint
                ? `Gemini key saved ${savedKeyHint}`
                : "Keys are hidden after saving."}
          </p>
          <Button
            className="h-11 rounded-xl bg-accent px-5 text-white hover:bg-accent-hover"
            disabled={isProviderLoading || checkStatus !== "passed" || !apiKey.trim() || saveStatus === "saving"}
            onClick={() => void saveProvider()}
          >
            {saveStatus === "saving" ? "Saving..." : savedKeyHint ? "Update provider" : "Save provider"}
          </Button>
        </div>
      </div>
      {isProviderLoading ? <ProviderLoadingOverlay /> : null}
    </section>
  );
}

function ProviderLoadingOverlay() {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/38 px-6 backdrop-blur-md">
      <div className="w-full max-w-[520px] rounded-2xl border border-white/[0.11] bg-black/58 p-5 shadow-[0_24px_90px_rgb(0_0_0_/_0.42)]">
        <div className="mb-5 flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-2xl border border-accent/25 bg-accent/10">
            <span className="absolute inset-1 rounded-xl border border-accent/20" />
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
          </span>
          <span>
            <span className="block text-[13px] font-semibold text-white">Loading providers</span>
            <span className="mt-1 block text-[11px] font-medium text-white/42">
              Checking saved keys before enabling controls.
            </span>
          </span>
        </div>
        <div className="grid gap-3">
          {[0, 1, 2].map((item) => (
            <span
              key={item}
              className="h-12 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.045] before:block before:h-full before:w-1/2 before:animate-[provider-shimmer_1.35s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.12] before:to-transparent"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectivityStatus({
  status,
  message,
}: {
  status: "idle" | "checking" | "passed" | "failed";
  message: string;
}) {
  const statusClassName =
    status === "passed"
      ? "border-accent/60 bg-accent/12 text-blue-100"
      : status === "failed"
        ? "border-red-400/30 bg-red-500/10 text-red-100"
        : status === "checking"
          ? "border-white/[0.14] bg-white/[0.07] text-white/72"
          : "border-white/[0.1] bg-white/[0.045] text-white/44";

  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-xl border px-4 text-[13px] font-medium",
        statusClassName,
      )}
    >
      {status === "passed" ? (
        <CheckCircle2 size={16} className="shrink-0 text-accent" />
      ) : status === "failed" ? (
        <XCircle size={16} className="shrink-0 text-red-200" />
      ) : status === "checking" ? (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/24 border-t-white/80" />
      ) : (
        <LockKeyhole size={16} className="shrink-0 text-white/34" />
      )}
      <span>{message}</span>
    </div>
  );
}

function ProviderRow({
  provider,
  selected,
  savedKeyHint,
  onSelect,
}: {
  provider: Provider;
  selected: boolean;
  savedKeyHint?: string | null;
  onSelect: () => void;
}) {
  const isAvailable = provider.status === "available";

  return (
    <button
      className={cn(
        "flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition",
        selected ? "bg-white/[0.1] text-white" : "text-white/58 hover:bg-white/[0.06] hover:text-white",
        !isAvailable && "cursor-not-allowed opacity-55 hover:bg-transparent hover:text-white/58",
      )}
      type="button"
      onClick={onSelect}
      disabled={!isAvailable}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-white">
        <Image src={provider.logo} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{provider.name}</span>
        <span className="block truncate text-[11px] font-medium text-white/34">
          {savedKeyHint ? `Connected ${savedKeyHint}` : provider.label}
        </span>
      </span>
      {savedKeyHint ? (
        <CheckCircle2 size={15} className="text-accent" />
      ) : isAvailable ? (
        <span className="h-2 w-2 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function ProviderField({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: typeof KeyRound;
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.72fr)_minmax(280px,1fr)] lg:items-center">
      <div className="flex gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58">
          <Icon size={16} />
        </div>
        <div>
          <p className="m-0 text-[15px] font-semibold text-white">{label}</p>
          <p className="m-0 mt-1 max-w-[42ch] text-[12px] font-medium leading-5 text-white/42">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ProviderToggle({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={cn(
        "relative h-7 w-12 rounded-full border border-white/[0.12] transition",
        checked ? "bg-white" : "bg-white/[0.08]",
      )}
      type="button"
      onClick={onClick}
      aria-pressed={checked}
    >
      <span
        className={cn(
          "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition",
          checked ? "right-1 bg-black" : "left-1 bg-white/72",
        )}
      />
    </button>
  );
}
