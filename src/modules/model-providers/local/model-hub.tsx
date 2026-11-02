"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Box, Cloud, ExternalLink, HardDrive, Loader2, Plus, RefreshCw } from "lucide-react";
import { z } from "zod";
import { hubSource, hubModel, hubList, hubDetail, type HubSource, type HubModel, type HubSnapshot, type HubLicense } from "./model-hub-contract";
import { ModelLicenseDialog, publisherLink } from "./model-license-dialog";
import styles from "./model-hub.module.css";
import {localProfiles} from './browser-profiles';
import {LocalModelSetup} from '@/modules/generation/local/local-model-setup';

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

export function ModelHub({ localEnabled, ownerId, cloudPanel, initialSource }: { localEnabled: boolean; ownerId?: string; cloudPanel: ReactNode; initialSource?: "local" | "cloud" }) {
  const [tab, setTab] = useState(initialSource ?? (localEnabled ? "local" : "cloud"));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label="Model source">
        {(["local", "cloud"] as const).map((value, index) => <button key={value} ref={element => { tabs.current[index] = element; }}
          className={styles.tab} id={`models-${value}-tab`} role="tab" aria-controls={`models-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
            setTab(next === 0 ? "local" : "cloud"); tabs.current[next]?.focus();
          }}>{value === "local" ? <HardDrive size={15} /> : <Cloud size={15} />}{value === "local" ? "Local models" : "Cloud providers"}</button>)}
      </div>
      <p className={styles.notice}>Before using a model, review its publisher’s license and usage policies.</p>
    </div>
    <section id={`models-${tab}`} role="tabpanel" aria-labelledby={`models-${tab}-tab`} tabIndex={0}>
      {tab === "cloud" ? cloudPanel : localEnabled && ownerId ? <LocalModels key={ownerId} ownerId={ownerId} /> : <div className={`${styles.panel} ${styles.empty}`}>
        <HardDrive size={22} className="mb-4" /><span className={styles.name}>Local models need a managed Kavero host.</span>
        <p className={styles.muted}>Use the local Docker setup to manage models on your computer. Cloud provider settings are available here.</p>
        <div className={styles.actions}><button className={styles.button} onClick={() => setTab("cloud")}>Open cloud providers <ArrowRight size={14} /></button></div>
      </div>}
    </section>
  </div>;
}

function LocalModels({ ownerId }: { ownerId: string }) {
  const [page, setPage] = useState<Page | null>(null), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState(""), [variant, setVariant] = useState("");
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [detailError, setDetailError] = useState<string | null>(null);
  const [license, setLicense] = useState<{ title: string; value: HubLicense | null } | null>(null);
  const locked = useRef(false), epoch = useRef(0), controllers = useRef(new Set<AbortController>());
  const cacheKey = `kavero-model-inspection:${ownerId}`;
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
        setPage(next); setError(null);
        if (next.models.some(model => model.state === "inspecting")) timer = setTimeout(load, 3000);
      } catch (e) { if (!controller.signal.aborted && epoch.current === current) setError(e instanceof Error ? e.message : "Models could not be loaded."); }
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
    <section className={styles.panel} aria-label="Add a local model">
      <div className={styles.form}>
        <label htmlFor="model-source">Add from Hugging Face</label>
        <form className={styles.inputRow} onSubmit={event => { event.preventDefault(); addSource(); }}>
          <input id="model-source" className={styles.input} type="url" required maxLength={1024} value={source} disabled={busy || !!pending} onChange={event => setSource(event.target.value)} placeholder="https://huggingface.co/owner/model" autoComplete="off" />
          <button className={`${styles.button} ${styles.primary}`} disabled={busy || !source.trim()} type="submit">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{pending ? "Retry inspection" : "Inspect model"}</button>
        </form>
        <p className={styles.muted}>Checks the model and its components. No weights are downloaded.</p>
        <details className="mt-3"><summary className={styles.status}>Choose a specific file</summary><label className="mt-3" htmlFor="model-variant">Filename (optional)</label><input id="model-variant" className={styles.input} value={variant} maxLength={180} disabled={busy || !!pending} onChange={event => setVariant(event.target.value)} placeholder="model.gguf" /></details>
        {pending && !busy && <div className={styles.actions}><p className={styles.muted}>A previous request needs acknowledgement. Retry keeps its original identity.</p><button className={styles.button} onClick={() => { localStorage.removeItem(cacheKey); setPending(null); }}>Start another inspection</button></div>}
      </div>
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.catalog}>
      <section className={`${styles.panel} ${styles.list}`} aria-label="Local model library" aria-busy={loading}>
        <div className={styles.heading}><h2>Your models</h2><button className={styles.button} aria-label="Refresh models" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button></div>
        {page?.models.map(model => <div key={model.id} className={styles.row} data-selected={selected === model.id}>
          <button className={styles.rowButton} aria-pressed={selected === model.id} onClick={() => setSelected(model.id)}>
            <span className={styles.modelIcon}><Box size={17} /></span><span className={styles.rowText}><span className={styles.name}>{model.source.source.split("/").slice(-1)[0]}</span><span className={styles.description}>{model.source.preferredFile ?? "Variant not chosen"}</span><span className={styles.description}>{statusText(model)}</span></span><ArrowRight size={14} className="shrink-0 text-white/40" />
          </button>
        </div>)}
        {page && !page.models.length && <p className={styles.empty}>Inspect a model link, or start with one of the supplied entries below.</p>}
        {loading && !page && <p className={styles.empty} role="status">Loading model library…</p>}
        {!loading && !page && <div className={styles.empty}>The managed host could not be reached.<div className={styles.actions}><button className={styles.button} onClick={() => setRefresh(value => value + 1)}>Try again</button></div></div>}
        {!!page?.seeds.length && <><p className={styles.sectionLabel}>Supplied entries</p>{page.seeds.map(({ source: seed }) => <div className={styles.row} key={seed.id}>
          <span className={styles.modelIcon}><HardDrive size={16} /></span><span className={styles.rowText}><span className={styles.name}>{seed.preferredFile?.includes("Q3") ? "Qwen Image 2.1 · Q3" : seed.preferredFile?.includes("Q4") ? "Qwen Image 2.1 · Q4" : seed.id}</span><span className={styles.description}>{seed.preferredFile ?? seed.source}</span></span>
          <button className={styles.button} disabled={busy || !!pending} onClick={() => void inspect(seed)} aria-label={`Inspect ${seed.preferredFile ?? seed.id}`}>Inspect</button>
        </div>)}</>}
        {(offset > 0 || page?.nextOffset !== null && page?.nextOffset !== undefined) && <div className={styles.footer}><button className={styles.button} disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 5))}>Previous</button><span className={styles.status}>Page {offset / 5 + 1}</span><button className={styles.button} disabled={page?.nextOffset == null || loading} onClick={() => setOffset(page!.nextOffset!)}>Next</button></div>}
        <div className={styles.footer}><p className={styles.muted}>Repository defaults: <code>scripts/local-generation/models.json</code></p></div>
      </section>
      <section className={`${styles.panel} ${styles.detail}`} aria-label="Model inspection">
        {detailError ? <p role="alert" className={styles.error}>{detailError}</p> : !selected ? <div className={styles.empty}><Box size={24} className="mb-4" /><span className={styles.name}>A closer look at your model.</span><p className={styles.muted}>Select an inspected model to see its variant, compatibility and component licenses.</p></div> : !detail ? <p className={styles.muted} role="status">Loading inspection…</p> : <>
          <div className={styles.detailHeader}><div><h2>{detail.model.source.source.split("/").slice(-1)[0]}</h2><p className={styles.muted}>{statusText(detail.model)}</p></div>{publisherLink(detail.model.source.source) && <a className={styles.button} href={publisherLink(detail.model.source.source)!} target="_blank" rel="noopener noreferrer" aria-label="Open model source"><ExternalLink size={14} /></a>}</div>
          {detail.snapshot ? <><Inspection snapshot={detail.snapshot} onLicense={(title, value) => setLicense({ title, value })} onVariant={file => { void inspect({ ...detail.model.source, preferredFile: file }); }} disabled={busy || !!pending} />{(()=>{
            const verified=localProfiles.find(model=>detail.snapshot?.recipeSupport==='known-recipe'&&detail.snapshot.recipeId===model.recipeId&&detail.snapshot.recipeManifest===model.manifest&&detail.snapshot.selectedFile?.name===model.file);
            return verified?<div className="mt-5 border-t border-white/10 pt-5"><h3 className="mb-3 text-sm font-medium">Set up & use</h3><LocalModelSetup key={verified.profile} profile={verified.profile} ownerId={ownerId} hideNotices onAccess={()=>{}} onReady={()=>{}} /></div>:null;
          })()}</> : <>
            <p className={`${styles.muted} mt-5`}>{detail.model.state === "retry-required" ? "The host stopped before inspection finished. Retry the original request." : "Checking publisher metadata. You can leave this page and return later."}</p>
          </>}
          {detail.model.state === "retry-required" && <div className={styles.actions}><button className={styles.button} disabled={busy || !!pending} onClick={() => void inspect(detail.model.source, { key: detail.model.key, model: detail.model.source })}>Retry interrupted inspection</button></div>}
        </>}
      </section>
    </div>
    {license && <ModelLicenseDialog title={license.title} license={license.value} onClose={() => setLicense(null)} />}
  </div>;
}

export function recipeStatus(value: string) {
  return ({ "known-recipe": "Compatible recipe", "needs-variant": "Choose a variant", "needs-components": "Component check incomplete", "unsupported-runtime": "Unsupported runtime", "revision-changed": "Publisher revision changed", "access-required": "Publisher access required", "unsupported-format": "Unsupported model format" } as Record<string, string>)[value] ?? "Inspection unavailable";
}
const roleLabel = (role: string) => ({ "image-weights": "Image model", "text-encoder": "Text encoder", vae: "VAE", engine: "Engine" } as Record<string, string>)[role] ?? role;
function Inspection({ snapshot, onLicense, onVariant, disabled }: { snapshot: HubSnapshot; onLicense: (title: string, value: HubLicense | null) => void; onVariant: (file: string) => void; disabled: boolean }) {
  return <>
    <dl className={styles.facts}>
      <div><dt>Variant</dt><dd>{snapshot.selectedFile?.name ?? "Not selected"}</dd></div>
      <div><dt>Model size</dt><dd>{snapshot.selectedFile?.bytes != null ? `${(snapshot.selectedFile.bytes / 1024 ** 3).toFixed(2)} GB · weights only` : "Unknown"}</dd></div>
      <div><dt>Revision</dt><dd>{snapshot.revision?.slice(0, 12) ?? "Unverified"}</dd></div>
      <div><dt>License</dt><dd><button className={styles.license} onClick={() => onLicense("Model license", snapshot.license)}>{snapshot.license?.identifier ?? "Unknown"} <ExternalLink size={11} /></button></dd></div>
      <div><dt>Hardware</dt><dd>Not checked by inspection</dd></div>
    </dl>
    {snapshot.recipeSupport === "needs-variant" && <><label className={styles.muted} htmlFor="inspected-variant">Choose a model file to inspect</label><select id="inspected-variant" className={`${styles.input} mt-2`} value="" disabled={disabled} onChange={event => { if (event.target.value) onVariant(event.target.value); }}><option value="">Select a variant…</option>{snapshot.variants.map(file => <option key={file.name} value={file.name}>{file.name}</option>)}</select></>}
    {snapshot.components.length > 0 && <><h3 className="text-xs font-medium">Components & licenses</h3>{snapshot.components.map(component => <div className={styles.component} key={component.role}><span>{roleLabel(component.role)}<span className={styles.description}>{component.status === "verified-metadata" ? "Metadata verified" : component.status === "pinned-recipe-only" ? "Pinned engine" : "Needs verification"}</span></span><button className={styles.license} aria-label={`View ${roleLabel(component.role)} license`} onClick={() => onLicense(`${roleLabel(component.role)} license`, component.license)}>{component.license.identifier ?? "Unknown"}</button></div>)}</>}
    <p className={`${styles.muted} mt-5`}>{snapshot.recipeSupport === "known-recipe" ? "The source matches a verified recipe. Installation, hardware readiness and generation are checked separately." : snapshot.recipeSupport === "needs-variant" ? "This repository contains multiple weight files. Pick the version you want to inspect." : snapshot.recipeSupport === "revision-changed" ? "The publisher updated this repository. It no longer matches the pinned recipe; a newer revision has not been verified." : snapshot.recipeSupport === "needs-components" ? "One or more required components could not be verified. Inspection does not authorize installation." : snapshot.recipeSupport === "access-required" ? "This repository requires publisher access. Gated and private downloads are not supported here yet." : "This source has no complete verified recipe for Kavero’s managed runtime. It can be inspected, but cannot be installed or used."}</p>
    <div className={styles.actions}><Link className={styles.button} href="/generate">Open Generate <ArrowRight size={13} /></Link></div>
  </>;
}
