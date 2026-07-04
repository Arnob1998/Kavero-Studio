import { Bot, Layers, Network, ScanSearch, Sparkles, Square, Type, Upload } from "lucide-react";
import type { EditorPanelDefinition, EditorPanelId } from "./types";

export const editorPanels = [
  { id: "shapes", icon: Square, label: "Elements", title: "Elements", feature: "canvas", width: 240 },
  { id: "text", icon: Type, label: "Text", title: "Text", feature: "canvas", width: 240 },
  { id: "generate", icon: Sparkles, label: "Generate", title: "Generate", feature: "canvasGeneration", width: 360 },
  { id: "images", icon: Upload, label: "Uploads", title: "Uploads", feature: "canvasAssets", width: 240 },
  { id: "autoSegment", icon: ScanSearch, label: "Segment", title: "Auto Segment", feature: "autoSegment", width: 360 },
  { id: "layers", icon: Layers, label: "Layers", title: "Layers", feature: "canvas", width: 240 },
  { id: "relations", icon: Network, label: "Relations", title: "Relations", feature: "canvas", width: 240 },
  { id: "copilot", icon: Bot, label: "Copilot", title: "Copilot", feature: "copilot", width: 360 },
] as const satisfies readonly EditorPanelDefinition[];

export function getEditorPanel(id: EditorPanelId) {
  return editorPanels.find((panel) => panel.id === id) ?? null;
}
