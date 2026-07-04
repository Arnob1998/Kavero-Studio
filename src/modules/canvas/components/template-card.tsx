import { useState, useEffect, useRef } from "react";
import * as fabric from "fabric";
import { normalizeCanvasImageSources } from "@/modules/canvas/hooks/use-canvas";
import type { Template } from "@/modules/canvas/types/editor-types";

interface Props {
  template: Template;
  onClick: () => void;
}

export function TemplateCard({ template, onClick }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (rendered.current) return;
    rendered.current = true;

    const el = document.createElement("canvas");
    const tempCanvas = new fabric.StaticCanvas(el, {
      width: template.width,
      height: template.height,
    });

    try {
      const parsed = normalizeCanvasImageSources(JSON.parse(template.canvas_json));
      tempCanvas.loadFromJSON(parsed).then(() => {
        tempCanvas.renderAll();
        // Render at 400px wide for crisp retina thumbnails
        const targetPx = 400;
        const multiplier = Math.min(targetPx / template.width, targetPx / template.height, 1);
        const dataUrl = tempCanvas.toDataURL({
          format: "png",
          multiplier,
        });
        setPreview(dataUrl);
        tempCanvas.dispose();
      });
    } catch {
      tempCanvas.dispose();
    }
  }, [template]);

  return (
    <button
      className="group relative overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.045] p-0 text-left shadow-[0_18px_60px_rgb(0_0_0_/_0.28),inset_0_1px_0_rgb(255_255_255_/_0.045)] transition hover:border-white/[0.2] hover:bg-white/[0.065]"
      onClick={onClick}
    >
      {/* Preview area */}
      <div
        className="flex w-full items-center justify-center overflow-hidden bg-black/36"
        style={{ aspectRatio: `${template.width} / ${template.height}` }}
      >
        {preview ? (
          <img
            src={preview}
            alt={template.name}
            className="h-full w-full object-contain opacity-90 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-100"
          />
        ) : (
          <span className="text-[10px] font-semibold text-white/42">Loading...</span>
        )}
      </div>
      {/* Label */}
      <div className="border-t border-white/[0.08] bg-black/18 px-3 py-2">
        <span className="block truncate text-[12px] font-semibold text-white/72">
          {template.name}
        </span>
        <span className="text-[10px] font-medium text-white/38">
          {template.width}&times;{template.height}
        </span>
      </div>
    </button>
  );
}
