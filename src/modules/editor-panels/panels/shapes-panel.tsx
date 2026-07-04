import { Circle, Minus, Square, Triangle } from "lucide-react";

type ShapeType = "rect" | "circle" | "triangle" | "line";

export function ShapesPanel({ addShape }: { addShape: (type: ShapeType) => void }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold text-white/38">Click to add a shape</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { type: "rect" as const, icon: Square, label: "Rectangle" },
          { type: "circle" as const, icon: Circle, label: "Circle" },
          { type: "triangle" as const, icon: Triangle, label: "Triangle" },
          { type: "line" as const, icon: Minus, label: "Line" },
        ].map((shape) => (
          <button
            key={shape.type}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 transition-all hover:border-accent/45 hover:bg-accent/10"
            onClick={() => addShape(shape.type)}
          >
            <shape.icon size={24} className="text-white/54" />
            <span className="text-[11px] font-semibold text-white/48">{shape.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
