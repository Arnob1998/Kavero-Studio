"use client";

import { useEffect, useRef, useState } from "react";
import Image from 'next/image';
import { setupOperationSchema, setupSnapshotSchema, type SetupSnapshot } from "@/modules/generation/local/setup-contract";
import { LocalModelSetup } from "@/modules/generation/local/local-model-setup";
import { localProfiles, type LocalProfile } from "./browser-profiles";
import styles from "./model-hub.module.css";
import {ModelRemoval} from './model-removal';
import Link from 'next/link';
import {Plus,RefreshCw,X,ImageIcon,Square,Loader2,FileBadge2,ArrowRight} from 'lucide-react';

type Entry = { snapshot: SetupSnapshot | null; unavailable: boolean };
export type LocalInventorySummary = Partial<Record<LocalProfile, { installed: boolean; ready: boolean; accepted: boolean }>>;
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
function label(snapshot: SetupSnapshot) {
  const state = snapshot.operation?.state;
  if (state === "cancelling") return "Cancelling download";
  if (state === "admitted") return "Waiting to download";
  if (state === "downloading") return "Downloading";
  if (state === "verifying") return "Verifying files";
  if (state === "staged" || state === "activating") return "Preparing model";
  if (snapshot.installed) return snapshot.ready ? "Active · ready to create" : ["failed", "activation-failed", "interrupted"].includes(state ?? "") ? "Installed · setup needs recovery" : "Installed";
  if (state === "interrupted") return "Interrupted · retry required";
  if (state === "failed" || state === "activation-failed") return "Setup failed · retry available";
  if (state === "cancelled") return "Download cancelled";
  if (state === "removed") return "Removed from your account";
  return "Not downloaded";
}

function DownloadCancel({ snapshot, online, onChanged }: { snapshot: SetupSnapshot; online: boolean; onChanged: () => void }) {
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const locked = useRef(false), abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const state = snapshot.operation?.state;
  if (!['admitted', 'downloading', 'verifying', 'staged', 'cancelling'].includes(state ?? '')) return null;
  async function cancel() {
    if (locked.current || !online || !snapshot.operation) return;
    locked.current = true; setPending(true); setError(null);
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch('/api/local-generation/setup', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel-install', id: snapshot.operation.id }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Cancellation could not be confirmed. Retry cancel to check the same download.');
      const operation = setupOperationSchema.parse(data.operation);
      if (operation.id !== snapshot.operation.id || operation.packageId !== snapshot.packageId) throw Error('Download identity changed. Refresh models before retrying.');
      if (!controller.signal.aborted) onChanged();
    } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Cancellation could not be confirmed. Retry cancel.'); setPending(false); } }
    finally { locked.current = false; }
  }
  return <div><button className={styles.button} disabled={!online || pending || state === 'cancelling'} onClick={() => void cancel()}>{pending || state === 'cancelling' ? <Loader2 size={16} strokeWidth={1.75} aria-hidden className="animate-spin"/> : <Square size={15} strokeWidth={1.75} aria-hidden/>}{pending || state === 'cancelling' ? 'Cancelling download…' : error ? 'Retry cancel' : 'Cancel download'}</button>{error && <p className={styles.error} role="alert">{error}</p>}</div>;
}

