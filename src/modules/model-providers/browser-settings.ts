"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrowserModelCatalogEntry } from "./browser-catalog";
import type { ModelAvailabilitySource, ModelUnavailableReason } from "./server/model-availability";
import type { ModelCapabilitySlot } from "./types";

export const modelProviderSettingsChangedEvent = "kavero:model-provider-settings-changed";

export type BrowserAvailableModelCatalogEntry = BrowserModelCatalogEntry & {
  availability: {
    active: boolean;
    source: ModelAvailabilitySource;
    reason: ModelUnavailableReason;
    message: string | null;
  };
};

export type BrowserModelProviderSettings = {
  gateway: {
    status: "disabled" | "configured" | "error";
    gateway: "litellm" | null;
    configured: boolean;
    issues: Array<{ code: string; message: string }>;
  };
  credentialMode: "env-or-user" | "user-required" | "env-only";
  catalog: BrowserAvailableModelCatalogEntry[];
  selected: {
    chatOrchestrationModelAlias: string;
    imageGenerationModelAlias: string;
  };
};

export function useModelProviderSettings() {
  const [settings, setSettings] = useState<BrowserModelProviderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/model-providers", { cache: "no-store" });
      if (!response.ok) throw new Error("Model settings could not be loaded.");
      const payload = (await response.json()) as BrowserModelProviderSettings;
      setSettings(payload);
      setError(null);
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Model settings could not be loaded.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<BrowserModelProviderSettings>).detail;
      if (detail?.selected && Array.isArray(detail.catalog)) setSettings(detail);
      else void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(modelProviderSettingsChangedEvent, onChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(modelProviderSettingsChangedEvent, onChanged);
    };
  }, [refresh]);

  const saveSelection = useCallback(async (selection: Partial<BrowserModelProviderSettings["selected"]>) => {
    if (!settings) return { ok: false as const, message: "Model settings are still loading." };
    const response = await fetch("/api/model-providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Send only the slot that changed. The server merges it with the latest saved
      // preferences, so overlapping image/chat saves cannot revert one another.
      body: JSON.stringify(selection),
    });
    const payload = (await response.json().catch(() => null)) as (BrowserModelProviderSettings & { error?: string }) | null;
    if (!response.ok || !payload?.selected) {
      return { ok: false as const, message: payload?.error ?? "Could not save model settings." };
    }
    setSettings(payload);
    setError(null);
    window.dispatchEvent(new CustomEvent(modelProviderSettingsChangedEvent, { detail: payload }));
    return { ok: true as const, settings: payload };
  }, [settings]);

  const activeModels = useCallback((slot: ModelCapabilitySlot) => (
    settings?.catalog?.filter((model) =>
      model.availability.active && model.capabilities.slots.includes(slot),
    ) ?? []
  ), [settings]);

  return useMemo(() => ({ settings, loading, error, refresh, saveSelection, activeModels }), [activeModels, error, loading, refresh, saveSelection, settings]);
}
