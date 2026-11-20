"use client";
import Link from "next/link";
import {Save,Square,Download,Images} from 'lucide-react';
import {useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {computerList,computerLabels,type Computer} from "@/modules/model-providers/local/connect/computer-contract";
import {browserResult,browserSave,canFinish,readReceipt,statusMessage,verifyJob,type Receipt,type BrowserJob,type BrowserResult,type BrowserSave} from "./browser-contract";
import {localPromptError} from "../local/capabilities";
import styles from "../local/local-generation.module.css";

const button="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400";
class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
const friendly=(value:string)=>({"queue-full":"The computer queue is full. Wait for a job to finish, then reconnect.","binding-unavailable":"The model or computer changed. Check Model Hub before retrying.","not-found":"This job or computer is unavailable for your account.","rate-limited":"Too many requests. Wait a moment before reconnecting."}[value]??value);
export function ConnectGenerationPanel(props:{ownerId:string;prompt:string;onPromptChange:(value:string)=>void;onBusyChange?:(value:boolean)=>void}){return <Panel key={props.ownerId} {...props}/>;}
function Panel({ownerId,prompt,onPromptChange,onBusyChange}:{ownerId:string;prompt:string;onPromptChange:(value:string)=>void;onBusyChange?:(value:boolean)=>void}){
 const [computers,setComputers]=useState<Computer[]>([]),[selected,setSelected]=useState("");
 const [saved,setSaved]=useState<Receipt|null>(null),[job,setJob]=useState<BrowserJob|null>(null),[result,setResult]=useState<BrowserResult|null>(null),[save,setSave]=useState<BrowserSave|null>(null);
 const [error,setError]=useState(""),[uncertain,setUncertain]=useState(false),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[blocked,setBlocked]=useState(false),[preview,setPreview]=useState("");
 const current=useRef<Receipt|null>(null),active=useRef(true),locked=useRef(false),denied=useRef(false),revision=useRef(0),controllers=useRef(new Set<AbortController>());
 const origin=typeof window!=="undefined"?window.location.origin:"",storageKey=`kavero-connect-job:${origin}:${ownerId}`;
 const adopt=(r:Receipt|null)=>{current.current=r;setSaved(r);if(r)onPromptChange(r.submission.prompt);};
 const persist=(r:Receipt)=>{if(!active.current||denied.current)throw Error("Your account changed.");const prior=readReceipt(localStorage,storageKey,ownerId,origin);if(prior&&prior.submission.key!==r.submission.key)throw Error("Another tab has a different request. Reopen Generate to reconnect.");localStorage.setItem(storageKey,JSON.stringify(r));adopt(r);};
 async function api(path:string,body?:unknown){
  if(denied.current)throw Error("Your account changed. Reload Generate to continue.");
  const control=new AbortController();controllers.current.add(control);const timer=setTimeout(()=>control.abort(),path.endsWith("/save")&&body?105000:20000);
  try{const response=await fetch(`/api/connect/${path}`,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal:control.signal,headers:{"x-kavero-connect-owner":ownerId,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await response.json();if(!active.current||denied.current)throw Error("Account unavailable.");if(!response.ok)throw new ApiError(response.status,data.error||"The connection is unavailable. Retry the original request.");return data;
  }finally{clearTimeout(timer);controllers.current.delete(control);}
 }
 const inspect=async(r:Receipt,version=revision.current)=>{
  // A lost create acknowledgement is reconciled using precisely the persisted key and payload.
  let reply;
  try{reply=await api("jobs",r.jobId?{action:"inspect",id:r.jobId}:r.submission);}catch(e){
   // These responses are emitted only after the durable same-key lookup found no job.
   // Network/5xx/ambiguous failures never permit discarding a request.
   if(!r.jobId&&e instanceof ApiError&&((e.status===409&&["queue-full","binding-unavailable","not-found","receipt-capacity"].includes(e.message))||e.status===429)&&version===revision.current)persist({...r,notAdmitted:true});
   throw e;
  }
  if(!active.current||version!==revision.current)return;const next=verifyJob(reply.job,r);
  if(!r.jobId){r={...r,jobId:next.id,notAdmitted:false};persist(r);}setJob(next);
  if(next.state==="generated-unvalidated"){
   const [rReply,sReply]=await Promise.allSettled([api(`results/${next.id}/status`),api(`results/${next.id}/save`)]);
   if(!active.current||version!==revision.current)return;
   if(sReply.status==="fulfilled"){const nextSave=browserSave.parse(sReply.value.save);setSave(prior=>prior?.state==="save-failed"&&nextSave.state==="available"?prior:nextSave);}
   if(rReply.status==="fulfilled"){const output=browserResult.parse(rReply.value.result);if(output.jobId!==next.id)throw Error("Result identity changed.");setResult(output);}
   else if(sReply.status!=="fulfilled"||sReply.value.save.state!=="saved")throw Error("Generated on the computer; transfer is not confirmed yet. Keep the computer online.");
  }
  setUncertain(false);setError("");
 };
 useEffect(()=>{
  active.current=true;let live=true,timer:ReturnType<typeof setTimeout>,polling=false,failures=0;
  try{const r=readReceipt(localStorage,storageKey,ownerId,origin);adopt(r);}catch{setBlocked(true);setError("The stored request cannot be recovered. Do not clear browser data until its status is checked.");}
  const auth=createClient().auth.onAuthStateChange((_event,session)=>{if(!live)return;if(session?.user.id!==ownerId){denied.current=true;setBlocked(true);setAvailable(false);adopt(null);setJob(null);setResult(null);setSave(null);setPreview("");try{localStorage.removeItem(storageKey);}catch{/* Admission remains fenced even when browser storage is unavailable. */}for(const c of controllers.current)c.abort();}});
  const load=async()=>{if(!live||!active.current||polling||locked.current||denied.current||document.hidden)return;polling=true;const version=revision.current;
   try{const snapshot=computerList.parse(await api("computers"));if(!live||version!==revision.current)return;setComputers(snapshot.computers);setAvailable(true);
    if(current.current&&!current.current.notAdmitted)await inspect(current.current,version);if(!live||version!==revision.current)return;setError("");failures=0;
   }catch(e){if(live&&active.current&&version===revision.current){setAvailable(false);setUncertain(!!current.current);setError(e instanceof Error?e.message:"Unable to reconnect.");failures++;}}
   finally{polling=false;if(live&&active.current)timer=setTimeout(load,Math.min(60000,(current.current?5000:30000)*2**Math.min(failures,4)));}
  };
  const wake=()=>{if(!document.hidden){clearTimeout(timer);void load();}};
  const storage=(event:StorageEvent)=>{if(event.key!==storageKey||locked.current)return;try{const next=readReceipt(localStorage,storageKey,ownerId,origin);if(next?.submission.key!==current.current?.submission.key){revision.current++;setJob(null);setResult(null);setSave(null);adopt(next);}wake();}catch{setBlocked(true);}};
  void load();document.addEventListener("visibilitychange",wake);window.addEventListener("storage",storage);
  return()=>{live=false;active.current=false;revision.current++;clearTimeout(timer);auth.data.subscription.unsubscribe();for(const c of controllers.current)c.abort();controllers.current.clear();document.removeEventListener("visibilitychange",wake);window.removeEventListener("storage",storage);};
 // Owner-keyed mount owns recovery and all outstanding requests.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ownerId]);
 useEffect(()=>{onBusyChange?.(!!saved&&!saved.notAdmitted&&!canFinish(job,result,save));},[saved,job,result,save,onBusyChange]);
 useEffect(()=>{if(result?.state!=="available"||!saved?.jobId||denied.current)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let url="";controllers.current.add(controller);
  void fetch(`/api/connect/results/${saved.jobId}`,{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal}).then(async response=>{if(!response.ok||response.headers.get("Content-Type")!=="image/png")throw Error("Image preview unavailable.");const blob=await response.blob();if(blob.size!==result.sizeBytes)throw Error("Image length changed.");if(!active.current||controller.signal.aborted)return;url=URL.createObjectURL(blob);setPreview(url);}).catch(()=>{/* Download and save remain separately retryable. */});
  return()=>{clearTimeout(timer);controller.abort();controllers.current.delete(controller);if(url)URL.revokeObjectURL(url);setPreview("");};
 },[result?.state,result?.sha256,saved?.jobId]);
 const act=async(work:()=>Promise<void>)=>{if(locked.current||blocked||denied.current)return;locked.current=true;revision.current++;setBusy(true);setError("");try{await work();}catch(e){if(active.current){setError(e instanceof Error?e.message:"Unable to complete this action.");setUncertain(!!current.current&&!current.current.notAdmitted&&!result);}}finally{locked.current=false;revision.current++;if(active.current)setBusy(false);}};
 const submit=()=>act(async()=>{
  if(!navigator.locks)throw Error("This browser cannot safely coordinate requests across tabs. Use a current browser over HTTPS or localhost.");
  await navigator.locks.request(storageKey,async()=>{const existing=readReceipt(localStorage,storageKey,ownerId,origin);if(existing){adopt(existing);return;}
   const invalid=localPromptError(prompt);if(invalid)throw Error(invalid);
   const snapshot=computerList.parse(await api("computers")),pc=snapshot.computers.find(c=>c.id===selected);
   if(!pc||pc.status!=="ready"||!pc.capability||!pc.model)throw Error("This computer is no longer ready. Check Model Hub and refresh.");
   persist({version:1,origin,owner:ownerId,computerName:pc.name,modelLabel:pc.model.label,submission:{action:"create",key:crypto.randomUUID(),deviceId:pc.id,bindingHash:pc.capability.bindingHash,profile:pc.model.profile as Receipt["submission"]["profile"],execute:true,prompt}});
  });
  if(current.current)await inspect(current.current);
 });
 const saveImage=()=>act(async()=>{const id=current.current?.jobId;if(!id)return;setSave({state:"saving"});try{const data=await api(`results/${id}/save`,{});setSave(browserSave.parse(data.save));setUncertain(false);}catch(e){setSave({state:"save-failed"});throw e;}});
 const cancel=()=>act(async()=>{const r=current.current;if(!r)return;if(!r.jobId)await inspect(r);const id=current.current?.jobId;if(!id)return;const reply=await api("jobs",{action:"cancel",id});setJob(verifyJob(reply.job,current.current!));if(job?.state==="generated-unvalidated")await api(`results/${id}`,{});setUncertain(false);});
 const clear=()=>act(async()=>{if((!canFinish(job,result,save)&&!current.current?.notAdmitted)||!navigator.locks)return;await navigator.locks.request(storageKey,async()=>{const stored=readReceipt(localStorage,storageKey,ownerId,origin);if(stored?.submission.key===current.current?.submission.key)localStorage.removeItem(storageKey);adopt(null);setJob(null);setResult(null);setSave(null);setUncertain(false);onBusyChange?.(false);});});
 const pc=computers.find(c=>c.id===selected),finished=canFinish(job,result,save)||saved?.notAdmitted,download=result?.state==="available"&&!!saved?.jobId;
 return <section className={styles.page} aria-label="My computer generation">
  <header className={styles.heading}><h1>Create on your computer.</h1><p>Image generation only. Your computer must stay online.</p></header>
  <div className={styles.layout}>
   <div className={styles.modelCard}><h2 className="text-base font-medium">{saved?saved.computerName:"Choose a computer"}</h2>
    {!saved&&<><label htmlFor="connect-computer" className="mt-5 block text-xs text-white/60">Runs on</label><select id="connect-computer" className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-sm" value={selected} disabled={busy||blocked} onChange={e=>setSelected(e.target.value)}><option value="">Select a computer</option>{computers.map(c=><option key={c.id} value={c.id}>{c.name} · {computerLabels[c.status]}</option>)}</select></>}
    <p className="mt-4 text-sm text-white/65">{saved?.modelLabel??pc?.model?.label??"Prepare a model in Model Hub."}</p>
    <p className="mt-3 text-xs leading-6 text-white/50">Runs on: {saved?.computerName??pc?.name??"not selected"}<br/>Saves to: Kavero managed storage<br/>512 × 512 · 1 image · up to 1,000 characters</p>
    <Link href="/settings/models" className="mt-5 inline-block text-sm underline underline-offset-4">Manage computers and models</Link>
    {!saved&&pc?.status!=="ready"&&<p className="mt-4 text-xs leading-6 text-white/60">{pc?`${computerLabels[pc.status]}. Check the computer and model in Model Hub.`:"Connect and select a ready computer to begin."}</p>}
   </div>
   <div className={styles.creation}><div className={styles.promptCard}><div className={styles.promptHeading}><h2>Your image</h2></div><textarea aria-label="Image prompt" className="w-full resize-y bg-transparent outline-none" value={saved?.submission.prompt??prompt} disabled={!!saved||busy||blocked} onChange={e=>onPromptChange(e.target.value)} placeholder="Describe the image you want to make…"/><div className="flex flex-wrap gap-3 p-5"><button className={button} disabled={busy||blocked||(!saved&&(!available||pc?.status!=="ready"||!!localPromptError(prompt)))} onClick={submit}>{busy?"Working…":saved?"Reconnect to job":"Create image"}</button>{saved&&!finished&&<button className={button} disabled={busy||blocked} onClick={cancel}><Square size={15} strokeWidth={1.75} aria-hidden/>Cancel original job</button>}{finished&&<button className={button} disabled={busy||blocked} onClick={clear}>New image</button>}</div></div>
    {!!localPromptError(prompt)&&prompt.length>1000&&!saved&&<p role="alert" className="mt-3 text-sm text-amber-200">{localPromptError(prompt)}</p>}
    {saved&&<p role="status" className="mt-5 text-sm leading-6 text-white/70">{saved.notAdmitted?"This request was not admitted. Reconnect with the same request, or choose New image.":statusMessage(job,result,save,uncertain)}</p>}
    {preview&&<img src={preview} alt="Generated image" className="mt-5 w-full rounded-xl border border-white/10"/>}
    {download&&<div className="mt-4 flex flex-wrap gap-3"><a className={button} href={`/api/connect/results/${saved!.jobId}`} download><Download size={16} strokeWidth={1.75} aria-hidden/>Download PNG</a>{save?.state!=="saved"&&<button className={button} disabled={busy||blocked||save?.state==="saving"} onClick={saveImage}><Save size={16} strokeWidth={1.75} aria-hidden/>{save?.state==="save-failed"?"Retry saving":"Save to Gallery"}</button>}{save?.state==="saved"&&!save.historyRemoved&&<Link className={button} href="/gallery"><Images size={16} strokeWidth={1.75} aria-hidden/>Open Gallery</Link>}</div>}
    {error&&<p role="alert" className="mt-4 rounded-xl border border-amber-300/15 p-4 text-sm leading-6 text-amber-100">{friendly(error)}</p>}
    <p className="mt-5 text-xs leading-6 text-white/40">Inference stays on your computer. Downloads and saved images pass through the website. Offline use is not supported.</p>
   </div>
  </div>
 </section>;
}
