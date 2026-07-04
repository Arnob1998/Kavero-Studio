import { useRef, useEffect } from "react";
import * as fabric from "fabric";
import { useEditor } from "@/modules/canvas/state/context";
import { normalizeCanvasImageSources } from "@/modules/canvas/state/scene-snapshot";
import type { Page } from "@/modules/canvas/types/editor-types";

interface PageCanvasProps {
  page: Page;
  isActive: boolean;
  width: number;
  height: number;
  onActivate: () => void;
}

export function PageCanvas({ page, isActive, width, height, onActivate }: PageCanvasProps) {
  const { registerCanvas, unregisterCanvas, showError } = useEditor();
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;

    const c = new fabric.Canvas(canvasElRef.current, {
      width,
      height,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      controlsAboveOverlay: true,
    });

    c.setDimensions({ width, height }, { cssOnly: false });
    c.setDimensions({ width, height }, { cssOnly: true });
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Custom control appearance — applied per-object via object:added
    const CONTROL_STYLE = {
      transparentCorners: false,
      borderColor: "#60A5FA",
      borderScaleFactor: 1.8,
      padding: 6,
      cornerSize: 14,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#60A5FA",
      cornerStyle: "circle" as const,
      rotatingPointOffset: 42,
    };

    // Custom render for corner controls (white circles with accent stroke)
    const renderCircleCorner = (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number,
      _styleOverride: unknown,
      _fabricObject: fabric.FabricObject,
    ) => {
      const size = 14;
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = String((_fabricObject as any).cornerColor ?? "#ffffff");
      ctx.strokeStyle = String((_fabricObject as any).cornerStrokeColor ?? "#60A5FA");
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // Custom render for side controls (rounded pill handles)
    const renderPillControl = (horizontal: boolean) => {
      return (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        _styleOverride: unknown,
        _fabricObject: fabric.FabricObject,
      ) => {
        const w = horizontal ? 28 : 8;
        const h = horizontal ? 8 : 28;
        ctx.save();
        ctx.translate(left, top);
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 4);
        ctx.fillStyle = String((_fabricObject as any).cornerColor ?? "#ffffff");
        ctx.strokeStyle = String((_fabricObject as any).cornerStrokeColor ?? "#60A5FA");
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
    };

    const renderRotateControl = (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number,
      _styleOverride: unknown,
      _fabricObject: fabric.FabricObject,
    ) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#111827";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // Apply custom controls to an object
    const applyCustomControls = (obj: fabric.FabricObject) => {
      obj.set(CONTROL_STYLE);
      // Override corner renders
      if (obj.controls) {
        for (const key of ["tl", "tr", "bl", "br"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderCircleCorner;
            obj.controls[key].sizeX = 18;
            obj.controls[key].sizeY = 18;
          }
        }
        for (const key of ["mt", "mb"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderPillControl(true);
            obj.controls[key].sizeX = 32;
            obj.controls[key].sizeY = 12;
          }
        }
        for (const key of ["ml", "mr"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderPillControl(false);
            obj.controls[key].sizeX = 12;
            obj.controls[key].sizeY = 32;
          }
        }
        if (obj.controls.mtr) {
          obj.controls.mtr.render = renderRotateControl;
          obj.controls.mtr.sizeX = 22;
          obj.controls.mtr.sizeY = 22;
          obj.controls.mtr.offsetY = -42;
        }
      }
    };

    // Apply to all existing objects
    c.getObjects().forEach(applyCustomControls);

    // Apply to any newly added objects
    c.on("object:added", (e) => {
      if (e.target) applyCustomControls(e.target);
    });

    let disposed = false;
    let registered = false;

    // Load page content before registering history listeners so initial JSON does not create edits.
    let loadPromise: Promise<unknown> = Promise.resolve();
    if (page.canvas_json && page.canvas_json !== "{}") {
      try {
        loadPromise = c
          .loadFromJSON(normalizeCanvasImageSources(JSON.parse(page.canvas_json)))
          .then(() => {
            if (disposed || c.disposed) return;
            c.setDimensions({ width, height }, { cssOnly: false });
            c.setDimensions({ width, height }, { cssOnly: true });
            c.setViewportTransform([1, 0, 0, 1, 0, 0]);
            c.requestRenderAll();
          })
          .catch((error) => {
            if (disposed || c.disposed) return;
            console.error("Unable to load page canvas JSON:", error);
            showError("Unable to load one canvas page. Check that stored assets are still available.");
          });
      } catch {
        showError("Unable to parse one canvas page.");
      }
    }

    // On mouse down, activate this canvas (use ref to avoid stale closure)
    c.on("mouse:down", () => onActivateRef.current());

    void loadPromise.finally(() => {
      if (disposed) return;
      fabricRef.current = c;
      registerCanvas(page.id, c);
      registered = true;
    });

    return () => {
      disposed = true;
      if (registered) unregisterCanvas(page.id);
      void c.dispose();
      fabricRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || canvas.disposed) return;
    canvas.setDimensions({ width, height }, { cssOnly: false });
    canvas.setDimensions({ width, height }, { cssOnly: true });
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.requestRenderAll();
  }, [width, height]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-[linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%)] bg-[length:24px_24px] bg-[position:0_0,12px_12px] shadow-[0_36px_130px_rgb(0_0_0_/_0.58)] ${
        isActive
          ? "border-accent/70 ring-2 ring-accent/55 ring-offset-4 ring-offset-black/50"
          : "border-white/[0.12] hover:border-white/[0.2]"
      }`}
      style={{ width, height }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
}
