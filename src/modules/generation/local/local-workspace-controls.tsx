"use client";
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Save, Square, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { LocalModelSetup } from './local-model-setup';
import { localJobMessage } from './capabilities';
import type { LocalGenerationRuntime } from './local-generation-panel';
const button='inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-black/60 px-4 text-xs text-white hover:bg-white/10 disabled:opacity-40';
export function LocalWorkspaceActions({runtime:r}:{runtime:LocalGenerationRuntime}){
 return <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
  {r.error&&<p role="alert" className="w-full text-xs text-amber-200">{r.error}</p>}
  {r.retained&&!r.job&&<button className={button} disabled={r.busy} onClick={()=>void r.submit()}><RefreshCw size={16} strokeWidth={1.75} aria-hidden/>Check submission</button>}
  <p role="status" className="text-xs text-white/60">{localJobMessage(r.job,r.reconnecting,r.save,r.ready)}</p>
  {r.generated&&r.save.state!=='saved'&&<button className={button} disabled={r.busy||r.save.state==='saving'||!r.ready?.saveAvailable} onClick={()=>void r.saveImage()}>{r.save.state==='saving'?<Loader2 size={16} aria-hidden className="animate-spin"/>:<Save size={16} strokeWidth={1.75} aria-hidden/>}{r.save.state==='save-failed'?'Retry save':'Save to Gallery'}</button>}
  {r.save.state==='saved'&&!r.save.historyRemoved&&<Link href="/gallery" className={button}>Open Gallery</Link>}
  {r.job&&!r.terminal&&!r.generated&&<button className={button} disabled={r.busy||r.job.state==='cancel-requested'} onClick={()=>void r.cancel()}><Square size={15} strokeWidth={1.75} aria-hidden/>Cancel generation</button>}
  {r.terminal&&<button className={button} disabled={r.busy} onClick={r.clear}><Sparkles size={16} strokeWidth={1.75} aria-hidden/>Create another</button>}
  {(!r.selectedReady||r.reconnecting)&&<button className={button} disabled={r.busy} onClick={()=>void r.act(r.checkReadiness)}><RefreshCw size={16} strokeWidth={1.75} aria-hidden/>Check connection</button>}
 </div>;
}
export function LocalWorkspaceSetup({runtime:r}:{runtime:LocalGenerationRuntime}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(!r.choosingModel)return;const current=dialog.current;current?.showModal();return()=>current?.close();},[r.choosingModel,r.ready?.ownerId,r.retained]);
 if(!r.choosingModel||!r.ready?.ownerId||r.retained)return null;
 return <dialog ref={dialog} className="m-auto w-[min(640px,calc(100vw-32px))] rounded-2xl border border-white/15 bg-[#101113] p-6 text-white backdrop:bg-black/70" aria-label={`Prepare ${r.model?.label}`} onClose={()=>r.setChoosingModel(false)}>
  <div className="flex items-center justify-between gap-3"><h2 className="text-base">{r.model?.label}</h2><button className={button} aria-label="Close model setup" onClick={()=>r.setChoosingModel(false)}><X size={16} aria-hidden/></button></div>
  <LocalModelSetup key={`${r.ready.ownerId}:${r.selection}`} ownerId={r.ready.ownerId} profile={r.selection} onAccess={()=>{}} onReady={()=>{r.setChoosingModel(false);void r.act(r.checkReadiness);}}/>
 </dialog>;
}
