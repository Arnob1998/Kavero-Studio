import { useState, useCallback, useRef, useEffect } from "react";
import type { Design, Template, Page } from "@/modules/canvas/types/editor-types";
import * as designsRepository from "@/modules/canvas/persistence/designs-repository";
import { deleteCanvasDraftsForDesign, getCanvasDraft, markCanvasDraftSynced } from "@/modules/canvas/state/drafts";

const CLOUD_SAVE_DEBOUNCE_MS = 10000;

function toCanvasFeedbackMessage(message: string) {
  const designLimit = message.match(/Canvas design limit reached \((\d+)\)/i);
  if (designLimit) {
    return `Canvas limit reached. You can keep up to ${designLimit[1]} designs. Delete an old design to create a new one.`;
  }

  const pageLimit = message.match(/Canvas page limit reached \((\d+)\)/i);
  if (pageLimit) {
    return `Page limit reached. This design can have up to ${pageLimit[1]} pages. Delete a page before adding another.`;
  }

  return message;
}

function isHandledCanvasLimitMessage(message: string) {
  return /Canvas (design|page) limit reached \(\d+\)/i.test(message);
}

export function useDesigns(
  getCanvasJSONForPage: (pageId: string) => string,
  enabled = true,
  getCanvasSize?: () => { width: number; height: number },
  onError?: (message: string) => void,
) {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeDesign, setActiveDesign] = useState<Design | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activePageIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportError = useCallback(
    (message: string) => {
      const feedbackMessage = toCanvasFeedbackMessage(message);
      setError(feedbackMessage);
      onError?.(feedbackMessage);
    },
    [onError],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        setError(null);
        const [d, t] = await Promise.all([
          designsRepository.listDesigns(),
          designsRepository.listTemplates(),
        ]);
        setDesigns(d);
        setTemplates(t);
      } catch (e) {
        console.error("Failed to load data:", e);
        reportError("Unable to load canvas data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [enabled, reportError]);

  const updatePageDraft = useCallback((pageId: string, canvasJson: string) => {
    setPages((prev) => prev.map((page) => (page.id === pageId ? { ...page, canvas_json: canvasJson } : page)));
  }, []);

  const saveDesign = useCallback(async () => {
    if (!activeIdRef.current) return;
    setSaving(true);
    try {
      setError(null);
      const currentDesignId = activeIdRef.current;
      const currentPages = pages;

      for (const page of currentPages) {
        const json = getCanvasJSONForPage(page.id);
        if (json && json !== "{}") {
          const updatedPage = await designsRepository.updatePage(page.id, {
            canvas_json: json,
          });
          setPages((prev) => prev.map((p) => (p.id === updatedPage.id ? updatedPage : p)));
          void markCanvasDraftSynced(currentDesignId, page.id);
        }
      }

      const firstPageJson = currentPages.length > 0 ? getCanvasJSONForPage(currentPages[0].id) : "{}";
      const size = getCanvasSize?.();
      const updated = await designsRepository.updateDesign(currentDesignId, {
        canvas_json: firstPageJson,
        ...(size ? { width: size.width, height: size.height } : {}),
      });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActiveDesign(updated);
    } catch (e) {
      console.error("Failed to save:", e);
      reportError(e instanceof Error ? e.message : "Unable to sync canvas changes.");
    } finally {
      setSaving(false);
    }
  }, [getCanvasJSONForPage, getCanvasSize, pages, reportError]);

  const createDesign = useCallback(async (): Promise<string | undefined> => {
    try {
      setError(null);
      const d = await designsRepository.createDesign({
        name: "Untitled Design",
        canvas_json: "{}",
      });
      setDesigns((prev) => [d, ...prev]);
      setActiveDesign(d);
      activeIdRef.current = d.id;
      return d.id;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to create design.";
      if (!isHandledCanvasLimitMessage(message)) console.error("Failed to create design:", e);
      reportError(message);
    }
  }, [reportError]);

  const createFromTemplate = useCallback(async (template: Template): Promise<string | undefined> => {
    try {
      setError(null);
      const d = await designsRepository.createDesign({
        name: template.name,
        canvas_json: template.canvas_json,
        width: template.width,
        height: template.height,
      });
      setDesigns((prev) => [d, ...prev]);
      return d.id;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to create design from template.";
      if (!isHandledCanvasLimitMessage(message)) console.error("Failed to create from template:", e);
      reportError(message);
    }
  }, [reportError]);

  const loadDesign = useCallback(async (id: string) => {
    try {
      setError(null);
      const d = await designsRepository.getDesign(id);
      const pagesWithDrafts = await Promise.all(
        d.pages.map(async (page) => {
          const draft = await getCanvasDraft(d.id, page.id).catch(() => undefined);
          if (!draft?.dirty) return page;
          return { ...page, canvas_json: draft.canvasJson };
        }),
      );

      setActiveDesign(d);
      activeIdRef.current = d.id;
      setPages(pagesWithDrafts);
      setActivePageId(pagesWithDrafts[0]?.id ?? null);
    } catch (e) {
      console.error("Failed to load design:", e);
      reportError(e instanceof Error ? e.message : "Unable to load design.");
    }
  }, [reportError]);

  const deleteDesign = useCallback(async (id: string) => {
    try {
      setError(null);
      await designsRepository.deleteDesign(id);
      setDesigns((prev) => prev.filter((d) => d.id !== id));
      void deleteCanvasDraftsForDesign(id);
      if (activeIdRef.current === id) {
        setActiveDesign(null);
        activeIdRef.current = null;
      }
    } catch (e) {
      console.error("Failed to delete:", e);
      reportError(e instanceof Error ? e.message : "Unable to delete design.");
    }
  }, [reportError]);

  const renameDesign = useCallback(async (id: string, name: string) => {
    try {
      setError(null);
      const updated = await designsRepository.updateDesign(id, { name });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      if (activeIdRef.current === id) setActiveDesign(updated);
    } catch (e) {
      console.error("Failed to rename:", e);
      reportError(e instanceof Error ? e.message : "Unable to rename design.");
    }
  }, [reportError]);

  const addPage = useCallback(async (afterPageId?: string) => {
    if (!activeIdRef.current) return;
    try {
      setError(null);
      const body: designsRepository.CreatePageInput = {};
      if (afterPageId) {
        const afterPage = pages.find((p) => p.id === afterPageId);
        if (afterPage) body.after_sort_order = afterPage.sort_order;
      }
      const page = await designsRepository.createPage(activeIdRef.current, body);
      const d = await designsRepository.getDesign(activeIdRef.current);
      setPages(d.pages);
      setActivePageId(page.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to add page.";
      if (!isHandledCanvasLimitMessage(message)) console.error("Failed to add page:", e);
      reportError(message);
    }
  }, [pages, reportError]);

  const duplicatePage = useCallback(
    async (pageId: string) => {
      const json = getCanvasJSONForPage(pageId);
      if (json && json !== "{}") {
        try {
          await designsRepository.updatePage(pageId, { canvas_json: json });
          if (activeIdRef.current) void markCanvasDraftSynced(activeIdRef.current, pageId);
        } catch {
          // Keep the local draft dirty if the best-effort pre-save fails.
        }
      }
      try {
        setError(null);
        const page = await designsRepository.duplicatePage(pageId);
        if (activeIdRef.current) {
          const d = await designsRepository.getDesign(activeIdRef.current);
          setPages(d.pages);
        }
        setActivePageId(page.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unable to duplicate page.";
        if (!isHandledCanvasLimitMessage(message)) console.error("Failed to duplicate page:", e);
        reportError(message);
      }
    },
    [getCanvasJSONForPage, reportError],
  );

  const deletePage = useCallback(
    async (pageId: string) => {
      try {
        setError(null);
        await designsRepository.deletePage(pageId);
        const remaining = pages.filter((p) => p.id !== pageId);
        setPages(remaining);
        if (activePageIdRef.current === pageId) {
          setActivePageId(remaining[0]?.id ?? null);
        }
      } catch (e) {
        console.error("Failed to delete page:", e);
        reportError(e instanceof Error ? e.message : "Unable to delete page.");
      }
    },
    [pages, reportError],
  );

  const renamePage = useCallback(async (pageId: string, title: string) => {
    try {
      setError(null);
      const updated = await designsRepository.updatePage(pageId, { title });
      setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      console.error("Failed to rename page:", e);
      reportError(e instanceof Error ? e.message : "Unable to rename page.");
    }
  }, [reportError]);

  const switchToPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const activePage = pages.find((p) => p.id === activePageId) ?? null;

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveDesign(), CLOUD_SAVE_DEBOUNCE_MS);
  }, [saveDesign]);

  return {
    designs,
    templates,
    activeDesign,
    setActiveDesign,
    activeIdRef,
    loading,
    saving,
    error,
    clearError,
    createDesign,
    createFromTemplate,
    loadDesign,
    saveDesign,
    deleteDesign,
    renameDesign,
    scheduleSave,
    updatePageDraft,
    pages,
    activePageId,
    activePage,
    addPage,
    duplicatePage,
    deletePage,
    renamePage,
    switchToPage,
  };
}
