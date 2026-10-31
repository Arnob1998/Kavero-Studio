"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { setupOperationSchema, setupSnapshotSchema, type SetupSnapshot } from "./setup-contract";

type Attempt = { key: string; manifest: string; termsDigest: string };
const cachedAttempt = z.object({ key: z.string().uuid(), manifest: z.string().regex(/^[a-f0-9]{64}$/), termsDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const notices = z.array(z.object({ name: z.string().max(100), text: z.string().max(256 * 1024) })).max(64);
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
const compatibilityMessages = {
  "windows-only": "Local setup currently supports Windows on Intel/AMD 64-bit processors.",
  "multiple-gpus": "Multiple NVIDIA GPUs detected. Automatic device selection is not supported yet; their memory is not combined.",
  "gpu-unverified": "This profile supports one NVIDIA GeForce RTX 30/40 series GPU with at least 8 GB VRAM.",
  "gpu-too-small": "This Q4 profile needs at least 8 GB GPU memory. A smaller model version is not verified yet.",
  "ram-too-small": "This profile needs at least 16 GB installed system memory.",
  "check-unavailable": "Hardware detection could not finish. Check the NVIDIA driver; Kavero will check again automatically.",
  "eligible": "",
};
async function request(view?: string, body?: unknown) {
  const response = await fetch(`/api/local-generation/setup${view ? `?view=${view}` : ""}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(25000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Setup is unavailable. Refresh and retry the same download.");
  return data;
}
export function LocalModelSetup({ ownerId, onAccess, onReady }: { ownerId?: string; onAccess: (ready: boolean) => void; onReady: () => void }) {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<z.infer<typeof notices> | null>(null);
  const attempt = useRef<Attempt | null>(null), epoch = useRef(0), locked = useRef(false), wasReady = useRef(false);
  const callbacks = useRef({ onAccess, onReady }); callbacks.current = { onAccess, onReady };
  const storageKey = ownerId ? `kavero-local-setup:${ownerId}` : null;
  useEffect(() => {
    const current = ++epoch.current; let timer: ReturnType<typeof setTimeout>;
    attempt.current = null; wasReady.current = false; locked.current = false;
    setSnapshot(null); setChecked(false); setBusy(false); setError(null); setTerms(null); callbacks.current.onAccess(false);
    if (!ownerId || !storageKey) return;
    try { attempt.current = cachedAttempt.parse(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { /* A cache is never consent. */ }
    const poll = async () => {
      try {
        const data = await request("model");
        if (epoch.current !== current) return;
        if (data.ownerId !== ownerId) throw Error("Your account changed. Check the connection again.");
        const next = setupSnapshotSchema.parse(data.setup);
        if (attempt.current && (attempt.current.manifest !== next.manifest || attempt.current.termsDigest !== next.termsDigest)) {
          attempt.current = null; localStorage.removeItem(storageKey); setChecked(false);
        }
        setSnapshot(next);
        if (next.ready) setError(null);
        if (next.accepted) setChecked(true);
        callbacks.current.onAccess(next.ready);
        if (next.ready && !wasReady.current) callbacks.current.onReady();
        wasReady.current = next.ready;
      } catch (e) { if (epoch.current === current) { callbacks.current.onAccess(false); setError(e instanceof Error ? e.message : "Setup is unavailable."); } }
      finally { if (epoch.current === current) timer = setTimeout(poll, 4000); }
    };
    void poll();
    return () => { ++epoch.current; clearTimeout(timer); };
  }, [ownerId, storageKey]);
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return;
    const current = epoch.current; locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { if (epoch.current === current) setError(e instanceof Error ? e.message : "Setup is unavailable."); }
    finally { if (epoch.current === current) { locked.current = false; setBusy(false); } }
  };
  const install = () => act(async () => {
    if (!snapshot || !checked || !storageKey) return;
    const current = epoch.current;
    if (!attempt.current || snapshot.operation?.state === "cancelled") attempt.current = { key: crypto.randomUUID(), manifest: snapshot.manifest, termsDigest: snapshot.termsDigest };
    // Commit the retry identity before submission; refresh never starts a download.
    localStorage.setItem(storageKey, JSON.stringify(attempt.current));
    const data = await request(undefined, { action: "install", ...attempt.current, consentToken: snapshot.consentToken, purpose: "research-evaluation", accepted: true });
    if (epoch.current === current) setSnapshot(value => value ? { ...value, operation: setupOperationSchema.parse(data.operation) } : value);
  });
  const cancel = () => act(async () => {
    const current = epoch.current;
    if (!snapshot?.operation) return;
    const data = await request(undefined, { action: "cancel-install", id: snapshot.operation.id });
    if (epoch.current === current) setSnapshot(value => value ? { ...value, operation: setupOperationSchema.parse(data.operation) } : value);
  });
  const loadTerms = () => act(async () => {
    const current = epoch.current, data = await request("terms");
    if (epoch.current === current) setTerms(notices.parse(data.terms));
  });
  const state = snapshot?.operation?.state;
  const running = ["downloading", "verifying", "staged", "activating", "cancelling"].includes(state ?? "");
  const lowDisk = snapshot && !snapshot.installed && snapshot.freeBytes < snapshot.requiredFreeBytes;
  return <div className="mt-5 border-t border-white/10 pt-4" aria-label="Local model setup">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/50"><span>Research/evaluation only</span><span>{snapshot?.installed ? "Installed on this computer" : snapshot ? `${gib(snapshot.downloadBytes)} GB download` : "Checking setup…"}</span></div>
    {!snapshot?.ready && <>
      <label className="mt-4 flex items-start gap-3 text-sm text-white/60"><input type="checkbox" className="mt-1 accent-blue-500" checked={checked} disabled={busy || running} onChange={e => setChecked(e.target.checked)} /><span>I accept the model licenses and will use it for research/evaluation.</span></label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40" disabled={!checked || !snapshot?.available || Boolean(lowDisk) || busy || running} onClick={() => void install()}>{busy || running ? <Loader2 size={16} className="animate-spin" /> : null}{running ? state === "cancelling" ? "Cancelling…" : state === "activating" ? "Preparing model…" : "Installing…" : state === "cancelled" ? "Start new download" : state && state !== "installed" ? "Resume setup" : snapshot?.installed ? "Accept & use" : "Accept & download"}</button>
        {running && !["activating","cancelling"].includes(state ?? "") && <button className="min-h-11 px-3 text-sm text-white/60 disabled:opacity-40" disabled={busy} onClick={() => void cancel()}>Cancel download</button>}
      </div>
    </>}
    {running && snapshot && <div className="mt-3"><progress aria-label="Installation progress" max={snapshot.workBytes} value={Math.min(snapshot.operation?.processedBytes ?? 0, snapshot.workBytes)} className="h-1.5 w-full accent-blue-500" /><p className="mt-1 text-xs text-white/45">{gib(snapshot.operation?.processedBytes ?? 0)} GB processed · download and verification</p></div>}
    {snapshot && !snapshot.supported && <p className="mt-3 text-xs text-amber-200">{compatibilityMessages[snapshot.compatibility ?? "check-unavailable"]}</p>}
    {snapshot?.hardware?.gpuName && <details className="mt-3 text-xs text-white/45"><summary className="cursor-pointer py-2">{snapshot.hardware.gpuName} · {gib((snapshot.hardware.totalVramMiB ?? 0)*1024**2)} GB VRAM</summary><p className="mt-1">{gib(snapshot.hardware.totalRamBytes ?? 0)} GB system memory · {gib(snapshot.hardware.freeRamBytes)} GB available</p><p className="mt-2">{snapshot.hardware.confidence === "measured" ? "Previously measured on this GPU: about 55 seconds per 512 × 512 image. Current load can change this." : "Meets this profile’s hardware requirements. Generation speed has not been benchmarked on this device."}</p>{!snapshot.installed && <p className="mt-2">Kavero verifies the native GPU backend after installation.</p>}</details>}
    {snapshot?.supported && !snapshot.available && <p className="mt-3 text-xs text-white/50">Research setup is unavailable or still starting on this host.</p>}
    {lowDisk && <p className="mt-3 text-xs text-amber-200">Setup needs {gib(snapshot!.requiredFreeBytes)} GB free on its installation drive.</p>}
    {["failed", "activation-failed", "interrupted"].includes(state ?? "") && <p className="mt-3 text-xs text-amber-200">Setup stopped. Resume checks the same download and verified files.</p>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
    <details className="mt-3 text-xs text-white/45" onToggle={e => { if (e.currentTarget.open && !terms && !locked.current) void loadTerms(); }}><summary className="cursor-pointer py-2">Model licenses & notices</summary><p className="my-2">Pinned licenses apply to the model and its components. Kavero downloads them directly from their upstream sources.</p>{terms?.map(term => <details key={term.name} className="mt-2"><summary className="cursor-pointer break-words">{term.name}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3">{term.text}</pre></details>)}</details>
  </div>;
}
