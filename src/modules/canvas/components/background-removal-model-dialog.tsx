import { useEffect, useRef, useState } from "react";
import { Check, Cpu, HardDriveUpload, Trash2, X } from "lucide-react";
import {
  deleteImportedBackgroundRemovalModel,
  formatModelSize,
  importBackgroundRemovalModel,
  type BackgroundRemovalModel,
  type BackgroundRemovalPreprocessing,
} from "@/modules/assets/background-removal";

export function BackgroundRemovalModelDialog({
  open,
  models,
  selectedModelId,
  onClose,
  onSelect,
  onModelsChanged,
  onError,
}: {
  open: boolean;
  models: BackgroundRemovalModel[];
  selectedModelId: string;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  onModelsChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [preprocessing, setPreprocessing] = useState<BackgroundRemovalPreprocessing>("imagenet");
  const [fallbackInputSize, setFallbackInputSize] = useState(1024);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const importModel = async () => {
    if (!file) {
      onError("Choose an ONNX model to import.");
      return;
    }
    setBusy(true);
    try {
      const model = await importBackgroundRemovalModel({ file, name, preprocessing, fallbackInputSize });
      await onModelsChanged();
      onSelect(model.id);
      setFile(null);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to import that ONNX model.");
    } finally {
      setBusy(false);
    }
  };

  const deleteModel = async (model: BackgroundRemovalModel) => {
    setBusy(true);
    try {
      await deleteImportedBackgroundRemovalModel(model.id);
      await onModelsChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to delete that imported model.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/72 px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-removal-model-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="max-h-[min(760px,calc(100vh-32px))] w-full max-w-[660px] overflow-y-auto rounded-3xl border border-white/[0.12] bg-zinc-950/96 text-white shadow-[0_36px_140px_rgb(0_0_0_/_0.78)]">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.09] bg-zinc-950/94 px-6 py-5 backdrop-blur-xl">
          <div>
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-accent">Browser models</p>
            <h2 id="background-removal-model-title" className="text-xl font-black tracking-tight">
              Background removal model
            </h2>
            <p className="mt-1 text-sm text-white/48">Models run locally and hot-swap when selected.</p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-white/56 transition hover:bg-white/[0.09] hover:text-white"
            onClick={onClose}
            aria-label="Close model manager"
          >
            <X size={17} />
          </button>
        </header>

        <div className="space-y-6 p-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {models.map((model) => {
              const selected = model.id === selectedModelId;
              return (
                <div key={model.id} className="relative">
                  <button
                    className={`flex min-h-[92px] w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
                      selected
                        ? "border-accent/65 bg-accent/12 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.18)]"
                        : "border-white/[0.09] bg-white/[0.035] hover:border-white/[0.17] hover:bg-white/[0.06]"
                    }`}
                    onClick={() => onSelect(model.id)}
                  >
                    <span
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                        selected ? "bg-accent text-white" : "bg-white/[0.07] text-white/48"
                      }`}
                    >
                      {selected ? <Check size={15} strokeWidth={3} /> : <Cpu size={15} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-white/88">{model.name}</span>
                      <span className="mt-1 block text-xs leading-5 text-white/43">{model.description}</span>
                      <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-white/28">
                        {model.source === "builtin" ? "Built in · lazy download" : model.fileName}
                      </span>
                    </span>
                  </button>
                  {model.source === "imported" ? (
                    <button
                      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-white/30 transition hover:bg-red-500/15 hover:text-red-200 disabled:opacity-30"
                      onClick={() => void deleteModel(model)}
                      disabled={busy}
                      aria-label={`Delete ${model.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
            <div className="mb-4 flex items-center gap-2">
              <HardDriveUpload size={17} className="text-accent" />
              <h3 className="text-sm font-black">Import compatible ONNX</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-white/48">
                Model file
                <input
                  ref={fileRef}
                  type="file"
                  accept=".onnx,application/octet-stream"
                  className="mt-2 block w-full rounded-xl border border-white/[0.1] bg-black/36 px-3 py-2.5 text-xs text-white/66 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:font-bold file:text-white/72"
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0] ?? null;
                    setFile(nextFile);
                    if (nextFile && !name) setName(nextFile.name.replace(/\.onnx$/i, ""));
                  }}
                />
              </label>
              <label className="text-xs font-bold text-white/48">
                Display name
                <input
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  maxLength={80}
                  placeholder="My background model"
                  className="mt-2 h-[42px] w-full rounded-xl border border-white/[0.1] bg-black/36 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-accent/55"
                />
              </label>
            </div>
            <fieldset className="mt-4">
              <legend className="text-xs font-bold text-white/48">Input preprocessing</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([
                  ["imagenet", "ImageNet RGB", "BiRefNet and many general segmenters"],
                  ["zero-to-one", "0–1 RGB", "IS-Net and Open RMBG-style exports"],
                ] as const).map(([value, label, help]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      preprocessing === value
                        ? "border-accent/55 bg-accent/10"
                        : "border-white/[0.09] bg-black/24 hover:bg-white/[0.04]"
                    }`}
                    onClick={() => setPreprocessing(value)}
                  >
                    <span className="block text-xs font-black text-white/78">{label}</span>
                    <span className="mt-0.5 block text-[10px] text-white/35">{help}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="mt-4 block text-xs font-bold text-white/48">
              Fallback input size
              <select
                value={fallbackInputSize}
                onChange={(event) => setFallbackInputSize(Number(event.currentTarget.value))}
                className="mt-2 h-[42px] w-full rounded-xl border border-white/[0.1] bg-black/36 px-3 text-sm text-white outline-none focus:border-accent/55"
              >
                <option value={320}>320 × 320</option>
                <option value={512}>512 × 512</option>
                <option value={1024}>1024 × 1024</option>
              </select>
              <span className="mt-1.5 block text-[10px] font-normal leading-4 text-white/32">
                Used only when the ONNX model does not declare static input dimensions.
              </span>
            </label>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-[11px] leading-5 text-white/34">
                NCHW RGB input and a one-channel float foreground mask are required. Maximum file size: {formatModelSize(512 * 1024 * 1024)}.
              </p>
              <button
                className="h-10 shrink-0 rounded-xl bg-accent px-4 text-xs font-black text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => void importModel()}
                disabled={busy || !file}
              >
                {busy ? "Saving…" : "Import model"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
