"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { setupOperationSchema, setupSnapshotSchema, type SetupSnapshot } from "./setup-contract";
import styles from "./local-generation.module.css";
import {localProfile,type LocalProfile} from '@/modules/model-providers/local/browser-profiles';

type Attempt = { key: string; manifest: string; termsDigest: string };
const cachedAttempt = z.object({ key: z.string().uuid(), manifest: z.string().regex(/^[a-f0-9]{64}$/), termsDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const notices = z.array(z.object({ name: z.string().max(100), text: z.string().max(256 * 1024) })).max(64);
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
const compatibilityMessages = {
  "windows-only": "Local setup currently supports Windows on Intel/AMD 64-bit processors.",
  "multiple-gpus": "Multiple NVIDIA GPUs detected. Automatic device selection is not supported yet; their memory is not combined.",
  "gpu-unverified": "This profile supports one NVIDIA GeForce RTX 30/40 series GPU with at least 8 GB VRAM.",
  "gpu-too-small": "This profile needs at least 8 GB GPU memory. The available GPU does not meet its verified requirements.",
  "ram-too-small": "This profile needs at least 16 GB installed system memory.",
  "check-unavailable": "Hardware detection could not finish. Check the NVIDIA driver; Kavero will check again automatically.",
  "eligible": "",
};
async function request(view?: string, body?: unknown, profile:LocalProfile='qwen-image-2.1-q4-evaluation') {
  const query=view?.startsWith('id=')?`?${view}`:view?`?view=${view}${profile==='qwen-image-2.1-q3-evaluation'?`&profile=${profile}`:''}`:'';
  const response = await fetch(`/api/local-generation/setup${query}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(25000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Setup is unavailable. Refresh and retry the same download.");
  return data;
}
const switchRecord=z.object({key:z.string().uuid(),id:z.string().uuid().optional()}).strict();
const activation=z.object({id:z.string().uuid(),packageId:z.string(),state:z.enum(['admitted','verifying','starting','installed','cancelled','failed','interrupted']),error:z.string().nullable()});
export function LocalModelSetup({ ownerId, onAccess, onReady,profile='qwen-image-2.1-q4-evaluation',hideNotices=false }: { ownerId?: string; onAccess: (ready: boolean) => void; onReady: () => void;profile?:LocalProfile;hideNotices?:boolean }) {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<z.infer<typeof notices> | null>(null);
  const [switching,setSwitching]=useState(false);
  const switchAttempt=useRef<z.infer<typeof switchRecord>|null>(null);
  const call=(view?:string,body?:unknown)=>request(view,body,profile);
  const attempt = useRef<Attempt | null>(null), epoch = useRef(0), locked = useRef(false), wasReady = useRef(false);
  const callbacks = useRef({ onAccess, onReady }); callbacks.current = { onAccess, onReady };
  const storageKey = ownerId ? `kavero-local-setup:${ownerId}${profile==='qwen-image-2.1-q3-evaluation'?':q3':''}` : null;
  const switchKey=storageKey?`${storageKey}:switch`:null;
  useEffect(() => {
    const current = ++epoch.current; let timer: ReturnType<typeof setTimeout>;
    attempt.current = null; switchAttempt.current=null;setSwitching(false);wasReady.current = false; locked.current = false;
    setSnapshot(null); setChecked(false); setBusy(false); setError(null); setTerms(null); callbacks.current.onAccess(false);
    if (!ownerId || !storageKey) return;
    try { attempt.current = cachedAttempt.parse(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { /* A cache is never consent. */ }
    try{switchAttempt.current=switchRecord.parse(JSON.parse(localStorage.getItem(switchKey!)||'null'));if(switchAttempt.current.id)setSwitching(true);}catch{/* Retry cache never grants access. */}
    const poll = async () => {
      try {
        if(switchAttempt.current?.id){
          const result=await call(`id=${switchAttempt.current.id}`);if(epoch.current!==current)return;
          const op=activation.parse(result.operation);if(op.id!==switchAttempt.current.id||op.packageId!==localProfile(profile)?.packageId)throw Error('Model switch identity changed.');
          if(['installed','failed','cancelled','interrupted'].includes(op.state)){
            setSwitching(false);if(op.state==='installed'){switchAttempt.current=null;localStorage.removeItem(switchKey!);}else setError('Model switch stopped. Retry the same switch after the runtime recovers.');
          }
        }
        const data = await call("model");
        if (epoch.current !== current) return;
        if (data.ownerId !== ownerId) throw Error("Your account changed. Check the connection again.");
        const next = setupSnapshotSchema.parse(data.setup);
        if (next.manifest !== localProfile(profile)?.manifest) throw Error('Model setup identity changed.');
        if (attempt.current && (attempt.current.manifest !== next.manifest || attempt.current.termsDigest !== next.termsDigest)) {
          attempt.current = null; localStorage.removeItem(storageKey); setChecked(false);
        }
        // Native readiness cannot settle the app's durable switch fence. A lost
        // acknowledgement still needs its original key, even if the GPU is ready.
        next.ready = next.ready && !switchAttempt.current;
        setSnapshot(next);
        if (next.ready) {setError(null);setSwitching(false);}
        if (next.accepted) setChecked(true);
        callbacks.current.onAccess(next.ready);
        if (next.ready && !wasReady.current) callbacks.current.onReady();
        wasReady.current = next.ready;
      } catch (e) { if (epoch.current === current) { callbacks.current.onAccess(false); setError(e instanceof Error ? e.message : "Setup is unavailable."); } }
      finally { if (epoch.current === current) timer = setTimeout(poll, 4000); }
    };
    void poll();
    return () => { ++epoch.current; clearTimeout(timer); };
  }, [ownerId, storageKey,profile,switchKey]);
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
    const data = await call(undefined, { action: "install", ...attempt.current, consentToken: snapshot.consentToken, purpose: "research-evaluation", accepted: true });
    if (epoch.current === current) setSnapshot(value => value ? { ...value, operation: setupOperationSchema.parse(data.operation) } : value);
  });
  const cancel = () => act(async () => {
    const current = epoch.current;
    if (!snapshot?.operation) return;
    const data = await call(undefined, { action: "cancel-install", id: snapshot.operation.id });
    if (epoch.current === current) setSnapshot(value => value ? { ...value, operation: setupOperationSchema.parse(data.operation) } : value);
  });
  const loadTerms = () => act(async () => {
    const current = epoch.current, data = await call("terms");
    if (epoch.current === current) setTerms(notices.parse(data.terms));
  });
  const useModel=()=>act(async()=>{
    if(!snapshot?.accepted||!snapshot.installed||!switchKey)return;
    const current=epoch.current,target=localProfile(profile)!;
    switchAttempt.current??={key:crypto.randomUUID()};localStorage.setItem(switchKey,JSON.stringify(switchAttempt.current));
    const data=await call(undefined,{action:'switch',key:switchAttempt.current.key,packageId:target.packageId});if(epoch.current!==current)return;
    const op=activation.parse(data.operation);if(op.packageId!==target.packageId)throw Error('Model switch identity changed.');
    if(op.state==='installed'){switchAttempt.current=null;localStorage.removeItem(switchKey);setSwitching(false);}else{switchAttempt.current={key:switchAttempt.current.key,id:op.id};localStorage.setItem(switchKey,JSON.stringify(switchAttempt.current));setSwitching(!['failed','cancelled','interrupted'].includes(op.state));}
    // Refresh readiness immediately; GET reconciliation continues after navigation.
    const result=await call('model');if(epoch.current===current){if(result.ownerId!==ownerId)throw Error('Your account changed. Check the connection again.');const next=setupSnapshotSchema.parse(result.setup);if(next.manifest!==target.manifest)throw Error('Model setup identity changed.');next.ready=next.ready&&!switchAttempt.current;setSnapshot(next);}
  });
  const state = snapshot?.operation?.state;
  const running = ["admitted","downloading", "verifying", "staged", "activating", "cancelling"].includes(state ?? "");
  const canSwitch=Boolean(snapshot?.installed&&snapshot.accepted&&(snapshot.switchRequired||switchAttempt.current));
  const lowDisk = snapshot && !snapshot.installed && snapshot.freeBytes < snapshot.requiredFreeBytes;
  return <div className={styles.setup} aria-label="Local model setup">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/50"><span>Research/evaluation only</span><span>{snapshot?.installed ? "Installed on this computer" : snapshot ? `${gib(snapshot.downloadBytes)} GB download` : "Checking setup…"}</span></div>
    {!snapshot?.ready && <>
      {!snapshot?.accepted&&<label className="mt-4 flex items-start gap-3 text-sm text-white/60"><input type="checkbox" className="mt-1 accent-blue-500" checked={checked} disabled={busy || running||switching} onChange={e => setChecked(e.target.checked)} /><span>I accept the model licenses and will use it for research/evaluation.</span></label>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40" disabled={!checked || !snapshot?.available || Boolean(lowDisk) || busy || running || switching} onClick={() => void (canSwitch?useModel():install())}>{busy || running || switching ? <Loader2 size={16} className="animate-spin" /> : null}{switching ? "Switching model…" : canSwitch ? "Use model" : running ? state === "cancelling" ? "Cancelling…" : state === "activating" ? "Preparing model…" : "Installing…" : state === "cancelled" ? "Start new download" : state && state !== "installed" ? "Resume setup" : snapshot?.installed ? "Accept & use" : "Accept & download"}</button>
        {running && !["activating","cancelling"].includes(state ?? "") && <button className="min-h-11 px-3 text-sm text-white/60 disabled:opacity-40" disabled={busy} onClick={() => void cancel()}>Cancel download</button>}
      </div>
    </>}
    {running && snapshot && <div className="mt-3"><progress aria-label="Installation progress" max={snapshot.workBytes} value={Math.min(snapshot.operation?.processedBytes ?? 0, snapshot.workBytes)} className="h-1.5 w-full accent-blue-500" /><p className="mt-1 text-xs text-white/45">{gib(snapshot.operation?.processedBytes ?? 0)} GB processed · download and verification</p></div>}
    {snapshot && !snapshot.supported && <p className="mt-3 text-xs text-amber-200">{compatibilityMessages[snapshot.compatibility ?? "check-unavailable"]}</p>}
    {snapshot?.hardware?.gpuName && <details className="mt-3 text-xs text-white/45"><summary className="cursor-pointer py-2">{snapshot.hardware.gpuName} · {gib((snapshot.hardware.totalVramMiB ?? 0)*1024**2)} GB VRAM</summary><p className="mt-1">{gib(snapshot.hardware.totalRamBytes ?? 0)} GB system memory · {gib(snapshot.hardware.freeRamBytes)} GB available</p><p className="mt-2">{profile==="qwen-image-2.1-q4-evaluation"&&snapshot.hardware.confidence === "measured" ? "Previously measured on this GPU: about 55 seconds per 512 × 512 image. Current load can change this." : "Meets this profile’s hardware requirements. Generation speed has not been benchmarked on this device."}</p>{!snapshot.installed && <p className="mt-2">Kavero verifies the native GPU backend after installation.</p>}</details>}
    {snapshot?.supported && !snapshot.available && <p className="mt-3 text-xs text-white/50">Research setup is unavailable or still starting on this host.</p>}
    {lowDisk && <p className="mt-3 text-xs text-amber-200">Setup needs {gib(snapshot!.requiredFreeBytes)} GB free on its installation drive.</p>}
    {["failed", "activation-failed", "interrupted"].includes(state ?? "") && <p className="mt-3 text-xs text-amber-200">Setup stopped. Resume checks the same download and verified files.</p>}
    {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
    {snapshot?.ready&&<p role="status" className="mt-3 text-sm text-white/70">Active model · ready to create</p>}
    {!hideNotices&&<details className="mt-3 text-xs text-white/45" onToggle={e => { if (e.currentTarget.open && !terms && !locked.current) void loadTerms(); }}><summary className="cursor-pointer py-2">Model licenses & notices</summary><p className="my-2">Pinned licenses apply to the model and its components. Kavero downloads them directly from their upstream sources.</p>{terms?.map(term => <details key={term.name} className="mt-2"><summary className="cursor-pointer break-words">{term.name}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3">{term.text}</pre></details>)}</details>}
  </div>;
}
