"use client";

import { EditorContext } from "@/modules/canvas/state/context";
import { useCanvasState } from "@/modules/canvas/hooks/use-canvas";
import { useDesigns } from "@/modules/canvas/hooks/use-designs";
import { useRouter } from "@/modules/canvas/hooks/use-router";
import { Editor } from "@/modules/canvas/components/editor";
import { Home } from "@/modules/canvas/components/home";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveCanvasDraft } from "@/modules/canvas/state/drafts";
import { LockKeyhole, Sparkles } from "lucide-react";
import { canvasToolSuccess, type CanvasToolName } from "@/modules/canvas/actions/canvas-tool-registry";
import { getCanvasAccessPolicyDecision } from "@/modules/canvas/utils/canvas-access-policy";
import type { DeploymentProfile } from "@/lib/deployment-profile";

interface ClientAppProps {
  initialDesignId?: string | null;
}

type CanvasAccessStatus = {
  authenticated: boolean;
  deploymentProfile?: DeploymentProfile;
  plan?: "free" | "premium";
  drive: {
    connected: boolean;
    reconnectRequired: boolean;
  };
};

export function ClientApp({ initialDesignId = null }: ClientAppProps) {
  const { navigate, designId } = useRouter(initialDesignId);
  const [editorError, setEditorError] = useState<string | null>(null);
  const activeDesignIdRef = useRef<string | null>(null);
  const canvasSizeRef = useRef({ width: 1080, height: 1080 });
  const scheduleCloudSaveRef = useRef<() => void>(() => {});
  const updatePageDraftRef = useRef<(pageId: string, canvasJson: string) => void>(() => {});
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDesignErrorRef = useRef<() => void>(() => {});
  const showError = useCallback((message: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setEditorError(message);
    errorTimerRef.current = setTimeout(() => {
      setEditorError(null);
      clearDesignErrorRef.current();
      errorTimerRef.current = null;
    }, 5200);
  }, []);
  const handleCanvasChange = useCallback(
    (pageId: string, canvasJson: string, meta: { width: number; height: number }) => {
      const activeDesignId = activeDesignIdRef.current;
      if (!activeDesignId || !canvasJson || canvasJson === "{}") return;

      canvasSizeRef.current = meta;
      updatePageDraftRef.current(pageId, canvasJson);
      void saveCanvasDraft({
        designId: activeDesignId,
        pageId,
        canvasJson,
        width: meta.width,
        height: meta.height,
      }).catch((error) => {
        console.error("Unable to save local canvas draft:", error);
        showError("Unable to save local canvas draft in this browser.");
      });
      scheduleCloudSaveRef.current();
    },
    [showError],
  );
  const canvasState = useCanvasState({ onCanvasChange: handleCanvasChange, onError: showError });
  canvasSizeRef.current = {
    width: canvasState.canvasWidth,
    height: canvasState.canvasHeight,
  };
  const [accessStatus, setAccessStatus] = useState<CanvasAccessStatus | null>(null);
  const accessDecision = accessStatus ? getCanvasAccessPolicyDecision(accessStatus) : null;
  const canvasAllowed = accessDecision?.allowed ?? false;
  const designState = useDesigns(
    canvasState.getCanvasJSONForPage,
    Boolean(canvasAllowed),
    () => canvasSizeRef.current,
    showError,
  );

  const clearError = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setEditorError(null);
    clearDesignErrorRef.current();
  }, []);

  useEffect(() => {
    clearDesignErrorRef.current = designState.clearError;
  }, [designState.clearError]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    activeDesignIdRef.current = designState.activeDesign?.id ?? null;
  }, [designState.activeDesign?.id]);

  useEffect(() => {
    scheduleCloudSaveRef.current = designState.scheduleSave;
  }, [designState.scheduleSave]);

  useEffect(() => {
    updatePageDraftRef.current = designState.updatePageDraft;
  }, [designState.updatePageDraft]);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/workspace/status")
      .then((response) => response.json() as Promise<CanvasAccessStatus>)
      .then((status) => {
        if (!cancelled) setAccessStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setAccessStatus({
            authenticated: false,
            drive: { connected: false, reconnectRequired: false },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load Google Fonts
  useEffect(() => {
    void import("webfontloader").then(({ default: WebFont }) => {
      WebFont.load({
        google: {
          families: [
            "Inter:400,500,600,700",
            "Playfair Display:400,500,600,700,800,900",
            "Montserrat:400,500,600,700,800,900",
            "Poppins:400,500,600,700",
            "Roboto:400,500,700",
            "Open Sans:400,600,700",
            "Lora:400,700",
            "Raleway:400,500,600",
            "Source Sans Pro:400,600,700",
            "Merriweather:400,700",
          ],
        },
      });
    });
  }, []);

  // Load design from URL on initial load and when designId changes
  useEffect(() => {
    if (designId && !designState.loading) {
      if (designState.activeDesign?.id !== designId) {
        designState.loadDesign(designId);
      }
    }
  }, [designId, designState.loading]);

  // Sync canvas size to the loaded design's dimensions
  useEffect(() => {
    if (designState.activeDesign) {
      const { width, height } = designState.activeDesign;
      if (width && height && (width !== canvasState.canvasWidth || height !== canvasState.canvasHeight)) {
        canvasState.setCanvasSize(width, height);
      }
    }
  }, [designState.activeDesign]);

  // Auto-activate first page when pages load and canvases are registered
  useEffect(() => {
    if (designState.pages.length > 0 && !canvasState.activeCanvasId) {
      canvasState.setActiveCanvas(designState.pages[0].id);
    }
  }, [designState.pages, canvasState.activeCanvasId]);

  if (!accessStatus || (canvasAllowed && designState.loading)) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <p className="text-text-secondary text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canvasAllowed) {
    const decision = accessDecision ?? getCanvasAccessPolicyDecision(accessStatus);

    return (
      <main className="relative min-h-full overflow-hidden bg-black px-5 py-20 font-sans text-white [isolation:isolate]">
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_42%,rgb(255_255_255_/_0.075),transparent_30%),linear-gradient(90deg,rgb(0_0_0_/_0.94),transparent_38%,transparent_62%,rgb(0_0_0_/_0.92)),linear-gradient(180deg,rgb(0_0_0),rgb(9_9_9)_48%,rgb(0_0_0))]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-35 [background-image:linear-gradient(rgb(255_255_255_/_0.055)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255_/_0.055)_1px,transparent_1px)] [background-size:96px_96px]"
          aria-hidden="true"
        />
        <section className="relative z-10 mx-auto grid min-h-[calc(100svh-10rem)] w-full max-w-[980px] place-items-center text-center">
          <div className="w-[min(560px,calc(100vw-28px))] overflow-hidden rounded-2xl border border-white/[0.11] bg-black/42 text-white shadow-[0_34px_150px_rgb(0_0_0_/_0.72),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-2xl">
            <div className="px-7 py-8">
              <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.055] text-accent shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12)]">
                {accessStatus.authenticated ? <Sparkles size={24} /> : <LockKeyhole size={24} />}
              </div>
              <h1 className="m-0 text-[clamp(34px,6vw,64px)] font-light leading-none tracking-normal text-white">
                {decision.title}
              </h1>
              <p className="mx-auto mt-5 max-w-[46ch] text-[15px] font-semibold leading-7 text-white/56">
                {decision.description}
              </p>
            </div>
            <div className="grid gap-3 border-t border-white/[0.08] bg-black/20 p-4 sm:grid-cols-2">
              <a
                href={decision.actionHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white shadow-[0_16px_44px_rgb(59_130_246_/_0.22)] transition hover:bg-accent-hover"
              >
                {decision.actionLabel}
              </a>
              <a
                href="/generate"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-[14px] font-semibold text-white/66 transition hover:bg-white/[0.08] hover:text-white"
              >
                Generate
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // Home / gallery view
  if (!designId) {
    return (
      <Home
        designs={designState.designs}
        navigate={navigate}
        createDesign={designState.createDesign}
        deleteDesign={designState.deleteDesign}
        renameDesign={designState.renameDesign}
        error={editorError}
        clearError={clearError}
      />
    );
  }

  // Editor view
  const contextValue = {
    ...canvasState,
    ...designState,
    error: editorError ?? designState.error,
    showError,
    clearError,
    getCanvasSceneSnapshot: (options?: { includeHelpers?: boolean }) =>
      canvasState.getCanvasSceneSnapshot({
        designId: designState.activeDesign?.id ?? null,
        includeHelpers: options?.includeHelpers,
      }),
    getCanvasRelationMap: (options?: { includeHelpers?: boolean }) =>
      canvasState.getCanvasRelationMap({
        designId: designState.activeDesign?.id ?? null,
        includeHelpers: options?.includeHelpers,
      }),
    getCanvasVisualPreview: canvasState.getCanvasVisualPreview,
    executeCanvasTool: async (name: CanvasToolName, input?: unknown) => {
      if (name === "save") {
        await designState.saveDesign();
        return canvasToolSuccess("save", "Saved the current design.");
      }
      return canvasState.executeCanvasTool(name, input);
    },
    // activeCanvasId is the source of truth for which page is active
    activePageId: canvasState.activeCanvasId ?? designState.activePageId,
    navigate,
  };

  return (
    <EditorContext.Provider value={contextValue}>
      <Editor />
    </EditorContext.Provider>
  );
}
