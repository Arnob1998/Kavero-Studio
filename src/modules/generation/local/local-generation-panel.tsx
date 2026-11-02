"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cpu, Download, Loader2, Sparkles } from "lucide-react";
import { LOCAL_IMAGE_CAPABILITIES as limits, localJobMessage, localPromptError, type LocalBrowserJob, type LocalBrowserSave, type LocalBrowserReadiness } from "./capabilities";
import styles from "./local-generation.module.css";
import {localProfile,type LocalProfile} from '@/modules/model-providers/local/browser-profiles';

type Submission = { idempotencyKey: string; intent: { prompt: string; profile: LocalProfile; width: 512; height: 512; count: 1 } };
type Resume = { submission: Submission; jobId?: string };
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400";
async function api(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(method === "POST" && url.endsWith("/save") ? 105000 : 25000),
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  return { response, data };
}
export function LocalGenerationPanel({ prompt, onPromptChange }: { prompt: string; onPromptChange: (value: string) => void }) {
  const [ready, setReady] = useState<LocalBrowserReadiness | null>(null);
  const [job, setJob] = useState<LocalBrowserJob | null>(null);
  const [save, setSave] = useState<LocalBrowserSave>({ state: "unsaved" });
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const resume = useRef<Resume | null>(null), ownerKey = useRef<string | null>(null), locked = useRef(false);
  const mounted = useRef(false);
  const jobRef = useRef(job); jobRef.current = job;
  const saveRef = useRef(save); saveRef.current = save;
  const persist = (value: Resume) => {
    if (!ownerKey.current) throw new Error("Sign in before creating a local image.");
    // Persist before admission. An uncertain acknowledgement must reuse this key.
    sessionStorage.setItem(ownerKey.current, JSON.stringify(value)); resume.current = value;
  };
  const checkReadiness = async () => {
    const { response, data } = await api("/api/local-generation/readiness");
    if (!response.ok) throw new Error(data.error || "Local generation is unavailable.");
    if (!mounted.current) return;
    const nextKey = `kavero-local-job:${data.ownerId}`;
    if (ownerKey.current && ownerKey.current !== nextKey) {
      resume.current = null; setJob(null); setSave({ state: "unsaved" }); setReconnecting(false);
    }
    const pendingSwitch = ['', ':q3'].some(suffix => {
      try { return Boolean(JSON.parse(localStorage.getItem(`kavero-local-setup:${data.ownerId}${suffix}:switch`) || 'null')?.key); }
      catch { return false; }
    });
    setSwitchPending(pendingSwitch);
    setReady({...data,ready:data.ready&&!!localProfile(data.model?.profile)&&!pendingSwitch});
    ownerKey.current = nextKey;
    if (!resume.current) {
      try {
        const restored = JSON.parse(sessionStorage.getItem(ownerKey.current) || "null") as Resume | null;
        if (restored && /^[a-f0-9-]{36}$/i.test(restored.submission?.idempotencyKey ?? "") && localProfile(restored.submission.intent.profile) && restored.submission.intent.width===512&&restored.submission.intent.height===512&&restored.submission.intent.count===1 && typeof restored.submission.intent.prompt==='string'&&!localPromptError(restored.submission.intent.prompt)) {
          resume.current = restored; onPromptChange(restored.submission.intent.prompt);
          if (restored.jobId && /^[a-f0-9-]{36}$/i.test(restored.jobId)) setJob({ id: restored.jobId, state: "submission-unknown", createdAt: "" });
          else setReconnecting(true);
        }
      } catch { /* Invalid cached data never authorizes a request. */ }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void checkReadiness().catch(e => { if (mounted.current) setError(e.message); });
    const timer=setInterval(()=>{if(!locked.current)void checkReadiness().catch(e=>{if(mounted.current){setReady(value=>value?{...value,ready:false}:null);setError(e.message);}});},4000);
    return () => { mounted.current = false;clearInterval(timer); };
    // The resumed prompt belongs to the authenticated owner, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready?.ownerId) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!locked.current && resume.current?.jobId) {
          const id = resume.current.jobId;
          const [status, saving] = await Promise.all([api(`/api/local-generation/jobs/${id}`), api(`/api/local-generation/jobs/${id}/save`)]);
          if (stopped || locked.current || resume.current?.jobId !== id) return;
          if (status.response.status === 404 || status.response.status === 401) { setError("This job is unavailable for your account."); setReconnecting(true); }
          else if (status.response.ok) { setJob(status.data.job); setReconnecting(Boolean(status.data.reconnecting)); }
          else setReconnecting(true);
          if (saving.response.ok) setSave(current => current.state === "save-failed" && saving.data.save.state === "unsaved" ? current : saving.data.save);
        }
      } catch { if (!stopped) setReconnecting(true); }
      finally { if (!stopped) timer = setTimeout(poll, 4000); }
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [ready?.ownerId]);
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await action(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to complete this action."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = () => act(async () => {
    const existing = resume.current;
    if (!existing) {
      if(!ready?.ready||!localProfile(ready.model?.profile))throw Error('Choose and prepare a model in Model Hub before creating an image.');
      const invalid = localPromptError(prompt); if (invalid) throw new Error(invalid);
      persist({ submission: { idempotencyKey: crypto.randomUUID(), intent: { prompt, profile: ready.model!.profile, width: limits.width, height: limits.height, count: limits.count } } });
    }
    const { response, data } = await api("/api/local-generation/jobs", "POST", resume.current!.submission);
    if (data.job) { persist({ ...resume.current!, jobId: data.job.id }); if (mounted.current) setJob(data.job); }
    if (!response.ok) throw new Error(data.error || "Unable to submit. Retry checks the same request.");
    if (mounted.current) setReconnecting(false);
  });
  const saveImage = () => act(async () => {
    if (!jobRef.current) return;
    setSave({ ...saveRef.current, state: "saving" });
    try {
      const { response, data } = await api(`/api/local-generation/jobs/${jobRef.current.id}/save`, "POST", {});
      if (mounted.current) setSave(data.save ?? { state: "save-failed" });
      if (!response.ok) throw new Error(data.error || "Saving failed. Your image can still be downloaded.");
    } catch (e) { if (mounted.current) setSave(current => ({ ...current, state: "save-failed" })); throw e; }
  });
  const cancel = () => act(async () => {
    if (!jobRef.current) return;
    const { response, data } = await api(`/api/local-generation/jobs/${jobRef.current.id}`, "DELETE");
    if (data.job && mounted.current) setJob(data.job);
    if (!response.ok) throw new Error(data.error || "Cancellation is not confirmed. Check status before retrying.");
  });
  const clear = () => {
    if (ownerKey.current) sessionStorage.removeItem(ownerKey.current);
    resume.current = null; setJob(null); setSave({ state: "unsaved" }); setReconnecting(false); setError(null);
  };
  const terminal = ["failed", "cancelled"].includes(job?.state ?? "") || job?.output?.state === "invalid" || job?.output?.state === "expired" || save.state === "saved";
  const generated = job?.output?.state === "generated";
  const imageURL = save.state === "saved" && !save.historyRemoved ? `/api/gallery/images/${save.imageId}/content` : generated && job ? `/api/local-generation/jobs/${job.id}/output` : null;
  const promptError = localPromptError(prompt);
  const model=localProfile(resume.current?.submission.intent.profile??ready?.model?.profile);
  return <section className={styles.page} aria-label="Local image generation">
    <div className={styles.heading}><p className={styles.eyebrow}>Local generation</p><h1>Create on your machine.</h1><p>Your prompt, your GPU. No planning model or paid key needed.</p></div>
    <div className={styles.layout}>
    <div className={styles.modelCard}>
      <div className={styles.modelHeading}><span className={styles.modelIcon}><Cpu size={24} /></span><div className="min-w-0 flex-1"><h2>{model?.label??'Choose a local model'}</h2><p>One image · 512 × 512 · text to image</p></div></div>
      <span className={styles.badge} data-ready={Boolean(ready?.ready)}>{ready ? ready.ready ? "Verified setup" : "Setup needed" : "Checking…"}</span>
      <Link href="/settings/models" className={`${button} mt-4`}>{ready?.ready?'Change model':'Open Model Hub'}</Link>
      {switchPending&&<p className="mt-3 text-xs text-amber-200">Finish or recover the model switch in Model Hub before creating another image.</p>}
      {resume.current&&ready?.model&&resume.current.submission.intent.profile!==ready.model.profile&&<p className="mt-3 text-xs text-white/50">This result keeps its original model. The active model is {ready.model.label}.</p>}
      <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-xs text-white/50 sm:grid-cols-2"><p>Inference <strong className="ml-2 font-medium text-white/80">This machine</strong></p><p>Save to <strong className="ml-2 font-medium text-white/80">{ready?.saveDestination ?? "Checking storage…"}</strong></p></div>
      {ready?.hardware && (ready.hardware.freeVramMiB < 6144 || ready.hardware.freeRamBytes < 8 * 1024 ** 3) && <p className="mt-3 text-xs text-amber-200">Memory is busy. Your job will wait for at least 6 GB of free GPU memory and 8 GB of free RAM.</p>}
    </div>
    <div className={styles.creation}>
    <div className={styles.promptCard}>
      <div className={styles.promptHeading}><Sparkles size={16}/><h2>Describe your image</h2></div>
      <label htmlFor="local-image-prompt" className="sr-only">Local image prompt</label><textarea id="local-image-prompt" value={prompt} onChange={e => onPromptChange(e.target.value)} readOnly={Boolean(resume.current)} placeholder="Describe the image you have in mind…" className="min-h-40 w-full resize-y bg-transparent p-5 text-base outline-none placeholder:text-white/30 focus:ring-2 focus:ring-inset focus:ring-blue-500" aria-describedby="local-prompt-limit" />
      <div className="flex items-center justify-between gap-3 border-t border-white/10 p-4"><span id="local-prompt-limit" className={`text-xs ${prompt.length > limits.maxPromptCharacters ? "text-amber-300" : "text-white/40"}`}>{prompt.length.toLocaleString()} / 1,000</span><button className={`${button} bg-blue-600 hover:bg-blue-500`} disabled={busy || Boolean(job) || (!resume.current && !ready?.ready) || (!resume.current && Boolean(promptError))} onClick={() => void submit()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{resume.current ? "Check submission" : "Create image"}</button></div>
    </div>
    {prompt.length > limits.maxPromptCharacters && <p className="mt-3 text-sm text-amber-300" role="alert">{promptError}</p>}
    <div className="mt-5" aria-live="polite"><p className="text-sm text-white/70">{!ready?.ready && !job && !reconnecting ? "Choose and prepare a model in Model Hub to create an image." : localJobMessage(job, reconnecting, save)}</p>{error && <p className="mt-2 text-sm text-amber-300" role="alert">{error}</p>}</div>
    {imageURL && !save.historyRemoved && <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"><img src={imageURL} alt="Your locally generated image" className="mx-auto aspect-square w-full max-w-lg object-contain" /></div>}
    <div className="mt-4 flex flex-wrap gap-3">
      {imageURL && !save.historyRemoved && <a href={imageURL} download={`kavero-${job?.id}.png`} className={button}><Download size={16} />Download image</a>}
      {generated && save.state !== "saved" && <button className={button} disabled={busy || save.state === "saving" || !ready?.saveAvailable} onClick={() => void saveImage()}>{save.state === "save-failed" ? "Retry save" : "Save to Gallery"}</button>}
      {save.state === "saved" && !save.historyRemoved && <Link href="/gallery" className={button}>Open Gallery</Link>}
      {job && !terminal && !generated && <button className={button} disabled={busy || job.state === "cancel-requested"} onClick={() => void cancel()}>Cancel generation</button>}
      {terminal && <button className={button} disabled={busy} onClick={clear}>Create another</button>}
      {(!ready?.ready || reconnecting || (generated && !ready?.saveAvailable)) && <button className={button} disabled={busy} onClick={() => void act(checkReadiness)}>Check connection</button>}
    </div>
    {generated && save.state !== "saved" && job?.output?.expiresAt && <p className="mt-3 text-xs text-white/40">Download available until {new Date(job.output.expiresAt).toLocaleString()}. Saving can be retried without generating again.</p>}
    <details className="mt-7 text-xs text-white/45"><summary className="cursor-pointer py-2">More details</summary><div className="mt-2 space-y-2 leading-relaxed"><p>{model?.label??"Verified local profile"} · Windows x64 / one RTX 30 or 40 series GPU / Vulkan. Requires 8 GB VRAM and 16 GB system memory. Device identity and settings are checked again before execution.</p>{ready?.hardware && <p>Free GPU memory: {(ready.hardware.freeVramMiB / 1024).toFixed(1)} GB · free RAM: {(ready.hardware.freeRamBytes / 1024 ** 3).toFixed(1)} GB. Competing work can delay generation.</p>}<p>References, editing, sequences and cloud quality controls are unavailable here. Prompts over 1,000 characters are rejected, never shortened. Cloud settings are preserved when you return.</p><p>Local inference does not make sign-in or remote storage work offline. Kavero manages the engine and model download after you accept the pinned terms.</p></div></details>
    </div>
    </div>
  </section>;
}
