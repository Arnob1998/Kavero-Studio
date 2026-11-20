"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Box, Cloud, ExternalLink, HardDrive, Loader2, Monitor, X, Search, Plus, Link2 } from "lucide-react";
import { z } from "zod";
import { hubSource, hubModel, hubList, hubDetail, type HubSource, type HubModel, type HubSnapshot, type HubLicense } from "./model-hub-contract";
import { ModelLicenseDialog, publisherLink } from "./model-license-dialog";
import styles from "./model-hub.module.css";
import {localProfiles, localProfile, type LocalProfile} from './browser-profiles';
import {modelCatalog} from '../catalog';
import {RemoteModels} from './remote-models';
import {Inspection,recipeStatus} from './model-inspection';
import {ModelCompatibilityPreview} from './model-compatibility-preview';
export {recipeStatus} from './model-inspection';
import {LocalModelInventory} from './local-model-inventory';
import {HuggingFaceBrowser} from './hugging-face-browser';
import {brand} from '@/lib/brand';

type Detail = z.infer<typeof hubDetail>;
type Page = z.infer<typeof hubList>;
const pendingSchema = z.object({ key: z.string().uuid(), model: hubSource }).strict();
const api = "/api/local-generation/models";
async function request(query = "", body?: unknown, signal?: AbortSignal) {
  const response = await fetch(api + query, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    signal: signal ?? AbortSignal.timeout(15000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Model information is unavailable. Try again.");
  return data;
}

export function ModelHub({ localEnabled, ownerId, cloudPanel, initialSource, connectEnabled = false,connectSetupEnabled=false }: { connectSetupEnabled?:boolean;connectEnabled?: boolean; localEnabled: boolean; ownerId?: string; cloudPanel: ReactNode; initialSource?: "local" | "remote" | "cloud" }) {
  const [tab, setTab] = useState<string>(initialSource === 'remote' ? 'computers' : initialSource ?? (localEnabled ? "local" : connectEnabled ? "computers" : "cloud"));
  const sources=['local','computers','cloud'];
  const [starter, setStarter] = useState<{label: string; profile?: string} | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const local = localProfile(query.get("starterProfile"));
    const apiModel = modelCatalog.find(model => model.modelAlias === query.get("starterModel") && model.capabilities.slots.some(slot => slot === "imageGeneration"));
    if (query.get("source") === "cloud") { if (apiModel) setStarter({label: apiModel.displayLabel}); }
    else if (local) setStarter({label: local.label, profile: local.profile});
  }, []);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className={styles.root}>
    {starter && <p className={styles.notice}>Starting model: {starter.label}. Review and set it up below; this choice does not activate a model. You can add more models or change your selection later.</p>}
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="Model source">
        {sources.map((value, index) => <button key={value} ref={element => { tabs.current[index] = element; }}
          className={styles.tab} id={`models-${value}-tab`} role="tab" aria-controls={`models-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? sources.length-1 : (index+(event.key==='ArrowRight'?1:-1)+sources.length)%sources.length;
            setTab(sources[next]); tabs.current[next]?.focus();
          }}>{value === "local" ? <HardDrive size={15} /> : value==='computers'?<Monitor size={15}/>:<Cloud size={15} />}{value === "local" ? "Local models" : value==='computers'?'Remote':"Cloud providers"}</button>)}
      </div>
    </div>
    <section id={`models-${tab}`} role="tabpanel" aria-labelledby={`models-${tab}-tab`} tabIndex={0}>
      {tab === "cloud" ? cloudPanel : tab==='computers'?<RemoteModels enabled={connectEnabled} setupEnabled={connectSetupEnabled} ownerId={ownerId}/>: localEnabled && ownerId ? <LocalModels key={ownerId} ownerId={ownerId} starterProfile={starter?.profile} /> : <div className={`${styles.panel} ${styles.empty}`}>
        <HardDrive size={22} className="mb-4" /><span className={styles.name}>Local models need a managed Kavero host.</span>
        <p className={styles.muted}>Use the local Docker setup to manage models on your computer. Cloud provider settings are available here.</p>
        <div className={styles.actions}><button className={styles.button} onClick={() => setTab("cloud")}>Open cloud providers <ArrowRight size={14} /></button></div>
      </div>}
    </section>
  </div>;
}

function LocalModels({ ownerId, starterProfile }: { ownerId: string; starterProfile?: string }) {
  const [adding,setAdding]=useState(false);
  const addDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(!adding)return;const dialog=addDialog.current;dialog?.showModal();return()=>dialog?.close();},[adding]);
  const [managedProfile, setManagedProfile] = useState<LocalProfile | null>(null);
  const [page, setPage] = useState<Page | null>(null), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState(""), [variant, setVariant] = useState("");
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [detailError, setDetailError] = useState<string | null>(null),[libraryError,setLibraryError]=useState<string|null>(null);
  const [license, setLicense] = useState<{ title: string; value: HubLicense | null } | null>(null);
  const locked = useRef(false), epoch = useRef(0), controllers = useRef(new Set<AbortController>());
  const starterHandled = useRef(false);
  const cacheKey = `kavero-model-inspection:${ownerId}`;
  useEffect(() => {
    if (!page || !starterProfile || starterHandled.current) return;
    starterHandled.current = true;
    if (pending || source.trim()) return;
    const profile = localProfile(starterProfile);
    const seed = page.seeds.find(entry => profile && entry.source.preferredFile === profile.file);
    if (seed) { setSource(seed.source.source); setVariant(seed.source.preferredFile ?? ""); }
  }, [page, starterProfile, pending, source]);
  useEffect(() => {
    const current = ++epoch.current;
    try { const cached = pendingSchema.parse(JSON.parse(localStorage.getItem(cacheKey) ?? "null")); setPending(cached); setSource(cached.model.source); setVariant(cached.model.preferredFile ?? ""); } catch { /* Cache holds retry intent, never model authority. */ }
    return () => { if (epoch.current === current) ++epoch.current; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, [cacheKey]);
  useEffect(() => {
    const controller = new AbortController(), current = epoch.current; let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = hubList.parse(await request(`?offset=${offset}`, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])));
        if (epoch.current !== current || controller.signal.aborted) return;
        setPage(next); setLibraryError(null);
        if (next.models.some(model => model.state === "inspecting")) timer = setTimeout(load, 3000);
      } catch (e) { if (!controller.signal.aborted && epoch.current === current) setLibraryError(e instanceof Error ? e.message : "Models could not be loaded."); }
      finally { if (!controller.signal.aborted && epoch.current === current) setLoading(false); }
    }
    setLoading(true); void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [offset, refresh]);
  const selectedState = page?.models.find(model => model.id === selected)?.state;
  useEffect(() => {
    setDetail(null); setDetailError(null); if (!selected) return;
    const controller = new AbortController(), current = epoch.current;
    void request(`?id=${encodeURIComponent(selected)}`, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      .then(data => { if (!controller.signal.aborted && epoch.current === current) setDetail(hubDetail.parse(data)); })
      .catch(e => { if (!controller.signal.aborted && epoch.current === current) setDetailError(e instanceof Error ? e.message : "Model details are unavailable."); });
    return () => controller.abort();
  }, [selected, selectedState, refresh]);

  async function inspect(model: HubSource, previous?: z.infer<typeof pendingSchema>) {
    if (locked.current) return;
    const attempt = previous ?? { key: crypto.randomUUID(), model };
    const current = epoch.current, controller = new AbortController(); controllers.current.add(controller);
    locked.current = true; setBusy(true); setError(null);
    setSource(attempt.model.source); setVariant(attempt.model.preferredFile ?? "");
    try {
      // Save the original retry identity before sending. Refresh performs GETs only.
      localStorage.setItem(cacheKey, JSON.stringify(attempt)); setPending(attempt);
      const result = hubModel.parse((await request("", attempt, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))).model);
      if (epoch.current !== current) return;
      localStorage.removeItem(cacheKey); setPending(null); setSelected(result.id); setOffset(0); setRefresh(value => value + 1);
    } catch (e) { if (epoch.current === current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "Inspection could not start. Retry the same request."); }
    finally { controllers.current.delete(controller); if (epoch.current === current) { locked.current = false; setBusy(false); } }
  }
  function addSource() {
    if (pending) { void inspect(pending.model, pending); return; }
    try {
      const url = new URL(source.trim());
      if (url.protocol !== "https:" || url.hostname !== "huggingface.co" || url.username || url.password || url.search || url.hash || url.port) throw Error();
      void inspect({ id: `model-${crypto.randomUUID()}`, source: url.href, ...(variant.trim() ? { preferredFile: variant.trim() } : {}) });
    } catch { setError("Enter a public Hugging Face repository or model-file link."); }
  }
  const statusText = (model: HubModel) => model.state === "inspecting" ? "Inspecting…" : model.state === "retry-required" ? "Inspection interrupted" : recipeStatus(model.recipeSupport);
  return <div className={styles.root}>
    <div className={styles.libraryToolbar}><div><h2>Local image models</h2><p>Find a model. Make it yours.</p></div><button id="add-local-model" className={`${styles.button} ${styles.primary}`} onClick={()=>{setSelected(null);setAdding(true);}}><Plus size={15}/>Add from Hugging Face</button></div>
    <LocalModelInventory compact key={ownerId} ownerId={ownerId} managedProfile={managedProfile} onManage={setManagedProfile}/>
    <HuggingFaceBrowser disabled={busy||!!pending} onSelect={model=>{setSelected(null);setAdding(true);void inspect({id:`model-${crypto.randomUUID()}`,source:`https://huggingface.co/${model.id}`});}}/>
    {pending&&!adding&&<p className={styles.muted}>{busy?'Checking model...':'A model check needs attention.'} <button className={styles.license} onClick={()=>setAdding(true)}>Continue adding model</button></p>}
    {(!!page?.models.length||offset>0||page?.nextOffset!=null)&&<section className={styles.savedModels} aria-label="Saved model links"><div className={styles.resultsHeading}><span>Your model links</span><span>Saved from Hugging Face</span></div>{page?.models.map(model=><button key={model.id} className={styles.savedModelRow} onClick={()=>{setSelected(model.id);setAdding(true);}}><Box size={17}/><span><strong>{model.source.source.split('/').slice(-1)[0]}</strong><small>{model.source.preferredFile??'Choose a file'}</small></span><span className={styles.status}>{statusText(model)}</span><ArrowRight size={15}/></button>)}<div className={styles.browserPagination}><button className={styles.textButton} disabled={offset===0||loading} onClick={()=>setOffset(value=>Math.max(0,value-5))}>Previous</button><button className={styles.textButton} disabled={page?.nextOffset==null||loading} onClick={()=>setOffset(page!.nextOffset!)}>Next</button></div></section>}
    {libraryError&&<p role="status" className={styles.muted}>{libraryError} Hugging Face browsing is available separately.</p>}
    {projectRepositoryLink(brand.repositoryUrl)&&<a className={styles.quietLink} href={projectRepositoryLink(brand.repositoryUrl)!} target="_blank" rel="noopener noreferrer">Star on GitHub</a>}
    {adding&&<dialog ref={addDialog} className={`${styles.dialog} ${styles.addDialog}`} aria-labelledby="add-model-title" onClose={event=>{if(event.target!==event.currentTarget)return;setAdding(false);document.getElementById('add-local-model')?.focus();}}>
      <div className={styles.heading}><div><span className={styles.sourceLabel}><Link2 size={13}/>HUGGING FACE</span><h2 id="add-model-title">{selected?'Model details':'Add a model'}</h2><p>Check its files, compatibility and license before downloading.</p></div><button className={styles.iconButton} aria-label="Close add model" onClick={()=>setAdding(false)}><X size={18}/></button></div>
    <section className={styles.addLink} aria-label="Add a local model">
      <div className={styles.form}>
        <label htmlFor="model-source">Hugging Face model link</label>
        <form className={styles.inputRow} onSubmit={event => { event.preventDefault(); addSource(); }}>
          <input autoFocus id="model-source" className={styles.input} type="url" required maxLength={1024} value={source} disabled={busy || !!pending} onChange={event => setSource(event.target.value)} placeholder="https://huggingface.co/owner/model" autoComplete="off" />
          <button className={`${styles.button} ${styles.primary}`} disabled={busy || !source.trim()} type="submit">{busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{pending ? "Retry check" : "Check model"}</button>
        </form>
        <p className={styles.muted}>We check compatibility first. No model files are downloaded.</p>
        <details className="mt-3"><summary className={styles.status}>Advanced: specific filename</summary><label className="mt-3" htmlFor="model-variant">Filename (optional)</label><input id="model-variant" className={styles.input} value={variant} maxLength={180} disabled={busy || !!pending} onChange={event => setVariant(event.target.value)} placeholder="model.gguf" /></details>
        {pending && !busy && <div className={styles.actions}><p className={styles.muted}>Your previous check did not finish. Retry to continue.</p><button className={styles.button} onClick={() => { localStorage.removeItem(cacheKey); setPending(null); }}>Check a different model</button></div>}
      </div>
    </section>
    {(error||libraryError) && <p role="alert" className={styles.error}>{error??libraryError}</p>}
    <div className={selected?styles.catalog:styles.root}>
      {selected&&<section className={`${styles.panel} ${styles.detail}`} aria-label="Model inspection">
        {detailError ? <p role="alert" className={styles.error}>{detailError}</p> : !detail ? <p className={styles.muted} role="status">Loading inspection…</p> : <>
          <div className={styles.detailHeader}><div><h2>{detail.model.source.source.split("/").slice(-1)[0]}</h2><p className={styles.muted}>{statusText(detail.model)}</p></div>{publisherLink(detail.model.source.source) && <a className={styles.button} href={publisherLink(detail.model.source.source)!} target="_blank" rel="noopener noreferrer" aria-label="Open model source"><ExternalLink size={14} /></a>}</div>
          {detail.snapshot ? <><Inspection snapshot={detail.snapshot} onLicense={(title, value) => setLicense({ title, value })} onVariant={file => { void inspect({ ...detail.model.source, preferredFile: file }); }} disabled={busy || !!pending} /><ModelCompatibilityPreview key={detail.model.id} ownerId={ownerId} source={detail.model.source} destination={{kind:"local"}} destinationName="This computer"/>{(()=>{
            const verified=localProfiles.find(model=>detail.snapshot?.recipeSupport==='known-recipe'&&detail.snapshot.recipeId===model.recipeId&&detail.snapshot.recipeManifest===model.manifest&&detail.snapshot.selectedFile?.name===model.file);
            return verified?<div className={styles.actions}><button className={styles.button} onClick={()=>{setAdding(false);setManagedProfile(verified.profile);}}>Continue</button></div>:null;
          })()}</> : <>
            <p className={`${styles.muted} mt-5`}>{detail.model.state === "retry-required" ? "The host stopped before inspection finished. Retry the original request." : "Checking publisher metadata. You can leave this page and return later."}</p>
          </>}
          {detail.model.state === "retry-required" && <div className={styles.actions}><button className={styles.button} disabled={busy || !!pending} onClick={() => void inspect(detail.model.source, { key: detail.model.key, model: detail.model.source })}>Retry interrupted inspection</button></div>}
        </>}
      </section>}
    </div>
    {license && <ModelLicenseDialog title={license.title} license={license.value} onClose={() => setLicense(null)} />}
    </dialog>}
  </div>;
}

export function projectRepositoryLink(value:unknown){try{if(typeof value!=='string')return null;const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)?url.href:null;}catch{return null;}}
