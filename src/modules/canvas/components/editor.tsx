import { CanvasArea } from "@/modules/canvas/components/canvas-area";
import { Toolbar } from "@/modules/canvas/components/toolbar";
import { LeftSidebar } from "@/modules/canvas/components/left-sidebar";
import { RightSidebar } from "@/modules/canvas/components/right-sidebar";
import { PagesBar } from "@/modules/canvas/components/pages-bar";
import { useEditor } from "@/modules/canvas/state/context";
import { Crop, Keyboard, RotateCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as fabric from "fabric";

export function Editor() {
  const { error, clearError, selectedObject, startImageCropMode, resetImageCrop } = useEditor();
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const selectedObjectId = selectedObject ? String((selectedObject as any).kaveroId ?? "") : "";
  const canCropImage = selectedObject instanceof fabric.FabricImage && Boolean(selectedObjectId);

  useEffect(() => {
    const open = () => setCommandOpen(true);
    const keydown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("kavero:open-command-palette", open);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("kavero:open-command-palette", open);
      window.removeEventListener("keydown", keydown);
    };
  }, []);

  const commands = useMemo(() => [
    {
      label: "Crop selected image",
      shortcut: "Double-click / Ctrl+drag",
      icon: Crop,
      disabled: !canCropImage,
      run: () => startImageCropMode(),
    },
    {
      label: "Reset selected image crop",
      shortcut: "",
      icon: RotateCw,
      disabled: !canCropImage,
      run: () => {
        if (selectedObjectId) resetImageCrop(selectedObjectId);
      },
    },
    {
      label: "Show crop shortcuts",
      shortcut: "Enter / Esc",
      icon: Keyboard,
      disabled: false,
      run: () => undefined,
    },
  ], [canCropImage, resetImageCrop, selectedObjectId, startImageCropMode]);
  const visibleCommands = commands.filter((command) => command.label.toLowerCase().includes(commandQuery.trim().toLowerCase()));

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#030304] text-white [isolation:isolate]">
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,rgb(59_130_246_/_0.15),transparent_34%),radial-gradient(circle_at_8%_78%,rgb(255_255_255_/_0.06),transparent_24%),linear-gradient(180deg,rgb(3_3_4),rgb(7_7_10)_42%,rgb(3_3_4))]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-35 [background-image:radial-gradient(circle,rgb(255_255_255_/_0.22)_1px,transparent_1.5px)] [background-size:24px_24px]"
        aria-hidden="true"
      />
      {error && (
        <div className="absolute right-4 top-12 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-white/[0.14] bg-white/[0.08] px-4 py-3 text-[13px] font-normal leading-5 text-white/76 shadow-[0_24px_80px_rgb(0_0_0_/_0.48),inset_0_1px_0_rgb(255_255_255_/_0.11)] backdrop-blur-2xl">
          <span>{error}</span>
          <button
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white/42 transition hover:bg-white/[0.08] hover:text-white"
            onClick={clearError}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
        <LeftSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <CanvasArea />
          <PagesBar />
        </div>
        <RightSidebar />
        </div>
      </div>
      {commandOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/48 backdrop-blur-sm" onPointerDown={() => setCommandOpen(false)}>
          <div
            className="mx-auto mt-24 w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-white/[0.14] bg-[#070708] shadow-[0_30px_120px_rgb(0_0_0_/_0.72),inset_0_1px_0_rgb(255_255_255_/_0.08)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 items-center gap-3 border-b border-white/[0.08] px-4">
              <Search size={16} className="text-white/42" />
              <input
                className="h-full flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/32"
                placeholder="Search commands"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCommandOpen(false);
                  if (event.key === "Enter" && visibleCommands[0] && !visibleCommands[0].disabled) {
                    visibleCommands[0].run();
                    setCommandOpen(false);
                  }
                }}
                autoFocus
              />
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {visibleCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <button
                    key={command.label}
                    className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-35"
                    disabled={command.disabled}
                    onClick={() => {
                      command.run();
                      setCommandOpen(false);
                    }}
                  >
                    <Icon size={16} className="text-white/46" />
                    {command.label}
                    {command.shortcut ? <span className="ml-auto text-[11px] text-white/38">{command.shortcut}</span> : null}
                  </button>
                );
              })}
              <div className="px-3 py-2 text-[11px] font-semibold leading-5 text-white/34">
                Crop: double-click an image, Ctrl/Cmd+drag image edges, Enter applies, Esc exits.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
