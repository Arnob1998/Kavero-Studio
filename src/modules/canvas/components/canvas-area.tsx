import { useRef, useEffect, useState, useCallback } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Clipboard,
  Copy,
  Files,
  Layers,
  Plus,
  Trash2,
  BringToFront,
  SendToBack,
  ImageIcon,
  Crop,
  Check,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as fabric from "fabric";
import { useEditor } from "@/modules/canvas/state/context";
import { roundSignedRotationDegrees } from "@/modules/canvas/utils/rotation";
import { PageCanvas } from "@/modules/canvas/components/page-canvas";
import { uploadCanvasAsset } from "@/modules/assets/canvas-assets";

export function CanvasArea() {
  const {
    pages, activePageId, setActiveCanvas, canvasWidth, canvasHeight,
    zoom, setZoomRaw, setFitScale, addPage, duplicatePage, deletePage, renamePage, addImage, showError,
    canvas, selectedObject, duplicateSelected, copySelected, pasteClipboard, deleteSelected, alignSelected, arrangeSelected, getSelectedLayerInfo,
    executeCanvasTool,
    imageCropModeObjectId,
    endImageCropMode,
    cancelImageCropMode,
    cropImageObject,
    getImageCropInfo,
    updateSelectedObject,
  } = useEditor();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [canvasUpload, setCanvasUpload] = useState<{ label: string; progress: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [rotationBadge, setRotationBadge] = useState<{ x: number; y: number; angle: number } | null>(null);
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [lockOverlayBounds, setLockOverlayBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const openContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!canvas) return;
      const upperCanvas = canvas.upperCanvasEl;
      const rect = upperCanvas.getBoundingClientRect();
      const pointer = {
        x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
        y: ((event.clientY - rect.top) / rect.height) * canvasHeight,
      };
      const target =
        canvas
          .getObjects()
          .slice()
          .reverse()
          .find((object) => {
            if (
              (object as any).kaveroKind === "smart-guide" ||
              (object as any)._isBgImage ||
              (object as any).kaveroKind === "background-image" ||
              Boolean((object as any).kaveroBgSrc) ||
              !object.evented
            ) return false;
            return object.containsPoint(new fabric.Point(pointer.x, pointer.y));
          }) ?? canvas.getActiveObject();
      if (
        !target ||
        (target as any).kaveroKind === "smart-guide" ||
        (target as any)._isBgImage ||
        (target as any).kaveroKind === "background-image" ||
        Boolean((target as any).kaveroBgSrc)
      ) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [canvas, canvasHeight, canvasWidth],
  );

  // Calculate fit scale on mount
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const padding = 120;
    const availW = wrapper.clientWidth - padding;
    const fit = Math.min(availW / canvasWidth, 1);
    setFitScale(fit);
    setZoomRaw(0.58);
  }, [canvasWidth, canvasHeight]);

  // Recalculate on resize
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const obs = new ResizeObserver(() => {
      const padding = 120;
      const availW = wrapper.clientWidth - padding;
      const fit = Math.min(availW / canvasWidth, 1);
      setFitScale(fit);
    });
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, [canvasWidth, canvasHeight]);

  // Cmd+wheel zoom towards mouse position
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const prevZoom = zoomRef.current;
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      const newZoom = Math.min(Math.max(prevZoom * factor, 0.05), 3);

      // Mouse position relative to scroll container
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + wrapper.scrollLeft;
      const mouseY = e.clientY - rect.top + wrapper.scrollTop;

      // Adjust scroll to keep point under mouse stable
      const scale = newZoom / prevZoom;
      wrapper.scrollLeft = mouseX * scale - (e.clientX - rect.left);
      wrapper.scrollTop = mouseY * scale - (e.clientY - rect.top);

      setZoomRaw(newZoom);
    };
    wrapper.addEventListener("wheel", handler, { passive: false });
    return () => wrapper.removeEventListener("wheel", handler);
  }, [setZoomRaw]);

  // Auto-activate first page if none active
  useEffect(() => {
    if (!activePageId && pages.length > 0) {
      setActiveCanvas(pages[0].id);
    }
  }, [pages, activePageId, setActiveCanvas]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!canvas?.upperCanvasEl) return;
    const element = canvas.upperCanvasEl;
    element.addEventListener("contextmenu", openContextMenu);
    return () => element.removeEventListener("contextmenu", openContextMenu);
  }, [canvas, openContextMenu]);

  useEffect(() => {
    const handleLock = (event: Event) => {
      setCanvasLocked(Boolean((event as CustomEvent<{ locked?: boolean }>).detail?.locked));
    };
    window.addEventListener("kavero:canvas-lock", handleLock);
    return () => window.removeEventListener("kavero:canvas-lock", handleLock);
  }, []);

  useEffect(() => {
    if (!canvasLocked) {
      setLockOverlayBounds(null);
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const updateBounds = () => {
      const rect = wrapper.getBoundingClientRect();
      setLockOverlayBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(wrapper);
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
    };
  }, [canvasLocked]);

  useEffect(() => {
    if (!canvas) return;
    const updateRotationBadge = (event: any) => {
      const nativeEvent = event.e as MouseEvent | PointerEvent | undefined;
      const target = event.target as fabric.FabricObject | undefined;
      if (!nativeEvent || !target) return;
      const normalizedAngle = roundSignedRotationDegrees(target.angle);
      setRotationBadge({ x: nativeEvent.clientX, y: nativeEvent.clientY, angle: normalizedAngle });
    };
    const hideRotationBadge = () => setRotationBadge(null);
    canvas.on("object:rotating", updateRotationBadge);
    canvas.on("mouse:up", hideRotationBadge);
    canvas.on("selection:cleared", hideRotationBadge);
    return () => {
      canvas.off("object:rotating", updateRotationBadge);
      canvas.off("mouse:up", hideRotationBadge);
      canvas.off("selection:cleared", hideRotationBadge);
    };
  }, [canvas]);

  const startRename = (pageId: string, currentTitle: string) => {
    setRenamingId(pageId);
    setRenameValue(currentTitle);
  };

  const finishRename = () => {
    if (renamingId && renameValue.trim()) {
      renamePage(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  // Inverse scale for page headers so they don't zoom
  const inverseScale = 1 / zoom;

  const getDropTarget = (event: ReactDragEvent<HTMLDivElement>) => {
    const pageEl = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) =>
        element instanceof HTMLElement
          ? element.closest<HTMLElement>("[data-page-id]")
          : null,
      )
      .find((element): element is HTMLElement => Boolean(element?.dataset.pageId));
    if (!pageEl) return null;

    const canvasEl = pageEl.querySelector<HTMLCanvasElement>(".upper-canvas") ?? pageEl.querySelector("canvas");
    if (!canvasEl) return null;

    const rect = canvasEl.getBoundingClientRect();
    return {
      pageId: pageEl.dataset.pageId!,
      position: {
        x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
        y: ((event.clientY - rect.top) / rect.height) * canvasHeight,
      },
    };
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const dragTypes = Array.from(event.dataTransfer.types);
    if (dragTypes.includes("application/x-kavero-canvas-asset")) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      return;
    }

    if (dragTypes.includes("Files")) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      return;
    }

    if (
      !dragTypes.some(
        (type) => type === "application/x-kavero-canvas-asset" || type === "text/plain",
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const assetUrl =
      event.dataTransfer.getData("application/x-kavero-canvas-asset") ||
      event.dataTransfer.getData("text/plain");
    if (assetUrl.startsWith("/api/canvas/assets/")) {
      event.preventDefault();
      event.stopPropagation();
      const target = getDropTarget(event);
      if (target) {
        setActiveCanvas(target.pageId);
        void addImage(assetUrl, target.position);
        return;
      }

      void addImage(assetUrl);
      return;
    }

    if (/^data:image\/(?:png|jpeg|webp);base64,/.test(assetUrl)) {
      event.preventDefault();
      event.stopPropagation();
      const target = getDropTarget(event);
      void (async () => {
        try {
          setCanvasUpload({ label: "Uploading generated image", progress: 0 });
          const file = await dataUrlToCanvasFile(assetUrl);
          const asset = await uploadCanvasAsset(file, (progress) => {
            setCanvasUpload((current) => (current ? { ...current, progress } : current));
          });
          window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
          if (target) {
            setActiveCanvas(target.pageId);
            await addImage(asset.public_url, target.position);
          } else {
            await addImage(asset.public_url);
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Upload failed.");
        } finally {
          setCanvasUpload(null);
        }
      })();
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0 || Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.stopPropagation();
      const target = getDropTarget(event);
      const files = droppedFiles.filter((file) =>
        ["image/png", "image/jpeg", "image/webp"].includes(file.type),
      );
      if (files.length === 0) {
        showError("Drop PNG, JPG, or WebP images onto the canvas.");
        return;
      }

      void (async () => {
        try {
          for (const [index, file] of files.entries()) {
            setCanvasUpload({
              label: files.length > 1 ? `Uploading ${index + 1}/${files.length}` : "Uploading image",
              progress: 0,
            });
            const asset = await uploadCanvasAsset(file, (progress) => {
              setCanvasUpload((current) => (current ? { ...current, progress } : current));
            });
            window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
            if (target) {
              setActiveCanvas(target.pageId);
              await addImage(asset.public_url, target.position);
            } else {
              await addImage(asset.public_url);
            }
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Upload failed.");
        } finally {
          setCanvasUpload(null);
        }
      })();
      return;
    }

  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    openContextMenu(event.nativeEvent);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 overflow-auto bg-transparent [scrollbar-color:rgb(255_255_255_/_0.26)_transparent]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      {canvasLocked && lockOverlayBounds ? (
        <div
          className="pointer-events-auto fixed z-40 flex items-start justify-center bg-black/[0.10] backdrop-blur-[1px]"
          style={lockOverlayBounds}
          onWheel={(event) => event.preventDefault()}
          onPointerDown={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="mt-5 flex items-center gap-2 rounded-2xl border border-amber-200/18 bg-black/72 px-3 py-2 text-xs font-bold text-amber-50/78 shadow-[0_18px_70px_rgb(0_0_0_/_0.38)] backdrop-blur-xl">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
            Copilot is editing. Canvas controls are locked.
          </div>
        </div>
      ) : null}
      {imageCropModeObjectId ? (
        <CropModeOverlay
          objectId={imageCropModeObjectId}
          canvas={canvas}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          selectedObject={selectedObject}
          getImageCropInfo={getImageCropInfo}
          cropImageObject={cropImageObject}
          updateSelectedObject={updateSelectedObject}
          onDone={endImageCropMode}
          onCancel={cancelImageCropMode}
        />
      ) : null}
      {contextMenu && selectedObject && !imageCropModeObjectId ? (
        <ObjectContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedObject={selectedObject}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onClose={() => setContextMenu(null)}
          onDuplicate={() => void duplicateSelected()}
          onCopy={() => void copySelected()}
          onPaste={() => void pasteClipboard()}
          onDelete={deleteSelected}
          onSetAsBackground={() => {
            const objectId = String((selectedObject as any).kaveroId ?? "");
            if (!objectId) {
              showError("Select an uploaded image before setting it as the background.");
              return;
            }
            void executeCanvasTool("set_image_as_background", { objectId, fit: "cover" }).then((result) => {
              if (!result.ok) showError(result.errors[0] ?? "Unable to set that image as the background.");
            });
          }}
          onAlign={alignSelected}
          onArrange={arrangeSelected}
          layerInfo={getSelectedLayerInfo()}
        />
      ) : null}
      {rotationBadge ? (
        <div
          className="pointer-events-none fixed z-[90] rounded-lg bg-zinc-950 px-2 py-1 text-xs font-black text-white shadow-[0_10px_26px_rgb(0_0_0_/_0.35)]"
          style={{ left: rotationBadge.x + 10, top: rotationBadge.y - 34 }}
        >
          {rotationBadge.angle}&deg;
        </div>
      ) : null}
      {canvasUpload ? (
        <div className="pointer-events-none absolute left-1/2 top-5 z-30 w-[min(320px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-white/[0.12] bg-black/78 p-3 shadow-[0_18px_70px_rgb(0_0_0_/_0.48),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-2xl">
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-white/64">
            <span>{canvasUpload.label}</span>
            <span>{canvasUpload.progress}%</span>
          </div>
          <div className="overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-1.5 rounded-full bg-accent transition-[width]"
              style={{ width: `${canvasUpload.progress}%` }}
            />
          </div>
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 opacity-80 [background-image:radial-gradient(circle,rgb(255_255_255_/_0.2)_1px,transparent_1.5px)] [background-size:28px_28px]"
        aria-hidden="true"
      />
      {/* Spacer div — its dimensions match the visual (scaled) size so overflow scrollbars work */}
      <div
        style={{
          width: Math.max((canvasWidth + 80) * zoom, wrapperRef.current?.clientWidth ?? 0),
          minHeight: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "center top",
          padding: "40px 40px 80px",
        }}
      >
        {pages.map((page) => (
          <div
            key={page.id}
            className="mb-10"
            data-page-id={page.id}
            ref={(el) => {
              if (el) pageRefs.current.set(page.id, el);
            }}
          >
            {/* Page header — inverse scaled to stay fixed size */}
            <div
              style={{
                height: 32 * inverseScale,
                marginBottom: 4 * inverseScale,
              }}
            >
            <div
              className="group/header flex items-center justify-between py-1.5"
              style={{
                transform: `scale(${inverseScale})`,
                transformOrigin: "left top",
                width: canvasWidth * zoom,
                height: 32,
              }}
            >
              {/* Title — click to rename */}
              <div className="flex items-center gap-1.5">
                {renamingId === page.id ? (
                  <input
                    ref={renameRef}
                    className="rounded-lg border border-accent/60 bg-black/72 px-2 py-1 text-[11px] font-semibold text-white outline-none"
                    style={{ width: 140 }}
                    value={renameValue}
                    onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span
                    className="cursor-pointer rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white/48 transition-colors hover:text-white"
                    onClick={() => startRename(page.id, page.title)}
                  >
                    {page.title}
                  </span>
                )}
              </div>

              {/* Action icons — visible on hover */}
              <div className="flex items-center gap-0.5">
                <button
                  className="grid h-7 w-7 place-items-center rounded-lg text-white/42 transition hover:bg-accent/14 hover:text-accent"
                  onClick={() => addPage(page.id)}
                  title="Add page below"
                >
                  <Plus size={14} />
                </button>
                <button
                  className="grid h-7 w-7 place-items-center rounded-lg text-white/42 transition hover:bg-accent/14 hover:text-accent"
                  onClick={() => duplicatePage(page.id)}
                  title="Duplicate page"
                >
                  <Copy size={14} />
                </button>
                {pages.length > 1 && (
                  <button
                    className="grid h-7 w-7 place-items-center rounded-lg text-white/42 transition hover:bg-red-500/16 hover:text-red-100"
                    onClick={() => deletePage(page.id)}
                    title="Delete page"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            </div>

            {/* Canvas */}
            <PageCanvas
              page={page}
              isActive={page.id === activePageId}
              width={canvasWidth}
              height={canvasHeight}
              onActivate={() => setActiveCanvas(page.id)}
            />
          </div>
        ))}

        {/* Add page button — inverse scaled */}
        <div style={{ height: 40 * inverseScale }}>
          <div
            style={{
              transform: `scale(${inverseScale})`,
              transformOrigin: "center top",
              height: 40,
            }}
          >
            <button
              className="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-white/[0.18] bg-black/34 px-4 text-xs font-semibold text-white/44 backdrop-blur-xl transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
              onClick={() => addPage()}
            >
              <Plus size={14} />
              Add page
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

async function dataUrlToCanvasFile(dataUrl: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `generated-canvas-image.${extension}`, { type: blob.type || "image/png" });
}

type CropRect = { left: number; top: number; width: number; height: number };

function CropModeOverlay({
  objectId,
  canvas,
  canvasWidth,
  canvasHeight,
  selectedObject,
  getImageCropInfo,
  cropImageObject,
  updateSelectedObject,
  onDone,
  onCancel,
}: {
  objectId: string;
  canvas: fabric.Canvas | null;
  canvasWidth: number;
  canvasHeight: number;
  selectedObject: fabric.FabricObject | null;
  getImageCropInfo: (objectId: string) => {
    sourceWidth: number;
    sourceHeight: number;
    currentCrop: { unit: "source_px"; x: number; y: number; width: number; height: number };
  } | null;
  cropImageObject: (
    objectId: string,
    crop: { unit: "source_px"; x: number; y: number; width: number; height: number },
    options?: { outputFit?: "preserve-frame" | "resize-frame-to-crop" },
  ) => boolean;
  updateSelectedObject: (props: Record<string, unknown>) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const info = getImageCropInfo(objectId);
  const image =
    selectedObject instanceof fabric.FabricImage && String((selectedObject as any).kaveroId ?? "") === objectId
      ? selectedObject
      : canvas?.getObjects().find((object): object is fabric.FabricImage =>
          object instanceof fabric.FabricImage && String((object as any).kaveroId ?? "") === objectId,
        ) ?? null;
  const [outer, setOuter] = useState<CropRect | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const dragRef = useRef<{
    mode: "move-crop" | "resize-crop";
    handle?: string;
    startX: number;
    startY: number;
    outer: CropRect;
    crop: CropRect;
  } | null>(null);

  const src = image ? String((image as any).kaveroAssetSrc ?? (image as any).getSrc?.() ?? "") : "";
  const canvasRect = canvas?.upperCanvasEl.getBoundingClientRect() ?? null;

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  useEffect(() => {
    if (!canvas || !image || !info) return;
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const sx = rect.width / Math.max(1, canvasWidth);
    const sy = rect.height / Math.max(1, canvasHeight);
    image.setCoords();
    const bounds = image.getBoundingRect();
    const current = info.currentCrop;
    const sourceScaleX = bounds.width / Math.max(1, current.width);
    const sourceScaleY = bounds.height / Math.max(1, current.height);
    const outerLeft = rect.left + bounds.left * sx - current.x * sourceScaleX * sx;
    const outerTop = rect.top + bounds.top * sy - current.y * sourceScaleY * sy;
    setOuter({
      left: outerLeft,
      top: outerTop,
      width: info.sourceWidth * sourceScaleX * sx,
      height: info.sourceHeight * sourceScaleY * sy,
    });
    setCrop({
      left: rect.left + bounds.left * sx,
      top: rect.top + bounds.top * sy,
      width: bounds.width * sx,
      height: bounds.height * sy,
    });
  }, [canvas, canvasHeight, canvasWidth, image, info?.sourceWidth, info?.sourceHeight, objectId]);

  const ratios = [
    { label: "Free", ratio: null },
    { label: "Original", ratio: info ? info.sourceWidth / info.sourceHeight : null },
    { label: "1:1", ratio: 1 },
    { label: "16:9", ratio: 16 / 9 },
    { label: "4:5", ratio: 4 / 5 },
    { label: "9:16", ratio: 9 / 16 },
  ];
  const applyRatio = (ratio: number | null) => {
    if (!crop || !outer || ratio === null) return;
    let width = outer.width;
    let height = width / ratio;
    if (height > outer.height) {
      height = outer.height;
      width = height * ratio;
    }
    setCrop(clampCropToOuter({
      left: outer.left + (outer.width - width) / 2,
      top: outer.top + (outer.height - height) / 2,
      width,
      height,
    }, outer));
  };

  const clampCropToOuter = (nextCrop: CropRect, nextOuter: CropRect) => {
    const width = Math.min(Math.max(24, nextCrop.width), nextOuter.width);
    const height = Math.min(Math.max(24, nextCrop.height), nextOuter.height);
    let left = nextCrop.left;
    let top = nextCrop.top;
    if (left < nextOuter.left) left = nextOuter.left;
    if (top < nextOuter.top) top = nextOuter.top;
    if (left + width > nextOuter.left + nextOuter.width) left = nextOuter.left + nextOuter.width - width;
    if (top + height > nextOuter.top + nextOuter.height) top = nextOuter.top + nextOuter.height - height;
    return { left, top, width, height };
  };

  const commit = () => {
    if (!canvas || !canvasRect || !outer || !crop || !info) return;
    const sx = canvasRect.width / Math.max(1, canvasWidth);
    const sy = canvasRect.height / Math.max(1, canvasHeight);
    const cropPx = {
      unit: "source_px" as const,
      x: ((crop.left - outer.left) / Math.max(1, outer.width)) * info.sourceWidth,
      y: ((crop.top - outer.top) / Math.max(1, outer.height)) * info.sourceHeight,
      width: (crop.width / Math.max(1, outer.width)) * info.sourceWidth,
      height: (crop.height / Math.max(1, outer.height)) * info.sourceHeight,
    };
    cropImageObject(objectId, cropPx, { outputFit: "resize-frame-to-crop" });
    updateSelectedObject({
      left: (crop.left - canvasRect.left) / sx,
      top: (crop.top - canvasRect.top) / sy,
      scaleX: (crop.width / sx) / Math.max(1, cropPx.width),
      scaleY: (crop.height / sy) / Math.max(1, cropPx.height),
    });
    onDone();
  };

  const startDrag = (event: ReactPointerEvent, mode: NonNullable<typeof dragRef.current>["mode"], handle?: string) => {
    if (!outer || !crop) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, handle, startX: event.clientX, startY: event.clientY, outer, crop };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
  };

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.mode === "move-crop") {
      setCrop(clampCropToOuter({ ...drag.crop, left: drag.crop.left + dx, top: drag.crop.top + dy }, drag.outer));
      return;
    }
    if (drag.mode === "resize-crop") {
      setCrop(clampCropToOuter(resizeRect(drag.crop, drag.handle ?? "br", dx, dy, 24, false), drag.outer));
      return;
    }
  };

  const stopDrag = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
  };

  if (!info || !outer || !crop || !src) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <div
        className="pointer-events-none fixed overflow-visible border-2 border-violet-500/90 bg-white/20"
        style={outer}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-fill opacity-55"
        />
      </div>
      <div
        className="pointer-events-auto fixed cursor-move border-2 border-white shadow-[0_0_0_1px_rgb(139_92_246)]"
        style={crop}
        onPointerDown={(event) => startDrag(event, "move-crop")}
      >
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={src}
            alt=""
            draggable={false}
            className="max-w-none select-none"
            style={{
              position: "absolute",
              left: outer.left - crop.left,
              top: outer.top - crop.top,
              width: outer.width,
              height: outer.height,
              objectFit: "fill",
            }}
          />
        </div>
        {["tl", "tr", "bl", "br", "ml", "mr", "mt", "mb"].map((handle) => (
          <CropHandle key={handle} handle={handle} inner onPointerDown={(event) => startDrag(event, "resize-crop", handle)} />
        ))}
      </div>
      <div className="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/[0.12] bg-black/82 px-2 py-2 shadow-[0_20px_80px_rgb(0_0_0_/_0.5)] backdrop-blur-2xl">
        <span className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-black text-white/82">
          <Crop size={15} className="text-emerald-200" />
          Crop
        </span>
        <div className="h-6 w-px bg-white/[0.12]" />
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-bold text-white/56 transition hover:bg-white/[0.08] hover:text-white"
          onClick={onCancel}
        >
          <X size={14} />
          Cancel
        </button>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[12px] font-bold text-white transition hover:bg-accent-hover"
          onClick={commit}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Check size={14} />
          Done
        </button>
      </div>
      <div className="pointer-events-auto absolute bottom-5 left-1/2 w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-white/[0.10] bg-black/84 px-3 py-2 shadow-[0_18px_70px_rgb(0_0_0_/_0.46)] backdrop-blur-2xl">
        <div className="flex items-center justify-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {ratios.map((item) => (
            <button
              key={item.label}
              className="flex h-11 min-w-24 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-[11px] font-bold text-white/62 transition hover:border-accent/45 hover:bg-accent/14 hover:text-white"
              onClick={() => applyRatio(item.ratio)}
            >
              <AspectGlyph ratio={item.ratio} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-center text-[10px] font-semibold text-white/34">
          Move or resize the crop box. Enter applies, Esc cancels.
        </div>
      </div>
    </div>
  );
}

function AspectGlyph({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return <span className="h-4 w-5 rounded border border-dashed border-white/45" />;
  }
  const max = 20;
  const width = ratio >= 1 ? max : Math.max(8, max * ratio);
  const height = ratio >= 1 ? Math.max(8, max / ratio) : max;
  return (
    <span
      className="rounded-sm border border-white/55"
      style={{ width, height }}
    />
  );
}

function CropHandle({
  handle,
  inner,
  onPointerDown,
}: {
  handle: string;
  inner?: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  const x = handle.includes("l") ? "left-0 -translate-x-1/2" : handle.includes("r") ? "right-0 translate-x-1/2" : "left-1/2 -translate-x-1/2";
  const y = handle.includes("t") ? "top-0 -translate-y-1/2" : handle.includes("b") ? "bottom-0 translate-y-1/2" : "top-1/2 -translate-y-1/2";
  const side = handle === "ml" || handle === "mr" ? "h-9 w-2 rounded-full" : handle === "mt" || handle === "mb" ? "h-2 w-9 rounded-full" : "h-4 w-4 rounded-full";
  const cursor =
    handle === "ml" || handle === "mr" ? "cursor-ew-resize" :
    handle === "mt" || handle === "mb" ? "cursor-ns-resize" :
    handle === "tl" || handle === "br" ? "cursor-nwse-resize" :
    "cursor-nesw-resize";
  return (
    <span
      className={`absolute ${x} ${y} ${side} ${cursor} z-20 border ${inner ? "border-white bg-white" : "border-violet-500 bg-white"} shadow-[0_1px_4px_rgb(0_0_0_/_0.25)]`}
      onPointerDown={onPointerDown}
    />
  );
}

function resizeRect(rect: CropRect, handle: string, dx: number, dy: number, min: number, keepAspect: boolean): CropRect {
  let { left, top, width, height } = rect;
  const aspect = width / Math.max(1, height);
  if (handle.includes("l")) {
    left += dx;
    width -= dx;
  }
  if (handle.includes("r")) width += dx;
  if (handle.includes("t")) {
    top += dy;
    height -= dy;
  }
  if (handle.includes("b")) height += dy;
  width = Math.max(min, width);
  height = Math.max(min, height);
  if (keepAspect) {
    if (Math.abs(dx) > Math.abs(dy)) height = width / aspect;
    else width = height * aspect;
  }
  return { left, top, width, height };
}

function ObjectContextMenu({
  x,
  y,
  selectedObject,
  canvasWidth,
  canvasHeight,
  onClose,
  onDuplicate,
  onCopy,
  onPaste,
  onDelete,
  onSetAsBackground,
  onAlign,
  onArrange,
  layerInfo,
}: {
  x: number;
  y: number;
  selectedObject: fabric.FabricObject;
  canvasWidth: number;
  canvasHeight: number;
  onClose: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSetAsBackground: () => void;
  onAlign: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onArrange: (action: "front" | "forward" | "backward" | "back") => void;
  layerInfo: { level: number; min: number; max: number } | null;
}) {
  const bounds = selectedObject.getBoundingRect();
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const states = {
    left: near(bounds.left, 0),
    center: near(bounds.left + bounds.width / 2, canvasWidth / 2),
    right: near(bounds.left + bounds.width, canvasWidth),
    top: near(bounds.top, 0),
    middle: near(bounds.top + bounds.height / 2, canvasHeight / 2),
    bottom: near(bounds.top + bounds.height, canvasHeight),
  };
  const canSetAsBackground =
    selectedObject instanceof fabric.FabricImage &&
    !(selectedObject as any)._isBgImage &&
    (selectedObject as any).kaveroKind !== "background-image" &&
    !Boolean((selectedObject as any).kaveroBgSrc);

  const itemClass =
    "flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] font-semibold text-white/72 transition hover:bg-white/[0.09] hover:text-white disabled:pointer-events-none disabled:opacity-35";
  const alignItems: {
    key: "left" | "center" | "right" | "top" | "middle" | "bottom";
    label: string;
    disabled: boolean;
    icon: LucideIcon;
  }[] = [
    { key: "left", label: "Left", disabled: states.left, icon: AlignHorizontalJustifyStart },
    { key: "center", label: "Center", disabled: states.center, icon: AlignHorizontalJustifyCenter },
    { key: "right", label: "Right", disabled: states.right, icon: AlignHorizontalJustifyEnd },
    { key: "top", label: "Top", disabled: states.top, icon: AlignVerticalJustifyStart },
    { key: "middle", label: "Middle", disabled: states.middle, icon: AlignVerticalJustifyCenter },
    { key: "bottom", label: "Bottom", disabled: states.bottom, icon: AlignVerticalJustifyEnd },
  ];
  const layerItems: {
    key: "front" | "forward" | "backward" | "back";
    label: string;
    disabled: boolean;
    icon: LucideIcon;
    shortcut: string;
  }[] = [
    { key: "front", label: "Bring to front", disabled: layerInfo ? layerInfo.level >= layerInfo.max : true, icon: BringToFront, shortcut: "Ctrl+Alt+]" },
    { key: "forward", label: "Bring forward", disabled: layerInfo ? layerInfo.level >= layerInfo.max : true, icon: BringToFront, shortcut: "Ctrl+]" },
    { key: "backward", label: "Send backward", disabled: layerInfo ? layerInfo.level <= layerInfo.min : true, icon: SendToBack, shortcut: "Ctrl+[" },
    { key: "back", label: "Send to back", disabled: layerInfo ? layerInfo.level <= layerInfo.min : true, icon: SendToBack, shortcut: "Ctrl+Alt+[" },
  ];

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="fixed z-[80] min-w-[230px] rounded-2xl border border-white/[0.12] bg-black/84 p-1.5 text-white shadow-[0_28px_90px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-2xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="group relative">
        <button className={itemClass}>
          <Layers size={16} className="text-white/58" />
          Layer
          {layerInfo ? <span className="ml-auto font-mono text-[11px] text-white/38">{layerInfo.level}</span> : null}
          <span className="text-white/42">›</span>
        </button>
        <div className="invisible absolute left-full top-0 ml-1 min-w-[210px] rounded-2xl border border-white/[0.12] bg-black/88 p-1.5 opacity-0 shadow-[0_24px_80px_rgb(0_0_0_/_0.58)] backdrop-blur-2xl transition group-hover:visible group-hover:opacity-100">
          {layerItems.map(({ key, label, disabled, icon: Icon, shortcut }) => (
            <button
              key={key}
              className={itemClass}
              disabled={disabled}
              onClick={() => run(() => onArrange(key))}
            >
              <Icon size={16} className="text-white/58" />
              {label}
              <span className="ml-auto text-[11px] text-white/38">{shortcut}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="group relative">
        <button className={itemClass}>
          <AlignCenter size={16} className="text-white/58" />
          Align to page
          <span className="ml-auto text-white/42">›</span>
        </button>
        <div className="invisible absolute left-full top-0 ml-1 min-w-[170px] rounded-2xl border border-white/[0.12] bg-black/88 p-1.5 opacity-0 shadow-[0_24px_80px_rgb(0_0_0_/_0.58)] backdrop-blur-2xl transition group-hover:visible group-hover:opacity-100">
          {alignItems.map(({ key, label, disabled, icon: Icon }) => (
            <button
              key={key}
              className={itemClass}
              disabled={disabled}
              onClick={() => run(() => onAlign(key))}
            >
              <Icon size={16} className="text-white/58" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="my-1 h-px bg-white/[0.1]" />
      {canSetAsBackground ? (
        <>
          <button className={itemClass} onClick={() => run(onSetAsBackground)}>
            <ImageIcon size={16} className="text-white/58" />
            Set as background
          </button>
          <div className="my-1 h-px bg-white/[0.1]" />
        </>
      ) : null}
      <button className={itemClass} onClick={() => run(onCopy)}>
        <Copy size={16} className="text-white/58" />
        Copy <span className="ml-auto text-[11px] text-white/38">Ctrl+C</span>
      </button>
      <button className={itemClass} onClick={() => run(onPaste)}>
        <Clipboard size={16} className="text-white/58" />
        Paste <span className="ml-auto text-[11px] text-white/38">Ctrl+V</span>
      </button>
      <button className={itemClass} onClick={() => run(onDuplicate)}>
        <Files size={16} className="text-white/58" />
        Duplicate <span className="ml-auto text-[11px] text-white/38">Ctrl+D</span>
      </button>
      <div className="my-1 h-px bg-white/[0.1]" />
      <button className={`${itemClass} hover:bg-red-500/16 hover:text-red-100`} onClick={() => run(onDelete)}>
        <Trash2 size={16} className="text-red-100/62" />
        Delete <span className="ml-auto text-[11px] text-white/38">Del</span>
      </button>
    </div>
  );
}