/** Polling never admits setup/removal; deletion requires explicit confirmation. */
export function LocalModelInventory({ ownerId, managedProfile, onManage,onAdd,onInventoryChange,compact=false }: {
  compact?:boolean; ownerId: string; managedProfile: LocalProfile | null; onManage: (profile: LocalProfile | null) => void;onAdd?:()=>void;onInventoryChange?:(summary:LocalInventorySummary)=>void;
}) {
  const [entries, setEntries] = useState<Partial<Record<LocalProfile, Entry>>>({});
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<LocalProfile>(managedProfile ?? localProfiles[0].profile);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(()=>{
    onInventoryChange?.(Object.fromEntries(localProfiles.flatMap(profile=>{
      const entry=entries[profile.profile];return entry?.snapshot&&!entry.unavailable?[[profile.profile,{installed:entry.snapshot.installed,ready:entry.snapshot.ready,accepted:entry.snapshot.accepted}]]:[];
    })));
  },[entries,onInventoryChange]);
  useEffect(() => {
    if (!managedProfile) return;
    setSelected(managedProfile);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current;
    current?.showModal();
    return () => { current?.close(); trigger.current?.focus(); };
  }, [managedProfile]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true, timer: ReturnType<typeof setTimeout>, inflight = false;
    const poll = async () => {
      if (!live || inflight) return;
      if (document.hidden) { timer = setTimeout(poll, 4000); return; }
      inflight = true;
      await Promise.all(localProfiles.map(async profile => {
        try {
          const response = await fetch(`/api/local-generation/setup?view=model&profile=${profile.profile}`, {
            method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
          });
          if (!response.ok) throw Error("unavailable");
          const data = await response.json();
          if (data.ownerId !== ownerId) { if (live) setEntries(previous => ({ ...previous, [profile.profile]: { snapshot: null, unavailable: true } })); return; }
          const snapshot = setupSnapshotSchema.parse(data.setup);
          const delivery = profile.profile === "qwen-image-2.1-q3-evaluation" ? "qwen-2-1-q3-research-delivery-v1" : "qwen-2-1-research-delivery-v1";
          if (snapshot.manifest !== profile.manifest || snapshot.packageId !== delivery || snapshot.operation && snapshot.operation.packageId !== delivery) { if (live) setEntries(previous => ({ ...previous, [profile.profile]: { snapshot: null, unavailable: true } })); return; }
          if (live) setEntries(previous => ({ ...previous, [profile.profile]: { snapshot, unavailable: false } }));
        } catch {
          if (live) setEntries(previous => ({ ...previous, [profile.profile]: { snapshot: previous[profile.profile]?.snapshot ?? null, unavailable: true } }));
        }
      }));
      inflight = false;
      if (live) timer = setTimeout(poll, 4000);
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll(); document.addEventListener("visibilitychange", visible);
    return () => { live = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [ownerId, refresh]);

  const background=localProfiles.find(profile=>profile.profile!==selected&&!entries[profile.profile]?.unavailable&&['admitted','downloading','verifying','staged','activating','cancelling'].includes(entries[profile.profile]?.snapshot?.operation?.state??''));
  return <section className={compact?styles.compactInventory:styles.panel} aria-labelledby="local-inventory-heading">
    {compact?<div className={styles.resultsHeading}><h2 id="local-inventory-heading">On this computer</h2><button className={styles.iconButton} aria-label="Refresh models" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={14}/></button></div>:<>
    <div className={`${styles.heading} flex-wrap`}><div><h2 id="local-inventory-heading">Your models</h2><p>Manage the image models on this computer.</p></div><div className={styles.rowActions}><button className={styles.iconButton} aria-label="Refresh models" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/></button>{onAdd&&<button id="add-local-model" className={styles.button} onClick={onAdd}><Plus size={15}/>Add model</button>}</div></div>
    <div className={styles.familyHeader}>
      <div className={styles.modelIdentity}><span className={styles.providerLogo}><Image src="/models/qwen.svg" alt="Qwen logo" width={32} height={32}/></span><div><h3>Qwen Image 2.1</h3><span className={styles.capability}><ImageIcon size={13}/>Image generation</span></div></div>
      <div className={styles.versionPicker} role="radiogroup" aria-label="Model version">
        {localProfiles.map((profile,index)=><button key={profile.profile} id={`inventory-${profile.profile}`} type="button" role="radio" aria-checked={selected===profile.profile} tabIndex={selected===profile.profile?0:-1} className={styles.versionOption} onClick={()=>setSelected(profile.profile)} onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
          event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?localProfiles.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+localProfiles.length)%localProfiles.length;
          setSelected(localProfiles[next].profile);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
        }}><strong>{index?'Q3':'Q4'}</strong><span>{index?'Smaller download':'Higher precision'}</span></button>)}
      </div>
    </div>
    </>}
    {compact&&!localProfiles.some(profile=>entries[profile.profile]?.snapshot?.installed||entries[profile.profile]?.snapshot?.operation&&['admitted','downloading','verifying','staged','activating','cancelling','failed','activation-failed','interrupted'].includes(entries[profile.profile]!.snapshot!.operation!.state))&&<p className={styles.libraryEmpty}>{Object.values(entries).some(entry=>entry?.unavailable)?'Computer unavailable. Check the Kavero launcher to reconnect.':Object.keys(entries).length<localProfiles.length?'Checking installed models...':'No models installed yet. Explore Hugging Face below to get started.'}</p>}
    {localProfiles.map(profile => {
      const entry = entries[profile.profile], snapshot = entry?.snapshot;
      const state = snapshot?.operation?.state;
      const running = ["admitted", "downloading", "verifying", "staged", "activating", "cancelling"].includes(state ?? "");
      const recovery=['failed','activation-failed','interrupted'].includes(state??'');
      const action=!snapshot?'Checking…':running?'View download':recovery?'Retry setup':snapshot.installed?!snapshot.accepted?'Review terms':'Use model':'Set up model';
      if(compact&&!snapshot?.installed&&!running&&!recovery)return null;
      return <article key={profile.profile} hidden={!compact&&selected !== profile.profile} className={compact?styles.installedRow:styles.modelCard} aria-label={`${profile.label} on this host`}>
        {compact&&<div className={styles.installedIdentity}><span className={styles.providerLogo}><Image src={profile.logo} alt="" width={25} height={25}/></span><span><strong>{profile.label}</strong><small>{profile.file}</small></span></div>}
        <div className={styles.modelRow}><div><span className={styles.stateBadge} data-ready={snapshot?.ready && !entry?.unavailable} role="status">{entry?.unavailable ? "Computer unavailable" : snapshot ? label(snapshot) : "Checking…"}</span>{snapshot && <p className={styles.muted}>{snapshot.installed ? 'Research / evaluation' : `${gib(snapshot.downloadBytes)} GB download`}</p>}</div>
        <div className={styles.rowActions}>
          {snapshot?.operation && <DownloadCancel key={`${ownerId}:${profile.profile}:${snapshot.operation.id}`} snapshot={snapshot} online={!entry?.unavailable} onChanged={() => setRefresh(value => value + 1)}/>}
          {snapshot?.ready&&!entry?.unavailable?<Link className={`${styles.button} ${styles.primary}`} aria-label={`Generate with ${profile.label}`} href="/generate?source=local">Create image</Link>:<button className={`${styles.button} ${styles.primary}`} aria-label={`${action} — ${profile.label}`} disabled={!snapshot || entry?.unavailable} onClick={() => onManage(profile.profile)} aria-haspopup="dialog">{action}</button>}
        </div></div>
        {entry?.unavailable && <p className={styles.muted}>{snapshot ? `Last confirmed: ${label(snapshot)}. ` : ""}Reconnect to check this model.</p>}
        {running && snapshot && !entry?.unavailable && <><progress aria-label={`${profile.label} installation progress`} max={snapshot.workBytes} value={Math.min(snapshot.operation?.processedBytes ?? 0, snapshot.workBytes)} className="w-full accent-blue-500" /><p className={styles.muted}>{gib(snapshot.operation?.processedBytes ?? 0)} GB processed · download and verification</p></>}
        <div className={styles.managementActions}><button className={styles.textButton} disabled={!snapshot || entry?.unavailable} onClick={() => onManage(profile.profile)} aria-label={`Model details — ${profile.label}`} aria-haspopup="dialog"><FileBadge2 size={16} strokeWidth={1.75} aria-hidden/>Details & licenses</button>{snapshot&&<ModelRemoval ownerId={ownerId} profile={profile.profile} online={!entry?.unavailable} onChanged={()=>{onManage(null);setRefresh(value=>value+1);}}/>}</div>
      </article>;
    })}
    {!compact&&background&&<button className={styles.backgroundDownload} aria-label={`View ${background.label} download`} onClick={()=>{setSelected(background.profile);document.getElementById(`inventory-${background.profile}`)?.focus();}}><Loader2 size={14} className="animate-spin" aria-hidden/><span>{background.profile===localProfiles[0].profile?'Q4':'Q3'} · {label(entries[background.profile]!.snapshot!)}</span><ArrowRight size={14} aria-hidden/></button>}
    {managedProfile && <dialog ref={dialog} className={styles.dialog} aria-labelledby="model-setup-title" onClose={() => onManage(null)}>
      <div className={styles.heading}><div><h2 id="model-setup-title">{localProfiles.find(profile => profile.profile === managedProfile)?.label}</h2><p>Model setup, hardware and licenses</p></div><button className={styles.iconButton} aria-label="Close model setup" onClick={() => onManage(null)}><X size={18}/></button></div>
      <div className={styles.dialogBody}><LocalModelSetup key={`${ownerId}:${managedProfile}`} ownerId={ownerId} profile={managedProfile} onAccess={() => {}} onReady={() => setRefresh(value => value + 1)} /></div>
    </dialog>}
  </section>;
}
