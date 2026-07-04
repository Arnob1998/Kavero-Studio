import { useEffect, useMemo, useState, useCallback } from "react";
import type { MouseEvent } from "react";
import {
  Check,
  CircleAlert,
  Edit3,
  FileStack,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { Design } from "@/modules/canvas/types/editor-types";
import { brand } from "@/lib/brand";
import type { CanvasAsset } from "@/modules/assets/canvas-assets";
import { getCanvasAssetDisplayStatus } from "@/modules/assets/canvas-asset-status";

interface HomeProps {
  designs: Design[];
  navigate: (to: string) => void;
  createDesign: () => Promise<string | undefined>;
  deleteDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  error?: string | null;
  clearError?: () => void;
}

interface CanvasAssetsResponse {
  assets: CanvasAsset[];
  usage: {
    designs: number;
    pages: number;
    assets: number;
    assetBytes: number;
  };
  limits: {
    designsPerUser: number;
    pagesPerDesign: number;
    canvasJsonBytesPerPage: number;
    driveAssetsPerUser: number;
    driveAssetBytesPerFile: number;
  };
}

const glassPanelClass =
  "border border-white/[0.1] bg-white/[0.045] shadow-[0_24px_90px_rgb(0_0_0_/_0.38),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl";

const featureTiles = [
  { label: "Canvas", detail: "Design editor", icon: LayoutGrid },
  { label: "Image", detail: "Canvas assets", icon: ImageIcon },
  { label: "Upscale", detail: "Coming soon", icon: Maximize2 },
  { label: "AI Edit", detail: "Coming soon", icon: WandSparkles },
  { label: "More", detail: "Coming soon", icon: Sparkles },
];

const EMPTY_ASSETS: CanvasAsset[] = [];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function percent(value: number, limit: number | null | undefined) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

export function Home({
  designs,
  navigate,
  createDesign,
  deleteDesign,
  renameDesign,
  error,
  clearError,
}: HomeProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [assetsState, setAssetsState] = useState<CanvasAssetsResponse | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [deletingAssetIds, setDeletingAssetIds] = useState<string[]>([]);
  const [assetPendingDelete, setAssetPendingDelete] = useState<CanvasAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);

  const loadAssets = useCallback(async () => {
    try {
      setAssetError(null);
      const response = await fetch("/api/canvas/assets", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as CanvasAssetsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load canvas assets.");
      setAssetsState(payload);
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : "Unable to load canvas assets.");
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const handleCreate = useCallback(async () => {
    try {
      const id = await createDesign();
      if (id) navigate(`/design/${id}`);
    } catch {
      // useDesigns reports API failures through the shared editor error state.
    }
  }, [createDesign, navigate]);

  const startRename = (id: string, name: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setEditingId(id);
    setEditName(name);
  };

  const finishRename = () => {
    if (editingId && editName.trim()) void renameDesign(editingId, editName.trim());
    setEditingId(null);
  };

  const deleteAsset = async (asset: CanvasAsset) => {
    setDeletingAssetId(asset.id);
    try {
      setAssetError(null);
      const response = await fetch(`/api/canvas/assets/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete canvas asset.");
      setAssetPendingDelete([]);
      setSelectedAssetIds((current) => current.filter((id) => id !== asset.id));
      await loadAssets();
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : "Unable to delete canvas asset.");
    } finally {
      setDeletingAssetId(null);
    }
  };

  const deleteAssets = async (assetsToDelete: CanvasAsset[]) => {
    const ids = assetsToDelete.map((asset) => asset.id);
    setDeletingAssetIds(ids);
    try {
      setAssetError(null);
      const response = await fetch("/api/canvas/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: ids }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete selected canvas assets.");
      setAssetPendingDelete([]);
      setSelectedAssetIds((current) => current.filter((id) => !ids.includes(id)));
      await loadAssets();
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : "Unable to delete selected canvas assets.");
    } finally {
      setDeletingAssetIds([]);
    }
  };

  const limits = assetsState?.limits;
  const usage = assetsState?.usage;
  const assets = assetsState?.assets ?? EMPTY_ASSETS;
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.includes(asset.id)),
    [assets, selectedAssetIds],
  );

  useEffect(() => {
    setSelectedAssetIds((current) => {
      const next = current.filter((id) => assets.some((asset) => asset.id === id));
      return next.length === current.length ? current : next;
    });
  }, [assets]);

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  };

  const selectAllAssets = () => {
    setSelectedAssetIds(assets.map((asset) => asset.id));
  };

  const clearAssetSelection = () => {
    setSelectedAssetIds([]);
  };
  const quotaCards = useMemo(
    () => [
      {
        label: "Designs",
        value: `${designs.length}/${limits?.designsPerUser ?? 3}`,
        detail: "Premium workspace limit",
        icon: LayoutGrid,
        progress: percent(designs.length, limits?.designsPerUser ?? 3),
      },
      {
        label: "Pages",
        value: `${usage?.pages ?? 0}`,
        detail: `${limits?.pagesPerDesign ?? 5} pages per design`,
        icon: FileStack,
        progress: 0,
      },
      {
        label: "Assets",
        value: `${usage?.assets ?? assets.length}/${limits?.driveAssetsPerUser ?? 200}`,
        detail: "Delete assets to free slots",
        icon: ImageIcon,
        progress: percent(usage?.assets ?? assets.length, limits?.driveAssetsPerUser ?? 200),
      },
      {
        label: "Storage",
        value: formatBytes(usage?.assetBytes ?? 0),
        detail: `${formatBytes(limits?.driveAssetBytesPerFile ?? 10 * 1024 * 1024)} max per file`,
        icon: HardDrive,
        progress: 0,
      },
    ],
    [assets.length, designs.length, limits, usage],
  );

  return (
    <main className="h-svh overflow-y-auto overscroll-contain bg-[#030304] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[#030304]"
        aria-hidden="true"
      />
      <section className="relative z-10 mx-auto w-full max-w-[1600px] px-4 pb-14 pt-4 sm:px-5 lg:px-6">
        <Hero onCreate={handleCreate} />

        {error ? (
          <div className="fixed right-4 top-4 z-50 flex max-w-[420px] items-start gap-3 rounded-2xl border border-white/[0.14] bg-white/[0.08] px-4 py-3 text-[13px] leading-5 text-white/76 shadow-[0_24px_90px_rgb(0_0_0_/_0.48),inset_0_1px_0_rgb(255_255_255_/_0.11)] backdrop-blur-2xl">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-accent">
              <CircleAlert size={17} />
            </span>
            <span className="min-w-0 flex-1">{error}</span>
            {clearError ? (
              <button
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/42 transition hover:bg-white/[0.08] hover:text-white"
                onClick={clearError}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="relative z-20 mx-auto -mt-12 mb-10 flex w-full max-w-[880px] justify-center px-2">
          <div className="grid w-full grid-cols-5 overflow-hidden rounded-[28px] border border-white/[0.1] bg-black/72 shadow-[0_24px_90px_rgb(105_101_253_/_0.18),inset_0_1px_0_rgb(255_255_255_/_0.07)] backdrop-blur-2xl">
            {featureTiles.map(({ label, detail, icon: Icon }, index) => (
              <button
                key={label}
                className={`group relative grid min-h-[88px] place-items-center gap-1 border-r border-white/[0.08] px-2 py-3 text-center transition hover:bg-white/[0.07] ${
                  index === 0 ? "bg-white/[0.08]" : ""
                } ${index === featureTiles.length - 1 ? "border-r-0" : ""}`}
                onClick={handleCreate}
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.055] text-white/82 transition group-hover:bg-accent/18 group-hover:text-accent">
                  <Icon size={18} />
                </span>
                <span className="text-[12px] font-bold text-white/82">{label}</span>
                <span className="hidden text-[10px] font-semibold text-white/34 sm:block">{detail}</span>
              </button>
            ))}
          </div>
        </div>

        {assetError ? (
          <div className="mb-6 rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-[13px] font-semibold leading-5 text-red-100">
            {assetError}
          </div>
        ) : null}

        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quotaCards.map(({ label, value, detail, icon: Icon, progress }) => (
            <section key={label} className={`${glassPanelClass} rounded-2xl p-4`}>
              <div className="mb-4 flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.055] text-white/58">
                  <Icon size={18} />
                </span>
                <span className="text-[11px] font-black uppercase tracking-[0.08em] text-white/34">
                  {label}
                </span>
              </div>
              <p className="m-0 text-2xl font-light text-white">{value}</p>
              <p className="m-0 mt-1 text-[12px] font-medium text-white/42">{detail}</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </section>
          ))}
        </div>

        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="m-0 text-[26px] font-normal text-white">Recent</h2>
          <span className="text-[12px] font-medium text-white/38">
            {designs.length} design{designs.length === 1 ? "" : "s"}
          </span>
        </div>

        <section className="mb-10">
          {designs.length === 0 ? (
            <EmptyPanel
              icon={LayoutGrid}
              title="No designs yet"
              description="Create your first design to start using the Canvas workspace."
              actionLabel="Create design"
              onAction={handleCreate}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {designs.map((design) => (
                <DesignCard
                  key={design.id}
                  design={design}
                  editing={editingId === design.id}
                  editName={editName}
                  onEditNameChange={setEditName}
                  onOpen={() => navigate(`/design/${design.id}`)}
                  onRename={(event) => startRename(design.id, design.name, event)}
                  onFinishRename={finishRename}
                  onCancelRename={() => setEditingId(null)}
                  onDelete={() => void deleteDesign(design.id)}
                />
              ))}
            </div>
          )}
        </section>

        <AssetStorageStrip
          assets={assets}
          deletingAssetId={deletingAssetId}
          deletingAssetIds={deletingAssetIds}
          selectedAssetIds={selectedAssetIds}
          onToggleSelect={toggleAssetSelection}
          onSelectAll={selectAllAssets}
          onClearSelection={clearAssetSelection}
          onDelete={setAssetPendingDelete}
          onDeleteBulk={() => setAssetPendingDelete(selectedAssets.length > 0 ? selectedAssets : assets)}
          onRefresh={loadAssets}
        />
      </section>
      <DeleteAssetDialog
        asset={assetPendingDelete}
        deleting={
          assetPendingDelete.length === 1
            ? deletingAssetId === assetPendingDelete[0]?.id
            : assetPendingDelete.some((asset) => deletingAssetIds.includes(asset.id))
        }
        onCancel={() => setAssetPendingDelete([])}
        onConfirm={() => {
          if (assetPendingDelete.length === 1) void deleteAsset(assetPendingDelete[0]);
          if (assetPendingDelete.length > 1) void deleteAssets(assetPendingDelete);
        }}
      />
    </main>
  );
}

function Hero({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-black/42 shadow-[0_30px_140px_rgb(0_0_0_/_0.7),inset_0_1px_0_rgb(255_255_255_/_0.07)]">
      <img
        className="absolute inset-0 h-full w-full object-cover opacity-[0.8]"
        src="/bg-image-assets/City Animated Digital Wallpaper Cyberpunk Neon 2k.jpg"
        alt=""
      />
      <div className="absolute inset-0 bg-black/56" aria-hidden="true" />
      <div className="relative z-10 flex min-h-[320px] items-center px-6 pb-20 pt-8 sm:px-9 lg:min-h-[380px] lg:px-12">
        <div className="max-w-[820px]">
          <span className="mb-5 inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.055] px-3 text-[12px] font-black uppercase tracking-[0.08em] text-white/58 backdrop-blur-xl">
            <Sparkles size={14} className="text-accent" />
            Canvas workspace
          </span>
          <h1 className="m-0 text-[clamp(48px,7vw,96px)] font-light leading-[0.95] tracking-normal text-white">
            {brand.name} Canvas
          </h1>
          <p className="mt-5 max-w-[58ch] text-[17px] font-normal leading-8 text-white/64">
            Create, manage, and clean up stored design assets from one premium workspace.
          </p>
          <button
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-bold text-white shadow-[0_16px_44px_rgb(59_130_246_/_0.24)] transition hover:bg-accent-hover"
            onClick={onCreate}
          >
            <Plus size={17} />
            New design
          </button>
        </div>
      </div>
    </section>
  );
}

function DesignCard({
  design,
  editing,
  editName,
  onEditNameChange,
  onOpen,
  onRename,
  onFinishRename,
  onCancelRename,
  onDelete,
}: {
  design: Design;
  editing: boolean;
  editName: string;
  onEditNameChange: (value: string) => void;
  onOpen: () => void;
  onRename: (event: MouseEvent<HTMLButtonElement>) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className="group col-span-1 overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_22px_70px_rgb(0_0_0_/_0.34),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl transition hover:border-white/[0.18] hover:bg-white/[0.065]"
    >
      <button className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left" onClick={onOpen}>
        <div className="grid aspect-[4/3] place-items-center bg-black/36">
          {design.thumbnail_url ? (
            <img className="h-full w-full object-cover" src={design.thumbnail_url} alt="" />
          ) : (
            <span className="text-[12px] font-semibold text-white/42">
              {design.width} x {design.height}
            </span>
          )}
        </div>
      </button>
      <div className="grid gap-3 p-4">
        {editing ? (
          <input
            className="h-10 rounded-xl border border-accent/60 bg-white/[0.045] px-3 text-[13px] font-semibold text-white outline-none"
            value={editName}
            onInput={(event) => onEditNameChange((event.target as HTMLInputElement).value)}
            onBlur={onFinishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") onFinishRename();
              if (event.key === "Escape") onCancelRename();
            }}
            autoFocus
          />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <button className="min-w-0 border-0 bg-transparent p-0 text-left" onClick={onOpen}>
              <p className="m-0 truncate text-[14px] font-semibold text-white">{design.name}</p>
              <p className="m-0 mt-1 text-[12px] font-medium text-white/42">
                {design.width} x {design.height} &middot; {new Date(design.updated_at).toLocaleDateString()}
              </p>
            </button>
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                className="grid h-8 w-8 place-items-center rounded-lg text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={onRename}
              >
                <Edit3 size={14} />
              </button>
              <button
                className="grid h-8 w-8 place-items-center rounded-lg text-white/58 transition hover:bg-red-500/16 hover:text-red-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function AssetStorageStrip({
  assets,
  deletingAssetId,
  deletingAssetIds,
  selectedAssetIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDelete,
  onDeleteBulk,
  onRefresh,
}: {
  assets: CanvasAsset[];
  deletingAssetId: string | null;
  deletingAssetIds: string[];
  selectedAssetIds: string[];
  onToggleSelect: (assetId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: (assets: CanvasAsset[]) => void;
  onDeleteBulk: () => void;
  onRefresh: () => Promise<void>;
}) {
  const selectedCount = selectedAssetIds.length;
  const allSelected = assets.length > 0 && selectedCount === assets.length;
  const bulkDeleteLabel = selectedCount > 0 ? `Delete selected (${selectedCount})` : "Delete all";

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-[18px] font-normal text-white">Asset storage</h3>
          <p className="m-0 mt-1 text-[12px] font-medium text-white/42">Delete unused assets forever to free slots.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {assets.length > 0 ? (
            <>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[12px] font-semibold text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                onClick={allSelected ? onClearSelection : onSelectAll}
              >
                <span className="grid h-4 w-4 place-items-center rounded border border-white/20 bg-white/[0.035]">
                  {allSelected ? <Check size={11} /> : null}
                </span>
                {allSelected ? "Clear" : "Select all"}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200/14 bg-red-500/12 px-3 text-[12px] font-semibold text-red-50/74 transition hover:border-red-100/24 hover:bg-red-500/18 hover:text-red-50 disabled:pointer-events-none disabled:opacity-40"
                disabled={deletingAssetIds.length > 0}
                onClick={onDeleteBulk}
              >
                <Trash2 size={14} />
                {bulkDeleteLabel}
              </button>
            </>
          ) : null}
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[12px] font-semibold text-white/58 transition hover:bg-white/[0.08] hover:text-white"
            onClick={() => void onRefresh()}
            title="Refresh assets"
          >
            <HardDrive size={16} />
            Refresh
          </button>
        </div>
      </div>
      {assets.length === 0 ? (
        <div className={`${glassPanelClass} grid min-h-[150px] place-items-center rounded-2xl p-5 text-center`}>
          <span>
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.055] text-white/42">
              <ImageIcon size={20} />
            </span>
            <span className="block text-[14px] font-semibold text-white/64">No assets yet</span>
            <span className="mt-1 block text-[11px] font-medium text-white/38">
              Uploaded Canvas images will appear here.
            </span>
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {assets.map((asset) => {
            const selected = selectedAssetIds.includes(asset.id);
            const deleting = deletingAssetId === asset.id || deletingAssetIds.includes(asset.id);
            const displayStatus = getCanvasAssetDisplayStatus(asset);

            return (
              <article
                key={asset.id}
                className={`group overflow-hidden rounded-xl border bg-white/[0.045] shadow-[0_18px_60px_rgb(0_0_0_/_0.28),inset_0_1px_0_rgb(255_255_255_/_0.045)] transition hover:border-white/[0.18] hover:bg-white/[0.065] ${
                  selected ? "border-accent/70 ring-1 ring-accent/40" : "border-white/[0.1]"
                }`}
              >
                <div className="relative grid aspect-square place-items-center overflow-hidden bg-black/36">
                  <button
                    className={`absolute left-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-lg border text-white transition ${
                      selected
                        ? "border-accent/70 bg-accent text-white"
                        : "border-white/[0.16] bg-black/58 hover:border-white/30 hover:bg-black/76"
                    }`}
                    onClick={() => onToggleSelect(asset.id)}
                    title={selected ? "Deselect asset" : "Select asset"}
                    aria-label={selected ? `Deselect ${asset.original_name}` : `Select ${asset.original_name}`}
                    aria-pressed={selected}
                  >
                    {selected ? <Check size={14} /> : null}
                  </button>
                  {!displayStatus.canPreview ? (
                    <span className="grid justify-items-center gap-2 text-center">
                      <ImageIcon size={22} className="text-white/38" />
                      <span className="text-[11px] font-semibold text-white/42">{displayStatus.title}</span>
                    </span>
                  ) : (
                    <img
                      className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03] group-hover:opacity-100"
                      src={asset.public_url}
                      alt=""
                    />
                  )}
                </div>
                <div className="p-3">
                  <p className="m-0 truncate text-[12px] font-semibold text-white/78">{asset.original_name}</p>
                  <p className="m-0 mt-1 text-[10px] font-medium text-white/38">{formatBytes(asset.size_bytes)}</p>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    {asset.drive_web_view_link ? (
                      <a
                        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-white/48 transition hover:bg-white/[0.08] hover:text-white"
                        href={asset.drive_web_view_link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Drive
                      </a>
                    ) : (
                      <span />
                    )}
                    <button
                      className="grid h-7 w-7 place-items-center rounded-lg text-red-100/62 transition hover:bg-red-500/16 hover:text-red-50 disabled:cursor-wait disabled:opacity-45"
                      disabled={deleting}
                      onClick={() => void onDelete([asset])}
                      title="Delete forever"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DeleteAssetDialog({
  asset,
  deleting,
  onCancel,
  onConfirm,
}: {
  asset: CanvasAsset[];
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (asset.length === 0) return null;

  const firstAsset = asset[0];
  const firstAssetStatus = getCanvasAssetDisplayStatus(firstAsset);
  const title = asset.length === 1 ? "Delete asset forever?" : `Delete ${asset.length} assets forever?`;
  const description =
    asset.length === 1
      ? "This removes the Drive file and frees one Canvas asset slot."
      : "This removes the selected Drive files and frees Canvas asset slots.";

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/62 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-asset-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/[0.12] bg-zinc-950/92 text-white shadow-[0_28px_110px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-2xl">
        <div className="flex items-start gap-3 border-b border-white/[0.08] p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-300/14 bg-red-500/12 text-red-100">
            <Trash2 size={18} />
          </span>
          <div className="min-w-0">
            <h3 id="delete-asset-title" className="m-0 text-[15px] font-bold text-white">
              {title}
            </h3>
            <p className="m-0 mt-1 text-[12px] font-medium leading-5 text-white/48">
              {description}
            </p>
          </div>
          <button
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/38 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-40"
            disabled={deleting}
            onClick={onCancel}
            aria-label="Close delete asset dialog"
          >
            <X size={15} />
          </button>
        </div>
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-2">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-black/36">
              {!firstAssetStatus.canPreview ? (
                <ImageIcon size={18} className="text-white/38" />
              ) : (
                <img className="h-full w-full object-cover" src={firstAsset.public_url} alt="" />
              )}
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] font-semibold text-white/78">
                {asset.length === 1 ? firstAsset.original_name : `${firstAsset.original_name} and ${asset.length - 1} more`}
              </p>
              <p className="m-0 mt-1 text-[11px] font-medium text-white/38">
                {asset.length === 1 ? formatBytes(firstAsset.size_bytes) : `${asset.length} selected assets`}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="h-9 rounded-xl border border-white/[0.1] bg-white/[0.045] px-3 text-[12px] font-bold text-white/58 transition hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-40"
              disabled={deleting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-200/16 bg-red-500/16 px-3 text-[12px] font-bold text-red-50/82 transition hover:border-red-100/28 hover:bg-red-500/22 hover:text-red-50 disabled:cursor-wait disabled:opacity-50"
              disabled={deleting}
              onClick={onConfirm}
            >
              <Trash2 size={14} />
              {deleting ? "Deleting..." : asset.length === 1 ? "Delete forever" : "Delete assets"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: typeof LayoutGrid;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.045] p-6 text-center shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
      <div className="grid max-w-[420px] justify-items-center">
        <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.07] text-white/64">
          <Icon size={24} />
        </div>
        <h3 className="m-0 text-[34px] font-light leading-none text-white">{title}</h3>
        <p className="mb-6 mt-3 text-[14px] font-medium leading-6 text-white/52">{description}</p>
        <button
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[13px] font-semibold text-white transition hover:bg-accent-hover"
          onClick={onAction}
        >
          <Plus size={15} />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
