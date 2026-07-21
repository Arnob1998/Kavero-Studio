import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { DragEvent } from "react";
import {
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { editorPanels, getEditorPanel } from "@/modules/editor-panels/panel-registry";
import type {
  AssistantMessage,
  AssistantStatus,
  AssistantToolCall,
  AutoSegmentAsset,
  AutoSegmentCategoryKey,
  AutoSegmentCrop,
  AutoSegmentGroup,
  AutoSegmentPlacement,
  AutoSegmentSource,
  AutoSegmentStatus,
  CanvasImageBackgroundPreference,
  CanvasImageBatchSize,
  CanvasImageGenerationSettings,
  CanvasImageModel,
  CanvasImageQuality,
  CanvasImageThinking,
  EditorPanelId,
  GeneratedCanvasImage,
  PendingAssistantToolCall,
} from "@/modules/editor-panels/types";
import { AutoSegmentPanel } from "@/modules/editor-panels/panels/auto-segment-panel";
import { AssetsPanel } from "@/modules/editor-panels/panels/assets-panel";
import { CopilotPanel } from "@/modules/editor-panels/panels/copilot-panel";
import {
  getCanvasImageControlOptions,
  GeneratePanel,
  labelize,
  SettingsSelect,
} from "@/modules/editor-panels/panels/generate-panel";
import { LayersPanel } from "@/modules/editor-panels/panels/layers-panel";
import { RelationsPanel } from "@/modules/editor-panels/panels/relations-panel";
import { ShapesPanel } from "@/modules/editor-panels/panels/shapes-panel";
import { TextPanel } from "@/modules/editor-panels/panels/text-panel";
import { useEditor } from "@/modules/canvas/state/context";
import { getBrowserImageModelByAlias, getBrowserImageModelByLegacyId, getBrowserImageModels, normalizeBrowserImageUiSettings } from "@/modules/model-providers/image-browser";
import { modelProviderSettingsChangedEvent, useModelProviderSettings } from "@/modules/model-providers/browser-settings";
import { uploadCanvasAsset, type CanvasAsset, type CanvasAssetsResponse } from "@/modules/assets/canvas-assets";
import {
  CANVAS_TOOL_REGISTRY,
  canvasToolFailure,
  canvasToolSuccess,
  type CanvasToolName,
  type CanvasToolResult,
  type CanvasToolRisk,
} from "@/modules/canvas/actions/canvas-tool-registry";

type CanvasAssistantApiResponse = {
  ok: boolean;
  provider: string;
  model: string;
  message: AssistantMessage | null;
  proposedBundle?: AssistantActionBundle | null;
  toolCalls: Array<{
    id: string;
    name: CanvasToolName;
    input: Record<string, unknown>;
    riskLevel: CanvasToolRisk;
    status: "ready" | "requires_confirmation" | "approved" | "rejected";
    errors: string[];
    summary: string;
  }>;
  errors: string[];
  requestsFeedback?: boolean;
};

type AssistantActionBundle = {
  id: string;
  summary: string;
  riskLevel: CanvasToolRisk;
  actions: Array<{
    id: string;
    name: CanvasToolName;
    input: Record<string, unknown>;
    riskLevel: CanvasToolRisk;
    status: "ready" | "requires_confirmation" | "approved" | "rejected";
    errors: string[];
    summary: string;
  }>;
};

type AutoSegmentApiSegment = {
  id: string;
  label: string;
  category: AutoSegmentCategoryKey;
  confidence?: number;
  status?: "ready" | "failed";
  error?: string;
  image?: {
    dataUrl: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };
};

type AutoSegmentApiResponse = {
  sessionId?: string;
  categories?: Array<{
    key: AutoSegmentCategoryKey;
    label: string;
    segments: AutoSegmentApiSegment[];
  }>;
  warnings?: string[];
  error?: string;
};

const autoSegmentCategoryLabels: Record<AutoSegmentCategoryKey, string> = {
  background: "Background",
  people: "People",
  products: "Products",
  objects: "Objects",
  text_graphics: "Text & Graphics",
  other: "Other",
};

const defaultCanvasImageModel = getBrowserImageModels("canvas-generation")[0];

const defaultCanvasImageSettings: CanvasImageGenerationSettings = {
  enabled: true,
  modelAlias: defaultCanvasImageModel.modelAlias,
  model: defaultCanvasImageModel.legacyModelId as CanvasImageModel,
  batchSize: defaultCanvasImageModel.featureCountPresets["canvas-generation"][0] as CanvasImageBatchSize,
  thinking: (defaultCanvasImageModel.reasoning.default ?? "balanced") as CanvasImageThinking,
  aspectRatio: defaultCanvasImageModel.size.defaultAspectRatio,
  imageSize: defaultCanvasImageModel.size.defaultSize as CanvasImageQuality,
  quality: (defaultCanvasImageModel.quality.default ?? "auto") as CanvasImageGenerationSettings["quality"],
  background: defaultCanvasImageModel.background.default,
  transparentBackgroundDefault: true,
};

function switchCanvasImageModel(current: CanvasImageGenerationSettings, model: CanvasImageModel): CanvasImageGenerationSettings {
  const selected = getBrowserImageModelByLegacyId(model);
  const normalized = normalizeBrowserImageUiSettings({
    model: current.model,
    count: current.batchSize,
    aspectRatio: current.aspectRatio,
    imageSize: current.imageSize,
    reasoning: current.thinking,
    quality: current.quality,
    background: current.background,
  }, model, "canvas-generation");
  return {
    ...current,
    modelAlias: selected?.modelAlias ?? current.modelAlias,
    model: normalized.model as CanvasImageModel,
    batchSize: normalized.count as CanvasImageBatchSize,
    aspectRatio: normalized.aspectRatio,
    imageSize: normalized.imageSize as CanvasImageQuality,
    thinking: normalized.reasoning as CanvasImageThinking,
    quality: (normalized.quality ?? "auto") as CanvasImageGenerationSettings["quality"],
    background: normalized.background ?? "auto",
  };
}

export function LeftSidebar() {
  const modelProvider = useModelProviderSettings();
  const {
    addText,
    addShape,
    addImage,
    showError,
    layers,
    selectedObject,
    selectLayer,
    moveLayerToLevel,
    getCanvasRelationMap,
    getCanvasSceneSnapshot,
    getCanvasVisualPreview,
    executeCanvasTool,
  } = useEditor();
  const [activeSection, setActiveSection] = useState<EditorPanelId | null>("shapes");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [autoSegmentSource, setAutoSegmentSource] = useState<AutoSegmentSource | null>(null);
  const [autoSegmentStatus, setAutoSegmentStatus] = useState<AutoSegmentStatus>("idle");
  const [autoSegmentGroups, setAutoSegmentGroups] = useState<AutoSegmentGroup[]>([]);
  const [autoSegmentError, setAutoSegmentError] = useState<string | null>(null);
  const [autoSegmentWarnings, setAutoSegmentWarnings] = useState<string[]>([]);
  const [autoSegmentUploadProgress, setAutoSegmentUploadProgress] = useState(0);
  const [autoSegmentAddingAll, setAutoSegmentAddingAll] = useState(false);
  const [autoSegmentSourcePlacement, setAutoSegmentSourcePlacement] = useState<AutoSegmentPlacement | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [generatedImages, setGeneratedImages] = useState<GeneratedCanvasImage[]>([]);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [imageGenerationWarnings, setImageGenerationWarnings] = useState<string[]>([]);
  const [imageGenerationSettings, setImageGenerationSettings] = useState<CanvasImageGenerationSettings>(defaultCanvasImageSettings);
  const activeCanvasImageModels = modelProvider.activeModels("imageGeneration")
    .map((model) => getBrowserImageModelByAlias(model.modelAlias))
    .filter((model): model is NonNullable<typeof model> => Boolean(model))
    .filter((model) => model.compatibility["canvas-generation"]);
  const activeCanvasImageOptions = activeCanvasImageModels.map((model) => ({ value: model.legacyModelId as CanvasImageModel, label: model.displayLabel }));
  const activeChatModels = modelProvider.activeModels("chatOrchestration");
  const selectedChatModel = activeChatModels.find((model) => model.modelAlias === modelProvider.settings?.selected?.chatOrchestrationModelAlias);
  const chatControls = selectedChatModel?.capabilities.chatControls;
  const canvasImageControls = getCanvasImageControlOptions(imageGenerationSettings.model);
  const [imageTransparent, setImageTransparent] = useState(defaultCanvasImageSettings.transparentBackgroundDefault);
  const [addingGeneratedImageId, setAddingGeneratedImageId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dropLevel, setDropLevel] = useState<number | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content: "Hey! What would you like to create or change? I can add elements, edit styles, move things around, and more.",
    },
  ]);
  const [assistantToolCalls, setAssistantToolCalls] = useState<AssistantToolCall[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>(null);
  const [assistantAutoApply, setAssistantAutoApply] = useState(false);
  const [assistantTemperature, setAssistantTemperature] = useState(0.2);
  const [assistantThinking, setAssistantThinking] = useState(true);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantSettingsTab, setAssistantSettingsTab] = useState<"general" | "model" | "tools">("general");
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantStoppedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSegmentFileInputRef = useRef<HTMLInputElement>(null);
  const selectedLayerId = selectedObject ? String((selectedObject as any).kaveroId ?? "") : null;
  const selectedImageSource = useMemo(() => getAutoSegmentSourceFromObject(selectedObject), [selectedObject]);
  const relationMap = activeSection === "relations" ? getCanvasRelationMap() : null;
  const assistantSceneSnapshot = activeSection === "copilot" ? getCanvasSceneSnapshot() : null;
  const assistantRelationMap = activeSection === "copilot" ? getCanvasRelationMap() : null;
  const assistantVisualPreview = activeSection === "copilot" ? safeGetVisualPreview(getCanvasVisualPreview) : null;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("kavero:canvas-lock", { detail: { locked: assistantBusy } }));
    return () => {
      window.dispatchEvent(new CustomEvent("kavero:canvas-lock", { detail: { locked: false } }));
    };
  }, [assistantBusy]);

  useEffect(() => {
    const alias = modelProvider.settings?.selected?.imageGenerationModelAlias;
    const selected = alias ? getBrowserImageModelByAlias(alias) : null;
    if (!selected || selected.legacyModelId === imageGenerationSettings.model) return;
    setImageGenerationSettings((current) => switchCanvasImageModel(current, selected.legacyModelId as CanvasImageModel));
  }, [imageGenerationSettings.model, modelProvider.settings?.selected?.imageGenerationModelAlias]);

  const stopAssistant = useCallback(() => {
    assistantStoppedRef.current = true;
    try {
      assistantAbortRef.current?.abort("stopped");
    } catch {
      // Abort can throw in some browser/runtime combinations if the signal already settled.
    }
    assistantAbortRef.current = null;
    setAssistantBusy(false);
    setAssistantStatus(null);
    setAssistantError(null);
    setAssistantMessages((current) =>
      compactAssistantHistory([
        ...current,
        { id: createAssistantId("msg"), role: "assistant", content: "Stopped. Canvas editing is unlocked." },
      ]),
    );
  }, []);

  const handleSectionClick = (key: EditorPanelId) => {
    setActiveSection((prev) => (prev === key ? null : key));
  };

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    try {
      const resp = await fetch("/api/canvas/assets", { cache: "no-store" });
      const data = (await resp.json().catch(() => ({}))) as CanvasAssetsResponse;
      if (!resp.ok) throw new Error(data.error ?? "Unable to load uploads.");
      setAssets(data.assets ?? []);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Unable to load uploads.");
    } finally {
      setAssetsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (activeSection === "images") void loadAssets();
  }, [activeSection, loadAssets]);

  useEffect(() => {
    if (activeSection !== "autoSegment") return;
    if (selectedImageSource && !autoSegmentAddingAll && autoSegmentGroups.length === 0) {
      setAutoSegmentSource(selectedImageSource);
      setAutoSegmentSourcePlacement(getAutoSegmentSourcePlacement(selectedObject));
      return;
    }
    if (!autoSegmentSource) setAutoSegmentGroups([]);
  }, [activeSection, autoSegmentAddingAll, autoSegmentGroups.length, autoSegmentSource, selectedImageSource, selectedObject]);

  useEffect(() => {
    const handleAssetUploaded = (event: Event) => {
      const asset = (event as CustomEvent<CanvasAsset>).detail;
      if (!asset?.id) return;
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    };

    window.addEventListener("kavero:canvas-asset-uploaded", handleAssetUploaded);
    return () => window.removeEventListener("kavero:canvas-asset-uploaded", handleAssetUploaded);
  }, []);

  const handleImageUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setUploadProgress(0);
      try {
        const uploadFiles = Array.from(files);
        for (const [index, file] of uploadFiles.entries()) {
          setUploadLabel(uploadFiles.length > 1 ? `Uploading ${index + 1}/${uploadFiles.length}` : "Uploading");
          const asset = await uploadCanvasAsset(file, setUploadProgress);
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
          addImage(asset.public_url);
        }
      } catch (e) {
        console.error("Upload failed:", e);
        showError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
        setUploadProgress(0);
        setUploadLabel("");
      }
    },
    [addImage, showError]
  );

  const handleAutoSegmentUpload = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        showError("Auto Segment supports PNG, JPG, or WebP images.");
        return;
      }
      setAutoSegmentStatus("uploading");
      setAutoSegmentError(null);
      setAutoSegmentUploadProgress(0);
      try {
        const asset = await uploadCanvasAsset(file, setAutoSegmentUploadProgress);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
        setAutoSegmentSource({ assetId: asset.id, assetUrl: asset.public_url, name: asset.original_name });
        setAutoSegmentSourcePlacement(null);
        setAutoSegmentGroups([]);
        setAutoSegmentStatus("idle");
      } catch (error) {
        setAutoSegmentStatus("error");
        setAutoSegmentError(error instanceof Error ? error.message : "Upload failed.");
      } finally {
        setAutoSegmentUploadProgress(0);
      }
    },
    [showError],
  );

  const runAutoSegment = useCallback(async () => {
    if (!autoSegmentSource || autoSegmentStatus === "analyzing" || autoSegmentStatus === "isolating" || autoSegmentStatus === "uploading") return;
      setAutoSegmentStatus("analyzing");
      setAutoSegmentSourcePlacement(getAutoSegmentSourcePlacement(selectedObject) ?? autoSegmentSourcePlacement);
    setAutoSegmentError(null);
    setAutoSegmentWarnings([]);
    setAutoSegmentGroups([]);
    try {
      const response = await fetch("/api/canvas/auto-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: autoSegmentSource.assetId,
          sourceName: autoSegmentSource.name,
          model: imageGenerationSettings.model,
          imageSize: imageGenerationSettings.imageSize,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AutoSegmentApiResponse;
      if (!response.ok) throw new Error(payload.error ?? "Auto Segment failed.");

      setAutoSegmentStatus("isolating");
      const segmentGroups: AutoSegmentGroup[] = [];
      for (const category of payload.categories ?? []) {
        const segments: AutoSegmentAsset[] = [];
        for (const segment of category.segments ?? []) {
          if (!segment.image?.dataUrl) continue;
          const cutout = await createMaskedCutout(autoSegmentSource.assetUrl, segment.image.dataUrl, {
            flatBackgroundCleanup: shouldCleanFlatBackground({
              category: segment.category,
              label: segment.label,
            }),
            crispMask: isTextLikeAutoSegment({
              category: segment.category,
              label: segment.label,
            }),
          }).catch(async () => {
            try {
              const dataUrl = await removeSolidEdgeBackground(segment.image?.dataUrl ?? "");
              return { dataUrl, previewBackground: "#8a8f98", crop: null };
            } catch {
              return { dataUrl: segment.image?.dataUrl ?? "", previewBackground: "#8a8f98", crop: null };
            }
          });
          segments.push({
            id: segment.id,
            label: segment.label,
            category: segment.category,
            dataUrl: cutout.dataUrl,
            mimeType: "image/png",
            previewBackground: cutout.previewBackground,
            crop: cutout.crop,
            confidence: segment.confidence,
          });
        }
        if (segments.length > 0) {
          segmentGroups.push({
            key: category.key,
            label: category.label || autoSegmentCategoryLabels[category.key] || "Other",
            segments,
          });
        }
      }

      setAutoSegmentGroups(segmentGroups);
      setAutoSegmentWarnings(payload.warnings ?? []);
      setAutoSegmentStatus(segmentGroups.length > 0 ? "ready" : "error");
      if (segmentGroups.length === 0) setAutoSegmentError("No usable segments were returned.");
    } catch (error) {
      setAutoSegmentStatus("error");
      setAutoSegmentError(error instanceof Error ? error.message : "Auto Segment failed.");
    }
  }, [autoSegmentSource, autoSegmentSourcePlacement, autoSegmentStatus, imageGenerationSettings.imageSize, imageGenerationSettings.model, selectedObject]);

  const addAutoSegmentToCanvas = useCallback(
    async (segment: AutoSegmentAsset) => {
      try {
        const file = await dataUrlToFile(segment.dataUrl, `segment-${segment.category}-${segment.id}.png`);
        const asset = await uploadCanvasAsset(file);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
        addImage(asset.public_url);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Unable to add segment.");
      }
    },
    [addImage, showError],
  );

  const addAllAutoSegmentsToCanvas = useCallback(async () => {
    const segments = autoSegmentGroups.flatMap((group) => group.segments);
    if (segments.length === 0 || autoSegmentAddingAll) return;
    setAutoSegmentAddingAll(true);
    try {
      const placement = autoSegmentSourcePlacement ?? getAutoSegmentSourcePlacement(selectedObject);
      for (const segment of segments) {
        const file = await dataUrlToFile(segment.dataUrl, `segment-${segment.category}-${segment.id}.png`);
        const asset = await uploadCanvasAsset(file);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));

        const target = placement && segment.crop ? placementFromCrop(segment.crop, placement) : null;
        const addResult = await executeCanvasTool("add_uploaded_image", {
          assetUrl: asset.public_url,
          position: target ? { x: target.centerX, y: target.centerY } : undefined,
        });
        const objectId = addResult.selectedObjectIds?.[0] ?? addResult.changedObjectIds?.[0];
        if (addResult.ok && objectId && target) {
          await executeCanvasTool("transform_object", {
            objectId,
            left: target.left,
            top: target.top,
            width: Math.max(1, target.width),
            height: Math.max(1, target.height),
          });
        }
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to add all segments.");
    } finally {
      setAutoSegmentAddingAll(false);
    }
  }, [autoSegmentAddingAll, autoSegmentGroups, autoSegmentSourcePlacement, executeCanvasTool, selectedObject, showError]);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("application/x-kavero-canvas-asset")) return;
      handleImageUpload(e.dataTransfer?.files ?? null);
    },
    [handleImageUpload]
  );

  const processGeneratedImages = useCallback(
    async (images: Array<{ id: string; dataUrl: string; mimeType: string; variant: number }>, prompt: string, transparentBackground: boolean) => {
      const supportedImages = images.filter((image): image is { id: string; dataUrl: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; variant: number } =>
        image.mimeType === "image/png" || image.mimeType === "image/jpeg" || image.mimeType === "image/webp",
      );
      if (!transparentBackground) {
        return supportedImages.map((image) => ({ ...image, prompt, transparentBackground }));
      }
      return Promise.all(
        supportedImages.map(async (image) => ({
          ...image,
          dataUrl: await removeSolidEdgeBackground(image.dataUrl),
          mimeType: "image/png" as const,
          prompt,
          transparentBackground,
        })),
      );
    },
    [],
  );

  const requestGeneratedImages = useCallback(
    async ({
      prompt,
      settings,
      transparentBackground,
      backgroundPreference = "auto",
    }: {
      prompt: string;
      settings: CanvasImageGenerationSettings;
      transparentBackground: boolean;
      backgroundPreference?: CanvasImageBackgroundPreference;
    }) => {
      const preview = safeGetVisualPreview(getCanvasVisualPreview) as
        | { status: "available"; mimeType: "image/png" | "image/jpeg" | "image/webp"; dataUrl: string; pageId: string }
        | null;
      const supportsReferences = getBrowserImageModelByLegacyId(settings.model)?.supportsReferenceEditing ?? false;
      const response = await fetch("/api/canvas/image-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          modelAlias: modelProvider.settings?.selected?.imageGenerationModelAlias,
          model: settings.model,
          count: settings.batchSize,
          thinking: settings.thinking,
          aspectRatio: settings.aspectRatio,
          imageSize: settings.imageSize,
          quality: settings.quality,
          background: settings.background,
          transparentBackground,
          backgroundPreference,
          referenceImages: preview && supportsReferences
            ? [{ dataUrl: preview.dataUrl, mimeType: preview.mimeType, name: "Current canvas preview" }]
            : [],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        images?: Array<{ id: string; dataUrl: string; mimeType: string; variant: number }>;
        warnings?: string[];
        error?: string;
        details?: { code?: string };
      };
      if (!response.ok) {
        if (response.status === 409 && payload.details?.code === "model-selection-stale") await modelProvider.refresh();
        throw new Error(payload.error ?? "Image generation failed.");
      }
      return {
        images: await processGeneratedImages(payload.images ?? [], prompt, transparentBackground),
        warnings: payload.warnings ?? [],
      };
    },
    [getCanvasVisualPreview, modelProvider, processGeneratedImages],
  );

  const handleGenerateImages = useCallback(async () => {
    const prompt = imagePrompt.trim();
    if (!prompt || imageGenerating) return;
    const selectedAlias = modelProvider.settings?.selected?.imageGenerationModelAlias;
    if (!selectedAlias || !activeCanvasImageModels.some((model) => model.modelAlias === selectedAlias)) {
      setImageGenerationError("No active image model is selected. Add provider credentials or choose an active model in Settings.");
      return;
    }
    setImageGenerating(true);
    setImageGenerationError(null);
    setImageGenerationWarnings([]);
    try {
      const result = await requestGeneratedImages({
        prompt,
        settings: imageGenerationSettings,
        transparentBackground: imageTransparent,
      });
      setGeneratedImages(result.images);
      setImageGenerationWarnings(result.warnings);
    } catch (error) {
      setImageGenerationError(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setImageGenerating(false);
    }
  }, [activeCanvasImageModels, imageGenerating, imageGenerationSettings, imagePrompt, imageTransparent, modelProvider.settings?.selected?.imageGenerationModelAlias, requestGeneratedImages]);

  const addGeneratedImageToCanvas = useCallback(
    async (image: GeneratedCanvasImage, position?: { x: number; y: number }) => {
      setAddingGeneratedImageId(image.id);
      try {
        const file = await dataUrlToFile(image.dataUrl, `generated-${image.variant}.${image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1]}`);
        const asset = await uploadCanvasAsset(file);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
        addImage(asset.public_url, position);
        return asset;
      } finally {
        setAddingGeneratedImageId(null);
      }
    },
    [addImage],
  );

  const judgeGeneratedImages = useCallback(
    async (prompt: string, candidates: GeneratedCanvasImage[]) => {
      if (candidates.length <= 1) return candidates[0] ?? null;
      let pool = candidates;
      const preview = safeGetVisualPreview(getCanvasVisualPreview) as
        | { status: "available"; mimeType: "image/png" | "image/jpeg" | "image/webp"; dataUrl: string; pageId: string }
        | null;

      while (pool.length > 1) {
        const winners: GeneratedCanvasImage[] = [];
        for (let index = 0; index < pool.length; index += 4) {
          const group = pool.slice(index, index + 4);
          try {
            const response = await fetch("/api/canvas/image-judge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                canvasPreview: preview,
                candidates: group.map((candidate) => ({
                  id: candidate.id,
                  dataUrl: candidate.dataUrl,
                  mimeType: candidate.mimeType,
                })),
              }),
            });
            const payload = (await response.json().catch(() => ({}))) as { winnerId?: string };
            const winner = group.find((candidate) => candidate.id === payload.winnerId) ?? group[0];
            if (winner) winners.push(winner);
          } catch {
            if (group[0]) winners.push(group[0]);
          }
        }
        pool = winners;
      }
      return pool[0] ?? null;
    },
    [getCanvasVisualPreview],
  );

  const executeSidebarCanvasTool = useCallback(
    async (name: CanvasToolName, input: Record<string, unknown>) => {
      if (name !== "generate_image_asset") return executeCanvasTool(name, input);
      if (!imageGenerationSettings.enabled) {
        return canvasToolFailure("generate_image_asset", "Copilot image generation is disabled in settings.");
      }
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (!prompt) return canvasToolFailure("generate_image_asset", "Image generation prompt is required.");
      try {
        const transparentBackground =
          typeof input.transparentBackground === "boolean"
            ? input.transparentBackground
            : imageGenerationSettings.transparentBackgroundDefault;
        const backgroundPreference =
          input.backgroundPreference === "white" || input.backgroundPreference === "black" ? input.backgroundPreference : "auto";
        const result = await requestGeneratedImages({
          prompt,
          settings: imageGenerationSettings,
          transparentBackground,
          backgroundPreference,
        });
        const winner = await judgeGeneratedImages(prompt, result.images);
        if (!winner) return canvasToolFailure("generate_image_asset", "The image model did not return a usable image.");
        setGeneratedImages(result.images);
        setImageGenerationWarnings(result.warnings);
        const position =
          input.position && typeof input.position === "object"
            ? {
                x: Number((input.position as { x?: unknown }).x),
                y: Number((input.position as { y?: unknown }).y),
              }
            : undefined;
        const cleanPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : undefined;
        const asset = await addGeneratedImageToCanvas(winner, cleanPosition);
        if (input.useAsBackground === true) {
          await executeCanvasTool("set_background", {
            type: "image",
            value: asset.public_url,
            fit:
              input.backgroundFit === "contain" ||
              input.backgroundFit === "stretch" ||
              input.backgroundFit === "overflow" ||
              input.backgroundFit === "cover"
                ? input.backgroundFit
                : "cover",
          });
        }
        return canvasToolSuccess(
          "generate_image_asset",
          input.useAsBackground === true
            ? "Generated, judged, uploaded, and set an AI background asset."
            : "Generated, judged, and added an AI image asset.",
          {
          data: { assetId: asset.id, selectedCandidateId: winner.id },
          },
        );
      } catch (error) {
        return canvasToolFailure("generate_image_asset", error instanceof Error ? error.message : "Image generation failed.");
      }
    },
    [addGeneratedImageToCanvas, executeCanvasTool, imageGenerationSettings, judgeGeneratedImages, requestGeneratedImages],
  );

  async function runAssistantWorkflow({
    initialHistory,
    initialSnapshot,
    initialRelationMap,
    initialPreview,
    initialAction = "start",
    initialPhase,
    initialDecision,
    initialCustomInstruction,
    maxIterations = 8,
  }: {
    initialHistory: AssistantMessage[];
    initialSnapshot: ReturnType<typeof getCanvasSceneSnapshot> | null;
    initialRelationMap: ReturnType<typeof getCanvasRelationMap> | null;
    initialPreview: ReturnType<typeof safeGetVisualPreview> | null;
    initialAction?: "start" | "resume";
    initialPhase?: "inspect" | "propose" | "repair";
    initialDecision?: "approve" | "reject" | "customize";
    initialCustomInstruction?: string;
    maxIterations?: number;
  }) {
    const history: AssistantMessage[] = compactAssistantHistory(initialHistory);
    let snapshot = initialSnapshot;
    let relMap = initialRelationMap;
    let preview = initialPreview;
    let action = initialAction;
    let phase = initialPhase;
    let decision = initialDecision;
    let customInstruction = initialCustomInstruction;
    let consecutiveTextOnly = 0;
    let noProgressFeedbacks = 0;
    let waitingForReview = false;
    let hasAppliedEdits = false;
    let finalReviewRequested = false;
    let appliedBatchCount = 0;
    const maxAutoEditBatches = 3;
    const seenToolBatches = new Set<string>();

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (assistantStoppedRef.current) break;
      setAssistantStatus(phase === "repair" ? "repairing" : iteration === 0 ? "planning" : "verifying");

      const controller = new AbortController();
      assistantAbortRef.current = controller;
      const api = await requestCanvasAssistantTurn({
        messages: compactAssistantHistory(history),
        sceneSnapshot: snapshot,
        relationMap: relMap,
        visualPreview: preview,
        imageGeneration: imageGenerationSettings,
        action,
        decision,
        phase,
        customInstruction,
        temperature: assistantTemperature,
        thinkingEnabled: assistantThinking,
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (assistantStoppedRef.current || controller.signal.aborted) {
          return { messages: [], toolCalls: [], error: null, requestsFeedback: false };
        }
        throw error;
      });
      if (assistantAbortRef.current === controller) assistantAbortRef.current = null;
      if (assistantStoppedRef.current) break;

      setAssistantStatus(api.toolCalls.length > 0 ? "executing" : "planning");
      if (api.toolCalls.length > 0) {
        const toolBatchKey = JSON.stringify(api.toolCalls.map((call) => [call.toolName, call.input, call.summary]));
        if (seenToolBatches.has(toolBatchKey)) break;
        seenToolBatches.add(toolBatchKey);
      }
      const hybrid = await resolveHybridToolCalls(api.toolCalls, executeSidebarCanvasTool, assistantAutoApply);
      if (assistantStoppedRef.current) break;
      setAssistantToolCalls((calls) => [...hybrid.toolCalls, ...calls]);
      if (api.error || hybrid.error) setAssistantError(api.error ?? hybrid.error);

      const visibleApiMessages = filterVisibleAssistantMessages(api.messages, api.toolCalls.length > 0);
      if (visibleApiMessages.length > 0 || hybrid.messages.length > 0) {
        setAssistantMessages((current) =>
          compactAssistantHistory([...current, ...visibleApiMessages, ...hybrid.messages]),
        );
      }
      // Use full AI messages for history (not the display-filtered subset) so the AI retains
      // planning context and knows which tools it already called in previous iterations.
      const historyApiMessages = api.messages.filter((m) => m.content.trim().length > 0);
      const validMessages = [...historyApiMessages, ...hybrid.messages].filter((m) => m.content.trim().length > 0);
      history.push(...validMessages);

      const hasPending = hybrid.toolCalls.some((call) => call.status === "pending");
      if (hasPending) {
        waitingForReview = true;
        setAssistantStatus("awaiting_review");
        break;
      }

      const appliedEdits = hybrid.toolCalls.some((call) => call.status === "applied");
      if (appliedEdits) {
        hasAppliedEdits = true;
        appliedBatchCount++;
      }
      const madeToolAttempt = api.toolCalls.length > 0;
      const shouldVerifyCanvas = api.requestsFeedback || appliedEdits;

      if (shouldVerifyCanvas) {
        if (!madeToolAttempt && !appliedEdits) {
          noProgressFeedbacks++;
          if (noProgressFeedbacks >= 2) break;
        } else {
          noProgressFeedbacks = 0;
        }

        consecutiveTextOnly = 0;
        setAssistantStatus("verifying");
        await new Promise((resolve) => setTimeout(resolve, 400));
        snapshot = getCanvasSceneSnapshot();
        relMap = getCanvasRelationMap();
        preview = safeGetVisualPreview(getCanvasVisualPreview);
        const forceReadOnlyReview = hasAppliedEdits && appliedBatchCount >= maxAutoEditBatches;
        if (forceReadOnlyReview) finalReviewRequested = true;
        history.push({
          id: createAssistantId("msg"),
          role: "user",
          content:
            forceReadOnlyReview
              ? "Final review required before you stop. This is read-only: do not call editing tools. Inspect the latest scene snapshot, relation map, visual preview, and exact object coordinates/sizes. Check alignment, overlap, clipping, hierarchy, and whether the final edit changed the intended target. If something is wrong, state the issue concisely instead of making another edit. If it is correct, reply with one concise final summary."
              : "Canvas state has been updated. Inspect the refreshed canvas context and exact coordinates. If the task is already acceptable, reply with one concise final summary and do not call tools. If there is a clear issue, make one focused corrective tool batch only; do not keep resizing or reworking the whole layout.",
        });
        action = "resume";
        phase = forceReadOnlyReview ? "inspect" : "propose";
        decision = undefined;
        customInstruction = undefined;
        continue;
      }

      if (!madeToolAttempt) {
        if (hasAppliedEdits && !finalReviewRequested && !api.error && !hybrid.error) {
          finalReviewRequested = true;
          consecutiveTextOnly = 0;
          setAssistantStatus("verifying");
          await new Promise((resolve) => setTimeout(resolve, 400));
          snapshot = getCanvasSceneSnapshot();
          relMap = getCanvasRelationMap();
          preview = safeGetVisualPreview(getCanvasVisualPreview);
          history.push({
            id: createAssistantId("msg"),
            role: "user",
            content:
              "Final review required before you stop. This is read-only: do not call editing tools. Inspect the latest scene snapshot, relation map, visual preview, and exact object coordinates/sizes. Check alignment, overlap, clipping, hierarchy, and whether the final edit changed the intended target. If something is wrong, state the issue concisely instead of making another edit. If it is correct, reply with one concise final summary.",
          });
          action = "resume";
          phase = "inspect";
          decision = undefined;
          customInstruction = undefined;
          continue;
        }
        consecutiveTextOnly++;
        if (consecutiveTextOnly >= 2) break;
      } else {
        consecutiveTextOnly = 0;
      }

      break;
    }

    if (assistantStoppedRef.current) return false;
    return waitingForReview;
  }

  const isOpen = activeSection !== null;
  const activePanel = activeSection ? getEditorPanel(activeSection) : null;
  const panelWidth = activePanel?.width ?? 240;
  return (
    <aside className="flex shrink-0 flex-row">
      {/* Icon Rail */}
      <div className="flex w-[70px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.08] bg-black/52 pt-3 shadow-[inset_-1px_0_0_rgb(255_255_255_/_0.035)] backdrop-blur-2xl">
        {editorPanels.map((s) => (
          <button
            key={s.id}
            className={`flex h-[56px] w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all ${
              activeSection === s.id
                ? "bg-accent text-white shadow-[0_12px_30px_rgb(59_130_246_/_0.28)]"
                : "text-white/46 hover:bg-white/[0.07] hover:text-white"
            }`}
            onClick={() => {
              if (assistantBusy && s.id !== "copilot") return;
              handleSectionClick(s.id);
            }}
            disabled={assistantBusy && s.id !== "copilot"}
          >
            <s.icon size={20} />
            <span className="text-[10px] leading-tight">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Content Panel */}
      <div
        className="overflow-hidden border-r border-white/[0.08] bg-[#050506] shadow-[0_24px_90px_rgb(0_0_0_/_0.34),inset_1px_0_0_rgb(255_255_255_/_0.04)] transition-all duration-200 ease-in-out"
        style={{ width: isOpen ? `${panelWidth}px` : "0px" }}
      >
        <div className="h-full flex flex-col" style={{ width: panelWidth }}>
          {activeSection && (
            <>
              <div className="px-3 pt-3 pb-2 shrink-0 flex items-center justify-between">
                <h2 className="m-0 text-xs font-black uppercase tracking-[0.08em] text-white/76">
                  {activePanel?.title}
                </h2>
                {activeSection === "copilot" && (
                  <button
                    className="grid h-6 w-6 place-items-center rounded-lg text-white/36 transition hover:bg-white/[0.07] hover:text-white/70"
                    onClick={() => setAssistantSettingsOpen(true)}
                    title="Copilot settings"
                  >
                    <Settings size={13} />
                  </button>
                )}
              </div>
              <div className={`relative flex-1 min-h-0 ${activeSection === "copilot" ? "overflow-hidden" : "overflow-y-auto px-3 pb-3"}`}>
                {assistantBusy && activeSection !== "copilot" ? (
                  <div
                    className="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-black/44 p-4 backdrop-blur-[1px]"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => event.preventDefault()}
                    onDrop={(event) => event.preventDefault()}
                    onDragOver={(event) => event.preventDefault()}
                  >
                    <div className="rounded-2xl border border-amber-200/16 bg-black/76 px-3 py-2 text-center text-xs font-bold text-amber-50/76 shadow-[0_18px_60px_rgb(0_0_0_/_0.38)]">
                      Copilot is editing. Tools are locked.
                    </div>
                  </div>
                ) : null}
                {activeSection === "text" && (
                  <TextPanel addText={addText} />
                )}

                {activeSection === "shapes" && (
                  <ShapesPanel addShape={addShape} />
                )}

                {activeSection === "generate" && (
                  <GeneratePanel
                    prompt={imagePrompt}
                    images={generatedImages}
                    generating={imageGenerating}
                    addingImageId={addingGeneratedImageId}
                    error={imageGenerationError}
                    warnings={imageGenerationWarnings}
                    settings={imageGenerationSettings}
                    transparentBackground={imageTransparent}
                    onPromptChange={setImagePrompt}
                    onGenerate={handleGenerateImages}
                    onAddImage={(image) => void addGeneratedImageToCanvas(image).catch((error: unknown) => {
                      showError(error instanceof Error ? error.message : "Unable to add generated image.");
                    })}
                    onTransparentChange={setImageTransparent}
                    modelOptions={activeCanvasImageOptions}
                    onSettingsChange={(settings) => setImageGenerationSettings((current) =>
                      settings.model === current.model ? settings : (() => {
                        const selected = getBrowserImageModelByLegacyId(settings.model);
                        if (selected) void modelProvider.saveSelection({ imageGenerationModelAlias: selected.modelAlias });
                        return switchCanvasImageModel(current, settings.model);
                      })()
                    )}
                  />
                )}

                {activeSection === "images" && (
                  <AssetsPanel
                    assets={assets}
                    assetsLoading={assetsLoading}
                    uploading={uploading}
                    uploadProgress={uploadProgress}
                    uploadLabel={uploadLabel}
                    fileInputRef={fileInputRef}
                    loadAssets={loadAssets}
                    handleDrop={handleDrop}
                    handleImageUpload={handleImageUpload}
                    addImage={addImage}
                  />
                )}

                {activeSection === "autoSegment" && (
                  <AutoSegmentPanel
                    source={autoSegmentSource}
                    selectedImageSource={selectedImageSource}
                    selectedObject={selectedObject}
                    status={autoSegmentStatus}
                    groups={autoSegmentGroups}
                    error={autoSegmentError}
                    warnings={autoSegmentWarnings}
                    uploadProgress={autoSegmentUploadProgress}
                    addingAll={autoSegmentAddingAll}
                    fileInputRef={autoSegmentFileInputRef}
                    onUpload={handleAutoSegmentUpload}
                    onUseSelected={() => {
                      if (selectedImageSource) {
                        setAutoSegmentSource(selectedImageSource);
                        setAutoSegmentSourcePlacement(getAutoSegmentSourcePlacement(selectedObject));
                        setAutoSegmentGroups([]);
                        setAutoSegmentError(null);
                        setAutoSegmentStatus("idle");
                      }
                    }}
                    onRun={() => void runAutoSegment()}
                    onAddSegment={(segment) => void addAutoSegmentToCanvas(segment)}
                    onAddAll={() => void addAllAutoSegmentsToCanvas()}
                    modelAvailable={Boolean(getBrowserImageModelByLegacyId(imageGenerationSettings.model)?.compatibility["auto-segment-isolation"])}
                    modelUnavailableMessage={`${getBrowserImageModelByLegacyId(imageGenerationSettings.model)?.displayLabel ?? "The selected model"} does not support Auto Segment. Choose a compatible image model in Settings.`}
                  />
                )}

                {activeSection === "layers" && (
                  <LayersPanel
                    layers={layers}
                    selectedLayerId={selectedLayerId}
                    draggingLayerId={draggingLayerId}
                    dropLevel={dropLevel}
                    setDraggingLayerId={setDraggingLayerId}
                    setDropLevel={setDropLevel}
                    selectLayer={selectLayer}
                    moveLayerToLevel={moveLayerToLevel}
                  />
                )}

                {activeSection === "relations" && (
                  <RelationsPanel
                    map={relationMap}
                    selectedObjectId={selectedLayerId}
                    selectedRelationId={selectedRelationId}
                    onSelectObject={(id) => {
                      setSelectedRelationId(null);
                      selectLayer(id);
                    }}
                    onSelectRelation={(edge) => {
                      setSelectedRelationId(edge.id);
                      if (edge.to !== "canvas-background") selectLayer(edge.to);
                    }}
                  />
                )}

                {activeSection === "copilot" && (
                  <CopilotPanel
                    messages={assistantMessages}
                    toolCalls={assistantToolCalls}
                    input={assistantInput}
                    error={assistantError}
                    busy={assistantBusy}
                    status={assistantStatus}
                    onInputChange={setAssistantInput}
                    onStop={stopAssistant}
                    onSend={async () => {
                      const text = assistantInput.trim();
                      if (!text || assistantBusy) return;
                      assistantStoppedRef.current = false;
                      setAssistantInput("");
                      setAssistantError(null);
                      setAssistantBusy(true);

                      const userMessage: AssistantMessage = {
                        id: createAssistantId("msg"),
                        role: "user",
                        content: text,
                      };
                      setAssistantMessages((current) =>
                        compactAssistantHistory([...current, userMessage]),
                      );

                      // Keep going after tool batches so the agent can verify and finish the task.
                      const history: AssistantMessage[] = compactAssistantHistory([
                        ...assistantMessages,
                        userMessage,
                      ]);
                      const isCustomization = text.startsWith("Customize the rejected proposal");
                      const isRepairRequest = !isCustomization && isExplicitRepairRequest(text, assistantMessages);
                      const waitingForReview = await runAssistantWorkflow({
                        initialHistory: history,
                        initialSnapshot: assistantSceneSnapshot,
                        initialRelationMap: assistantRelationMap,
                        initialPreview: assistantVisualPreview,
                        initialAction: isCustomization || isRepairRequest ? "resume" : "start",
                        initialDecision: isCustomization ? "customize" : undefined,
                        initialPhase: isCustomization || isRepairRequest ? "repair" : undefined,
                        initialCustomInstruction: isCustomization
                          ? text
                          : isRepairRequest
                            ? `User explicitly asked to fix the visible issue: "${text}". Do not just restate the problem. Use repair tools to correct clipping, overflow, distortion, scale, and alignment based on the latest snapshot and coordinates.`
                            : undefined,
                      });
                      if (!assistantStoppedRef.current) {
                        setAssistantBusy(false);
                        if (!waitingForReview) setAssistantStatus(null);
                      }
                    }}
                    onApprovePending={async () => {
                      const pendingCalls = assistantToolCalls.filter((item) => item.status === "pending");
                      if (pendingCalls.length === 0) return;
                      assistantStoppedRef.current = false;
                      setAssistantBusy(true);
                      setAssistantError(null);
                      setAssistantStatus("executing");
                      for (const call of pendingCalls) {
                        if (assistantStoppedRef.current) break;
                        const result = await executeSidebarCanvasTool(call.toolName, call.input).catch((error: unknown) =>
                          canvasToolFailure(
                            call.toolName,
                            error instanceof Error ? error.message : "Canvas tool execution failed.",
                          ),
                        );
                        setAssistantToolCalls((current) =>
                          current.map((item) =>
                            item.id === call.id ? { ...item, status: result.ok ? "applied" : "error", result } : item,
                          ),
                        );
                        if (!result.ok) setAssistantError(result.errors[0] ?? result.summary);
                      }
                      if (assistantStoppedRef.current) return;
                      setAssistantStatus("verifying");
                      await new Promise((resolve) => setTimeout(resolve, 400));
                      const continuationMessage: AssistantMessage = {
                        id: createAssistantId("msg"),
                        role: "user",
                        content:
                          "The approved proposal has been applied. Inspect the updated canvas context and continue the original task. If the task is complete, reply with a concise final summary and do not call more tools.",
                      };
                      const waitingForReview = await runAssistantWorkflow({
                        initialHistory: compactAssistantHistory([...assistantMessages, continuationMessage]),
                        initialSnapshot: getCanvasSceneSnapshot(),
                        initialRelationMap: getCanvasRelationMap(),
                        initialPreview: safeGetVisualPreview(getCanvasVisualPreview),
                        initialAction: "resume",
                        initialPhase: "propose",
                        maxIterations: 5,
                      });
                      if (!assistantStoppedRef.current) {
                        setAssistantBusy(false);
                        if (!waitingForReview) setAssistantStatus(null);
                      }
                    }}
                    onRejectPending={() => {
                      setAssistantToolCalls((current) =>
                        current.map((item) => (item.status === "pending" ? { ...item, status: "rejected" } : item)),
                      );
                      setAssistantMessages((current) =>
                        compactAssistantHistory([
                          ...current,
                          {
                            id: createAssistantId("msg"),
                            role: "assistant",
                            content: "Rejected the proposed change. Send a revised instruction when you're ready.",
                          },
                        ]),
                      );
                    }}
                    onCustomizePending={(instruction) => {
                      const pendingSummary = assistantToolCalls
                        .filter((item) => item.status === "pending")
                        .map((item) => `${item.toolName}: ${item.summary}`)
                        .join("\n");
                      setAssistantToolCalls((current) =>
                        current.map((item) => (item.status === "pending" ? { ...item, status: "rejected" } : item)),
                      );
                      setAssistantInput(
                        `Customize the rejected proposal with this instruction:\n${instruction}\n\nPrevious proposal:\n${pendingSummary}`,
                      );
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Copilot settings modal */}
      {assistantSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAssistantSettingsOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative flex h-[420px] w-[520px] overflow-hidden rounded-2xl bg-[#111113] shadow-[0_32px_80px_rgb(0_0_0_/_0.6)]">
            {/* Left nav */}
            <div className="flex w-[168px] shrink-0 flex-col gap-0.5 border-r border-white/8 px-2 py-4">
              <p className="mb-1 px-3 text-[10px] font-black uppercase tracking-[0.1em] text-white/30">Copilot</p>
              {(["general", "model", "tools"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAssistantSettingsTab(tab)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
                    assistantSettingsTab === tab
                      ? "bg-white/10 text-white"
                      : "text-white/46 hover:bg-white/6 hover:text-white/80"
                  }`}
                >
                  {tab === "general"
                    ? <Settings size={14} className="shrink-0" />
                    : <Sparkles size={14} className="shrink-0" />}
                  {tab === "general" ? "General" : tab === "model" ? "Model" : "Tools"}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-6 py-4">
                <h2 className="text-[15px] font-bold text-white">
                  {assistantSettingsTab === "general" ? "General" : assistantSettingsTab === "model" ? "Model" : "Tools"}
                </h2>
                <button
                  onClick={() => setAssistantSettingsOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-white/36 transition hover:bg-white/8 hover:text-white/70"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-y-auto px-6 py-2">
                {assistantSettingsTab === "general" && (
                  <div className="divide-y divide-white/6">
                    <div className="flex items-center justify-between py-4">
                      <div className="mr-6">
                        <p className="text-[13px] font-semibold text-white">Auto-apply</p>
                        <p className="mt-0.5 text-[11px] text-white/40">Apply all changes without asking for confirmation.</p>
                      </div>
                      <Switch checked={assistantAutoApply} onCheckedChange={setAssistantAutoApply} />
                    </div>
                  </div>
                )}

                {assistantSettingsTab === "model" && (
                  <div className="divide-y divide-white/6">
                    <div className="py-4">
                      <SettingsSelect
                        label="Copilot model"
                        value={modelProvider.settings?.selected?.chatOrchestrationModelAlias ?? ""}
                        options={activeChatModels.map((model) => ({ value: model.modelAlias, label: model.displayLabel }))}
                        onChange={(chatOrchestrationModelAlias) => void modelProvider.saveSelection({ chatOrchestrationModelAlias })}
                      />
                    </div>
                    {chatControls?.temperature.supported && <div className="py-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-[13px] font-semibold text-white">Temperature</p>
                          <p className="mt-0.5 text-[11px] text-white/40">Lower = focused, higher = creative.</p>
                        </div>
                        <span className="ml-4 w-7 text-right text-[13px] font-mono font-semibold text-white/60">
                          {assistantTemperature.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-semibold text-white/28">0.0</span>
                        <input
                          type="range"
                          min={chatControls.temperature.minimum}
                          max={chatControls.temperature.maximum}
                          step={chatControls.temperature.step}
                          value={assistantTemperature}
                          onChange={(e) => setAssistantTemperature(Number(e.target.value))}
                          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/14 accent-accent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm"
                        />
                        <span className="text-[10px] font-semibold text-white/28">1.0</span>
                      </div>
                    </div>}

                    {chatControls?.extendedThinking.supported && <div className="flex items-center justify-between py-4">
                      <div className="mr-6">
                        <p className="text-[13px] font-semibold text-white">Extended thinking</p>
                        <p className="mt-0.5 text-[11px] text-white/40">Model reasons step-by-step before responding. Slower but more thorough.</p>
                      </div>
                      <Switch checked={assistantThinking} onCheckedChange={setAssistantThinking} />
                    </div>}

                    <div className="grid gap-3 py-4">
                      <SettingsSelect
                        label="Image model"
                        value={imageGenerationSettings.model}
                        options={activeCanvasImageOptions.map((option) => ({ value: option.value, label: option.label }))}
                        onChange={(model) => {
                          const selected = getBrowserImageModelByLegacyId(model);
                          if (selected) void modelProvider.saveSelection({ imageGenerationModelAlias: selected.modelAlias });
                          setImageGenerationSettings((current) => switchCanvasImageModel(current, model as CanvasImageModel));
                        }}
                      />
                      <SettingsSelect
                        label="Batch"
                        value={String(imageGenerationSettings.batchSize)}
                        options={canvasImageControls.batches.map((value) => ({ value: String(value), label: `${value}x` }))}
                        onChange={(batchSize) => setImageGenerationSettings((current) => ({ ...current, batchSize: Number(batchSize) as CanvasImageBatchSize }))}
                      />
                      {canvasImageControls.thinking.length > 0 && <SettingsSelect
                        label="Image thinking"
                        value={imageGenerationSettings.thinking}
                        options={canvasImageControls.thinking.map((value) => ({ value, label: labelize(value) }))}
                        onChange={(thinking) => setImageGenerationSettings((current) => ({ ...current, thinking: thinking as CanvasImageThinking }))}
                      />}
                      <SettingsSelect
                        label="Aspect"
                        value={imageGenerationSettings.aspectRatio}
                        options={canvasImageControls.aspects.map((value) => ({ value, label: value }))}
                        onChange={(aspectRatio) => setImageGenerationSettings((current) => ({ ...current, aspectRatio }))}
                      />
                      <SettingsSelect
                        label="Size"
                        value={imageGenerationSettings.imageSize}
                        options={canvasImageControls.sizes}
                        onChange={(imageSize) => setImageGenerationSettings((current) => ({ ...current, imageSize: imageSize as CanvasImageQuality }))}
                      />
                      {canvasImageControls.qualities.length > 0 && <SettingsSelect
                        label="Quality"
                        value={imageGenerationSettings.quality}
                        options={canvasImageControls.qualities.map((value) => ({ value, label: labelize(value) }))}
                        onChange={(quality) => setImageGenerationSettings((current) => ({ ...current, quality: quality as CanvasImageGenerationSettings["quality"] }))}
                      />}
                      {canvasImageControls.backgrounds.length > 0 && <SettingsSelect
                        label="Background"
                        value={imageGenerationSettings.background}
                        options={canvasImageControls.backgrounds.map((value) => ({ value, label: labelize(value) }))}
                        onChange={(background) => setImageGenerationSettings((current) => ({ ...current, background: background as CanvasImageGenerationSettings["background"] }))}
                      />}
                    </div>
                  </div>
                )}

                {assistantSettingsTab === "tools" && (
                  <div className="divide-y divide-white/6">
                    <div className="flex items-center justify-between py-4">
                      <div className="mr-6">
                        <p className="text-[13px] font-semibold text-white">Image generation</p>
                        <p className="mt-0.5 text-[11px] text-white/40">Let Copilot create and place generated image assets.</p>
                      </div>
                      <Switch
                        checked={imageGenerationSettings.enabled}
                        onCheckedChange={(enabled) => setImageGenerationSettings((current) => ({ ...current, enabled }))}
                      />
                    </div>

                    <div className="flex items-center justify-between py-4">
                      <div className="mr-6">
                        <p className="text-[13px] font-semibold text-white">Transparent default</p>
                        <p className="mt-0.5 text-[11px] text-white/40">Use background removal when Copilot asks for isolated assets.</p>
                      </div>
                      <Switch
                        checked={imageGenerationSettings.transparentBackgroundDefault}
                        onCheckedChange={(transparentBackgroundDefault) => {
                          setImageGenerationSettings((current) => ({ ...current, transparentBackgroundDefault }));
                          setImageTransparent(transparentBackgroundDefault);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

async function resolveHybridToolCalls(
  calls: PendingAssistantToolCall[],
  executeCanvasTool: (name: CanvasToolName, input: Record<string, unknown>) => Promise<CanvasToolResult>,
  autoApply = false,
) {
  const resolvedCalls: AssistantToolCall[] = [];
  const messages: AssistantMessage[] = [];
  let error: string | null = null;

  for (const call of calls) {
    const hydrated = hydrateAssistantToolCall(call, autoApply);
    if (hydrated.status === "error" || hydrated.status === "rejected") {
      resolvedCalls.push(hydrated);
      if (hydrated.result && !hydrated.result.ok) error = hydrated.result.errors[0] ?? hydrated.result.summary;
      continue;
    }
    if (hydrated.requiresConfirmation) {
      resolvedCalls.push(hydrated);
      continue;
    }

    const result = await executeCanvasTool(hydrated.toolName, hydrated.input).catch((error: unknown) =>
      canvasToolFailure(
        hydrated.toolName,
        error instanceof Error ? error.message : "Canvas tool execution failed.",
      ),
    );
    resolvedCalls.push({ ...hydrated, status: result.ok ? "applied" : "error", result });
    if (!result.ok) {
      messages.push({
        id: createAssistantId("msg"),
        role: "assistant",
        content: `Tool failed: ${result.summary}`,
      });
    }
    if (!result.ok) error = result.errors[0] ?? result.summary;
  }

  return { toolCalls: resolvedCalls, messages, error };
}

function filterVisibleAssistantMessages(messages: AssistantMessage[], hasToolCalls: boolean) {
  return messages.filter((message) => {
    const content = message.content.trim();
    if (!content) return false;
    if (hasToolCalls) return false;
    if (/^I prepared the canvas operation details\.?$/i.test(content)) return false;
    if (/^I prepared\b/i.test(content)) return false;
    return true;
  });
}

function isExplicitRepairRequest(text: string, messages: AssistantMessage[]) {
  if (!/\b(fix|repair|correct|clean up|adjust|resolve|make it right)\b/i.test(text)) return false;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  return /\b(issue|wrong|problem|clipped|overflow|distort|misalign|overlap|cut off|too large|too small|outside|severely)\b/i.test(
    lastAssistant,
  );
}

function hydrateAssistantToolCall(call: PendingAssistantToolCall, autoApply = false): AssistantToolCall {
  const riskLevel = CANVAS_TOOL_REGISTRY[call.toolName]?.riskLevel ?? "high";
  const requiresConfirmation = autoApply
    ? false
    : (call.forceConfirmation ?? requiresToolConfirmation(call.toolName, call.input, riskLevel));
  return { ...call, riskLevel, requiresConfirmation };
}

function requiresToolConfirmation(
  toolName: CanvasToolName,
  input: Record<string, unknown>,
  riskLevel: CanvasToolRisk,
) {
  if (riskLevel === "high") return true;
  if (PAGE_LEVEL_TOOLS.has(toolName)) return true;
  if (isBulkObjectTool(toolName, input)) return true;
  if (AUTO_APPLY_TOOLS.has(toolName)) return false;
  return riskLevel !== "low";
}

const AUTO_APPLY_TOOLS = new Set<CanvasToolName>([
  "add_text",
  "add_shape",
  "select_object",
  "update_object",
  "transform_object",
  "align_object",
  "reorder_object",
  "undo",
  "redo",
]);

const PAGE_LEVEL_TOOLS = new Set<CanvasToolName>(["set_background", "set_canvas_size", "save"]);

function isBulkObjectTool(toolName: CanvasToolName, input: Record<string, unknown>) {
  if (toolName === "delete_objects") return true;
  const objectIds = input.objectIds;
  return Array.isArray(objectIds) && objectIds.length > 1;
}

async function requestCanvasAssistantTurn({
  action,
  phase,
  decision,
  customInstruction,
  messages,
  sceneSnapshot,
  relationMap,
  visualPreview,
  imageGeneration,
  temperature,
  thinkingEnabled,
  signal,
}: {
  action?: "start" | "resume";
  phase?: "inspect" | "propose" | "repair";
  decision?: "approve" | "reject" | "customize";
  customInstruction?: string;
  messages: AssistantMessage[];
  sceneSnapshot: any;
  relationMap: unknown;
  visualPreview: unknown;
  imageGeneration?: CanvasImageGenerationSettings;
  temperature?: number;
  thinkingEnabled?: boolean;
  signal?: AbortSignal;
}): Promise<{ messages: AssistantMessage[]; toolCalls: PendingAssistantToolCall[]; error: string | null; requestsFeedback: boolean }> {
  if (!sceneSnapshot?.designId || !sceneSnapshot?.pageId) {
    return {
      messages: [
        {
          id: createAssistantId("msg"),
          role: "assistant",
          content: "I need an active canvas page before I can use Copilot tools.",
        },
      ],
      toolCalls: [],
      error: "Active canvas context is unavailable.",
      requestsFeedback: false,
    };
  }

  let response: Response;
  try {
    response = await fetch("/api/canvas/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action ?? "start",
        phase,
        decision,
        customInstruction,
        designId: sceneSnapshot.designId,
        pageId: sceneSnapshot.pageId,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        sceneSnapshot,
        relationMap,
        selectedObjectIds: sceneSnapshot.selectedObjectIds ?? [],
        visualPreview,
        imageGeneration,
        temperature,
        thinkingEnabled,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        messages: [],
        toolCalls: [],
        error: null,
        requestsFeedback: false,
      };
    }
    return {
      messages: [{ id: createAssistantId("msg"), role: "assistant", content: "Copilot is unavailable right now." }],
      toolCalls: [],
      error: "Unable to reach the canvas assistant.",
      requestsFeedback: false,
    };
  }

  const body = (await response.json().catch(() => null)) as Partial<CanvasAssistantApiResponse> & {
    error?: string;
    details?: { code?: string };
  } | null;
  if (!response.ok || !body || body.error) {
    const error = body?.error ?? "Canvas assistant failed.";
    if (response.status === 409 && body?.details?.code === "model-selection-stale") {
      window.dispatchEvent(new Event(modelProviderSettingsChangedEvent));
    }
    return {
      messages: [{ id: createAssistantId("msg"), role: "assistant", content: error }],
      toolCalls: [],
      error,
      requestsFeedback: false,
    };
  }

  const apiBody = body as CanvasAssistantApiResponse;
  return {
    messages: apiBody.message
      ? [{ ...apiBody.message, id: createAssistantId("msg"), role: apiBody.message.role === "user" ? "assistant" : apiBody.message.role }]
      : [],
    toolCalls: Array.isArray(apiBody.toolCalls) ? apiBody.toolCalls.map(apiToolCallToPendingCall) : [],
    error: Array.isArray(apiBody.errors) ? (apiBody.errors[0] ?? null) : null,
    requestsFeedback: Boolean((apiBody as any).requestsFeedback),
  };
}

function apiToolCallToPendingCall(call: CanvasAssistantApiResponse["toolCalls"][number]): PendingAssistantToolCall {
  if (call.status === "rejected") {
    return {
      id: call.id,
      toolName: call.name,
      input: call.input ?? {},
      summary: call.errors[0] ?? call.summary,
      status: "error",
      result: canvasToolFailure(call.name, call.errors[0] ?? call.summary, call.errors),
      forceConfirmation: true,
    };
  }

  return {
    id: call.id,
    toolName: call.name,
    input: call.input ?? {},
    summary: call.summary,
    status: "pending",
    forceConfirmation: call.status === "requires_confirmation",
  };
}

function compactAssistantHistory(messages: AssistantMessage[]) {
  const maxMessages = 10;
  if (messages.length <= maxMessages) return messages;
  const kept = messages.slice(-(maxMessages - 1));
  return [
    {
      id: "assistant-session-summary",
      role: "system" as const,
      content: `Earlier session compacted: ${messages.length - kept.length} messages summarized for future model context.`,
    },
    ...kept,
  ];
}

function createAssistantId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeGetVisualPreview(getCanvasVisualPreview: () => unknown) {
  try {
    return getCanvasVisualPreview();
  } catch {
    return null;
  }
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

async function removeSolidEdgeBackground(dataUrl: string) {
  const image = await loadHtmlImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const samples = [
    colorAt(data, width, 0, 0),
    colorAt(data, width, width - 1, 0),
    colorAt(data, width, 0, height - 1),
    colorAt(data, width, width - 1, height - 1),
  ];
  const bg = averageColor(samples);
  const tolerance = Math.max(34, colorDistance(samples[0], samples[1]), colorDistance(samples[0], samples[2]), colorDistance(samples[1], samples[3])) + 18;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    visited[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    const current = [data[offset], data[offset + 1], data[offset + 2]] as const;
    if (colorDistance(current, bg) > tolerance) continue;
    data[offset + 3] = 0;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  for (let index = 0; index < width * height; index++) {
    if (data[index * 4 + 3] !== 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nOffset = (ny * width + nx) * 4;
        if (data[nOffset + 3] !== 0 && colorDistance([data[nOffset], data[nOffset + 1], data[nOffset + 2]], bg) < tolerance + 20) {
          data[nOffset + 3] = Math.min(data[nOffset + 3], 70);
        }
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function createMaskedCutout(
  sourceUrl: string,
  maskDataUrl: string,
  options: { flatBackgroundCleanup?: boolean; crispMask?: boolean } = {},
) {
  const [source, mask] = await Promise.all([loadHtmlImage(sourceUrl), loadHtmlImage(maskDataUrl)]);
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const previewBackground = estimateSourceBackground(source);
  if (!width || !height) return { dataUrl: maskDataUrl, previewBackground, crop: null };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { dataUrl: maskDataUrl, previewBackground, crop: null };

  context.drawImage(source, 0, 0, width, height);
  const sourceData = context.getImageData(0, 0, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) return { dataUrl: maskDataUrl, previewBackground, crop: null };
  maskContext.drawImage(mask, 0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height).data;

  const data = sourceData.data;
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    const luminance = maskData[offset] * 0.2126 + maskData[offset + 1] * 0.7152 + maskData[offset + 2] * 0.0722;
    const alpha = options.crispMask
      ? luminance >= 150
        ? 255
        : luminance >= 84
          ? Math.round((luminance - 84) * 3.86)
          : 0
      : Math.max(0, Math.min(255, Math.round((luminance - 24) * 1.45)));
    data[offset + 3] = Math.min(data[offset + 3], alpha);
  }

  if (options.flatBackgroundCleanup && !options.crispMask) {
    removeFlatBackgroundFromMaskedPixels(data, width, height);
  }

  context.putImageData(sourceData, 0, 0);
  return cropTransparentCanvas(canvas, previewBackground);
}

function cropTransparentCanvas(canvas: HTMLCanvasElement, previewBackground: string) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const fallbackCrop = { x: 0, y: 0, width: canvas.width, height: canvas.height, sourceWidth: canvas.width, sourceHeight: canvas.height };
  if (!context) return { dataUrl: canvas.toDataURL("image/png"), previewBackground, crop: fallbackCrop };
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = alphaBounds(imageData.data, canvas.width, canvas.height, 8);
  if (!bounds) return { dataUrl: canvas.toDataURL("image/png"), previewBackground, crop: fallbackCrop };

  const padding = Math.max(8, Math.round(Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.08));
  const sx = Math.max(0, bounds.left - padding);
  const sy = Math.max(0, bounds.top - padding);
  const sw = Math.min(canvas.width - sx, bounds.right - bounds.left + 1 + padding * 2);
  const sh = Math.min(canvas.height - sy, bounds.bottom - bounds.top + 1 + padding * 2);

  const cropped = document.createElement("canvas");
  cropped.width = Math.max(1, sw);
  cropped.height = Math.max(1, sh);
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) return { dataUrl: canvas.toDataURL("image/png"), previewBackground, crop: fallbackCrop };
  croppedContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return {
    dataUrl: cropped.toDataURL("image/png"),
    previewBackground,
    crop: { x: sx, y: sy, width: sw, height: sh, sourceWidth: canvas.width, sourceHeight: canvas.height },
  };
}

function alphaBounds(data: Uint8ClampedArray, width: number, height: number, alphaThreshold: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < width * height; index++) {
    if (data[index * 4 + 3] < alphaThreshold) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function estimateSourceBackground(source: HTMLImageElement) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!width || !height) return "#8a8f98";
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 160);
  canvas.height = Math.min(height, 160);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#8a8f98";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const samples: Array<readonly [number, number, number]> = [];
  const push = (x: number, y: number) => {
    const offset = (y * canvas.width + x) * 4;
    if (imageData[offset + 3] < 24) return;
    samples.push([imageData[offset], imageData[offset + 1], imageData[offset + 2]]);
  };
  for (let x = 0; x < canvas.width; x++) {
    push(x, 0);
    push(x, canvas.height - 1);
  }
  for (let y = 0; y < canvas.height; y++) {
    push(0, y);
    push(canvas.width - 1, y);
  }
  if (samples.length < 8) return "#8a8f98";
  const color = medianColor(samples);
  return `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;
}

function removeFlatBackgroundFromMaskedPixels(data: Uint8ClampedArray, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < width * height; index++) {
    if (data[index * 4 + 3] < 24) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return;

  const samples: Array<readonly [number, number, number]> = [];
  const pushSample = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 24) return;
    samples.push([data[offset], data[offset + 1], data[offset + 2]]);
  };

  for (let x = left; x <= right; x++) {
    pushSample(x, top);
    pushSample(x, bottom);
  }
  for (let y = top; y <= bottom; y++) {
    pushSample(left, y);
    pushSample(right, y);
  }
  if (samples.length < 8) return;

  const bg = medianColor(samples);
  const tolerance = 34;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    if (x < left || y < top || x > right || y > bottom) return;
    const index = y * width + x;
    if (visited[index]) return;
    const offset = index * 4;
    if (data[offset + 3] < 24) return;
    if (colorDistance([data[offset], data[offset + 1], data[offset + 2]], bg) >= tolerance) return;
    visited[index] = 1;
    queue.push(index);
  };

  for (let x = left; x <= right; x++) {
    enqueue(x, top);
    enqueue(x, bottom);
  }
  for (let y = top; y <= bottom; y++) {
    enqueue(left, y);
    enqueue(right, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
}

function medianColor(colors: ReadonlyArray<readonly [number, number, number]>) {
  const channel = (index: 0 | 1 | 2) => {
    const values = colors.map((color) => color[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)] as const;
}

function loadHtmlImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Generated image could not be decoded."));
    image.src = src;
  });
}

function colorAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]] as const;
}

function averageColor(colors: ReadonlyArray<readonly [number, number, number]>) {
  return [
    colors.reduce((sum, color) => sum + color[0], 0) / colors.length,
    colors.reduce((sum, color) => sum + color[1], 0) / colors.length,
    colors.reduce((sum, color) => sum + color[2], 0) / colors.length,
  ] as const;
}

function colorDistance(a: readonly [number, number, number], b: readonly [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function getAutoSegmentSourceFromObject(object: unknown): AutoSegmentSource | null {
  if (!object || typeof object !== "object") return null;
  const record = object as Record<string, unknown>;
  if (record.kaveroKind === "background-image") return null;
  const source =
    typeof record.kaveroAssetSrc === "string"
      ? record.kaveroAssetSrc
      : typeof record.src === "string"
        ? record.src
        : typeof record.getSrc === "function"
          ? String((record.getSrc as () => unknown)() ?? "")
          : "";
  const assetId = source.match(/^\/api\/canvas\/assets\/([a-zA-Z0-9_-]+)$/)?.[1] ?? null;
  if (!assetId) return null;
  const meta = record.kaveroMeta as { name?: unknown } | undefined;
  const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : `Image ${shortId(assetId)}`;
  return { assetId, assetUrl: source, name };
}

function shouldCleanFlatBackground(segment: { category: AutoSegmentCategoryKey; label: string }) {
  const value = `${segment.category} ${segment.label}`.toLowerCase();
  if (/\b(card|device|screen|phone|laptop|panel|modal|window|photo|image|object|product)\b/.test(value)) return false;
  if (isTextLikeAutoSegment(segment)) return false;
  return /\b(text|heading|subheading|title|caption|paragraph|copy|sentence|bullet|word|line|logo|icon|glyph|badge|label|mark)\b/.test(value);
}

function isTextLikeAutoSegment(segment: { category: AutoSegmentCategoryKey; label: string }) {
  const value = `${segment.category} ${segment.label}`.toLowerCase();
  return /\b(text|heading|subheading|title|caption|paragraph|copy|sentence|bullet|word)\b/.test(value);
}

function getAutoSegmentSourcePlacement(object: unknown) {
  if (!object || typeof object !== "object") return null;
  const record = object as {
    left?: unknown;
    top?: unknown;
    width?: unknown;
    height?: unknown;
    scaleX?: unknown;
    scaleY?: unknown;
    getScaledWidth?: () => number;
    getScaledHeight?: () => number;
  };
  const left = Number(record.left);
  const top = Number(record.top);
  const width =
    typeof record.getScaledWidth === "function"
      ? Number(record.getScaledWidth())
      : Number(record.width) * (Number(record.scaleX) || 1);
  const height =
    typeof record.getScaledHeight === "function"
      ? Number(record.getScaledHeight())
      : Number(record.height) * (Number(record.scaleY) || 1);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function placementFromCrop(crop: AutoSegmentCrop, source: { left: number; top: number; width: number; height: number }) {
  const xRatio = crop.x / Math.max(1, crop.sourceWidth);
  const yRatio = crop.y / Math.max(1, crop.sourceHeight);
  const widthRatio = crop.width / Math.max(1, crop.sourceWidth);
  const heightRatio = crop.height / Math.max(1, crop.sourceHeight);
  const left = source.left + source.width * xRatio;
  const top = source.top + source.height * yRatio;
  const width = source.width * widthRatio;
  const height = source.height * heightRatio;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function shortId(id: string) {
  if (id === "canvas-background") return "background";
  return id.length > 10 ? `${id.slice(0, 7)}...` : id;
}
