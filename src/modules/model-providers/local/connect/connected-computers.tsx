"use client";
import {useEffect,useRef,useState} from "react";
import {Monitor,Plus,RefreshCw,Copy,Check} from "lucide-react";
import {z} from "zod";
import {computerList,computerLabels,pairing,type Computer,type Pairing} from "./computer-contract";
import styles from "../model-hub.module.css";
import css from "./computers.module.css";
const pendingId=z.string().uuid();
const friendly=(message:string)=>({"rate-limited":"Too many attempts. Wait a moment and try again.","pairing-unavailable":"This connection expired or was cancelled. Start a new connection.","identity-changed":"The computer identity changed. Cancel and start again.","not-found":"This connection is no longer available.","device-limit":"Disconnect an unused computer before adding another."}[message]??message);
export function ConnectedComputers({ownerId,onComputersChange}:{ownerId:string;onComputersChange?:(computers:Computer[]|null)=>void}){return <Computers key={ownerId} ownerId={ownerId} onComputersChange={onComputersChange}/>;}
function Computers({ownerId,onComputersChange}:{ownerId:string;onComputersChange?:(computers:Computer[]|null)=>void}){
 const storageKey=`kavero-connect-pending:${ownerId}`;
 const [list,setList]=useState<z.infer<typeof computerList>|null>(null),[error,setError]=useState(""),[statusError,setStatusError]=useState(""),[refresh,setRefresh]=useState(0);
 const [selectedComputer,setSelectedComputer]=useState('');
 const [pending,setPending]=useState<Pairing|null>(null),[recover,setRecover]=useState<string|null>(null),[code,setCode]=useState(""),[copied,setCopied]=useState(false);
 const [adding,setAdding]=useState(false),[name,setName]=useState("My computer"),[matched,setMatched]=useState(""),[expired,setExpired]=useState(false);
 const [edit,setEdit]=useState<Computer|null>(null),[newName,setNewName]=useState(""),[disconnect,setDisconnect]=useState<Computer|null>(null),[busy,setBusy]=useState(false),[settings,setSettings]=useState<string|null>(null),[disconnecting,setDisconnecting]=useState<string|null>(null);
 const revision=useRef(0),mounted=useRef(true),acting=useRef(false),requests=useRef(new Set<AbortController>()),nameRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{mounted.current=true;try{const stored=sessionStorage.getItem(storageKey);if(stored&&pendingId.safeParse(stored).success)setRecover(stored);}catch{/* Storage may be unavailable; in-memory pairing still works. */}
  return()=>{mounted.current=false;for(const c of requests.current)c.abort();requests.current.clear();};},[storageKey]);
 const remember=(id:string|null)=>{try{if(id)sessionStorage.setItem(storageKey,id);else sessionStorage.removeItem(storageKey);}catch{/* Optional refresh recovery only. */}};
 async function request(path:string,body?:unknown,signal?:AbortSignal){
  const control=new AbortController();requests.current.add(control);const abort=()=>control.abort();signal?.addEventListener("abort",abort,{once:true});const timer=setTimeout(abort,15000);
  try{const r=await fetch(`/api/connect/${path}`,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal:control.signal,...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
   const value=await r.json();if(!r.ok)throw Error(friendly(value.error??"Connection unavailable. Try again."));return value;
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);requests.current.delete(control);}
 }
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>,failures=0,inflight=false;const abort=new AbortController();
  const load=async()=>{if(!live||inflight)return;if(document.hidden||acting.current){timer=setTimeout(load,60000);return;}
   inflight=true;const version=revision.current;
   try{const value=computerList.parse(await request("computers",undefined,abort.signal));if(!live||version!==revision.current)return;setList(value);onComputersChange?.(value.computers);setStatusError("");failures=0;}
   catch{if(!live||version!==revision.current)return;setList(null);onComputersChange?.(null);setStatusError("Computer status is unavailable. Try refreshing.");failures++;}
   finally{inflight=false;if(live)timer=setTimeout(load,Math.min(300000,60000*2**failures));}
  };
  const visibility=()=>{if(!document.hidden){clearTimeout(timer);void load();}};void load();document.addEventListener("visibilitychange",visibility);
  return()=>{live=false;clearTimeout(timer);abort.abort();document.removeEventListener("visibilitychange",visibility);};
 // Each effect owns its abort signal; actions trigger a fresh snapshot.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ownerId,refresh,onComputersChange]);
 const pairId=pending?.id??recover;
 useEffect(()=>{if(!pairId)return;let live=true,timer:ReturnType<typeof setTimeout>,failures=0,inflight=false;const control=new AbortController();
  const load=async()=>{if(!live||inflight)return;if(document.hidden||acting.current){timer=setTimeout(load,5000);return;}
   inflight=true;const version=revision.current;
   try{const p=pairing.parse((await request(`pairings?id=${encodeURIComponent(pairId)}`,undefined,control.signal)).pairing);if(!live||version!==revision.current)return;
    setPending(p);setRecover(null);failures=0;const ended=Date.parse(p.expiresAt)<=Date.now();setExpired(ended);
    if(p.state==="confirmed"||p.state==="cancelled"){remember(null);setCode("");setRefresh(v=>v+1);live=false;return;}if(ended){setCode("");live=false;return;}
   }catch{if(!live||version!==revision.current)return;setError("Connection status is unavailable. Retrying this connection.");failures++;}
   finally{inflight=false;if(live)timer=setTimeout(load,Math.min(60000,5000*2**failures));}
  };
  const visibility=()=>{if(!document.hidden){clearTimeout(timer);void load();}};void load();document.addEventListener("visibilitychange",visibility);
  return()=>{live=false;clearTimeout(timer);control.abort();document.removeEventListener("visibilitychange",visibility);};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[pairId]);
 useEffect(()=>{if(adding)nameRef.current?.focus();},[adding]);
 const mutate=async(work:()=>Promise<void>)=>{if(acting.current)return;revision.current++;acting.current=true;setBusy(true);setError("");try{await work();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Connection unavailable. Try again.");}finally{revision.current++;acting.current=false;if(mounted.current){setBusy(false);setRefresh(v=>v+1);}}};
 const resetPair=()=>{remember(null);setPending(null);setRecover(null);setCode("");setAdding(false);setMatched("");setExpired(false);setCopied(false);};
 const createPair=()=>mutate(async()=>{const value=await request("pairings",{action:"create",name:name.trim()});const p=pairing.parse(value.pairing),c=z.string().regex(/^[a-f0-9]{24}$/).parse(value.code);if(!mounted.current)return;remember(p.id);setPending(p);setCode(c);setAdding(false);setMatched("");setExpired(false);});
 const changePair=(action:"confirm"|"cancel")=>mutate(async()=>{if(!pending)return;const p=pairing.parse((await request("pairings",action==="confirm"?{action,id:pending.id,installationId:pending.installationId,fingerprint:pending.fingerprint}:{action,id:pending.id})).pairing);if(!mounted.current)return;setPending(p);remember(null);setCode("");if(action==="cancel")resetPair();});
 const disabled=busy||!list;
 const connected=list?.computers.some(c=>!['revoked','expired'].includes(c.status));
 const selected=list?.computers.some(c=>c.id===selectedComputer)?selectedComputer:'';
 return <section className={styles.panel} aria-labelledby="connected-computers-heading">
  <div className={`${styles.heading} ${css.heading}`}><div><h2 id="connected-computers-heading">Connected computers</h2><p>Models run on these computers. Results return to Kavero.</p></div>
   <div className={css.tools}><button type="button" className={styles.button} aria-label="Refresh computers" disabled={busy} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={14}/></button>
    {!pairId&&!adding&&<button type="button" className={`${styles.button} ${!connected?styles.primary:''}`} disabled={disabled} onClick={()=>setAdding(true)}><Plus size={14}/>{connected?'Add another computer':'Connect computer'}</button>}</div></div>
  <div className={css.body}>
   {(error||statusError)&&<p role="alert" className={styles.error}>{error||statusError}</p>}
   {!list&&!error&&!statusError&&<p className={styles.muted} role="status">Checking your computers…</p>}
   {list&&list.computers.length===0&&!pairId&&!adding&&<div className={css.emptyRemote}><div className={css.empty}><Monitor size={25}/><div><p className={styles.name}>No computers connected</p><p className={styles.muted}>Connect a computer to use its models from this website.</p></div></div><ol className={css.connectionSteps}><li><span>1</span><div><strong>Get a connection code</strong><p>Choose Connect computer above and give it a name.</p></div></li><li><span>2</span><div><strong>Open Kavero Connect</strong><p>On the other computer, enter the code in Kavero Connect.</p></div></li><li><span>3</span><div><strong>Confirm your computer</strong><p>Match the fingerprint on both screens, then confirm here.</p></div></li></ol></div>}
   <details className={css.hardware}><summary>Get or open Kavero Connect</summary><p>Windows · private preview. A public installer is not available for this deployment yet.</p><p>Already installed? Open Kavero Connect from the Windows Start menu, then enter your connection code. Browser launch is not available yet.</p></details>
   {adding&&<form className={css.editor} onSubmit={e=>{e.preventDefault();void createPair();}}><label htmlFor="connect-computer-name">Computer name</label><div className={css.tools}><input ref={nameRef} id="connect-computer-name" className={styles.input} value={name} onChange={e=>setName(e.target.value)} maxLength={60} required disabled={busy}/><button className={`${styles.button} ${styles.primary}`} disabled={busy||!name.trim()}>Get connection code</button><button type="button" className={styles.button} disabled={busy} onClick={()=>setAdding(false)}>Cancel</button></div><p className={styles.muted}>Use a computer already running Kavero Connect. The installer is not available yet.</p></form>}
   {pairId&&<div className={css.pair} aria-live="polite">
    {!pending?<><p>Restoring your connection…</p><button className={styles.button} disabled={busy} onClick={resetPair}>Close pending connection</button></>:pending.state==="confirmed"?<><p className={styles.name}><Check size={16}/> {pending.name} connected</p><button className={styles.button} onClick={resetPair}>Done</button></>:pending.state==="cancelled"?<><p>Connection cancelled.</p><button className={styles.button} onClick={resetPair}>Close</button></>:<>
     <p className={styles.name}>{expired?"Connection expired":pending.state==="claimed"?"Confirm your computer":"Enter this code in Kavero Connect"}</p>
     {code&&!expired&&pending.state==="pending"&&<div className={css.code}><code>{code.match(/.{1,4}/g)?.join("-")}</code><button className={styles.button} aria-label="Copy connection code" onClick={async()=>{try{await navigator.clipboard.writeText(code);setCopied(true);}catch{setError("Copy is unavailable. Select the connection code instead.");}}}>{copied?<Check size={14}/>:<Copy size={14}/>}</button></div>}
     {!code&&!expired&&pending.state==="pending"&&<p className={styles.muted}>The code is hidden after refresh. If you already entered it, wait here. Otherwise cancel and start again.</p>}
     {pending.state==="claimed"&&!expired&&<><p className={styles.muted}>Match this fingerprint with the one shown on your computer.</p><code className={css.fingerprint}>{pending.fingerprint}</code><label className={css.check}><input type="checkbox" checked={matched===`${pending.installationId}:${pending.fingerprint}`} onChange={e=>setMatched(e.target.checked?`${pending.installationId}:${pending.fingerprint}`:"")}/>This fingerprint matches Kavero Connect on my computer.</label><button className={`${styles.button} ${styles.primary}`} disabled={busy||!pending.installationId||!pending.fingerprint||matched!==`${pending.installationId}:${pending.fingerprint}`} onClick={()=>void changePair("confirm")}>Confirm computer</button></>}
     <div className={css.tools}><button className={styles.button} disabled={busy} onClick={()=>void changePair("cancel")}>{expired?"Close expired connection":"Cancel connection"}</button>{!expired&&<span className={styles.muted}>Code expires in five minutes.</span>}</div>
    </>}
   </div>}
   {list&&list.computers.length>1&&<label className={css.computerSelector}>Computer<select className={styles.input} aria-label="Remote computer" value={selected} onChange={event=>setSelectedComputer(event.target.value)}><option value="">All computers</option>{list.computers.map(c=><option key={c.id} value={c.id}>{c.name} · {computerLabels[c.status]}</option>)}</select></label>}
   {list?.computers.filter(c=>!selected||c.id===selected).map(c=><article className={css.computer} key={c.id} aria-label={c.name}>
    <div className={css.computerTop}><div className={css.identity}><span className={styles.modelIcon}><Monitor size={18}/></span><div><h3 className={styles.name}>{c.name}</h3><p className={styles.muted}>{c.model?.label??"Model readiness not confirmed"}</p><p className={css.connection}>{['revoked','expired'].includes(c.status)?'Connection ended':'Connected to your account'}</p></div></div><span className={css.status} data-ready={c.status==="ready"} role="status">{disconnecting===c.id?'Disconnecting…':computerLabels[c.status]}</span></div>
    {c.status==="offline"&&<p className={styles.muted}>Open Kavero Connect on this computer and keep it awake.</p>}
    {c.hardware&&<p className={css.reportedGpu}>{c.hardware.gpus.length?c.hardware.gpus.map(g=>`${g.label}${g.vramMiB>0?` · ${Math.round(g.vramMiB/1024)} GB VRAM`:''}`).join(' / '):'GPU details not reported'}{c.hardware.ramMiB>0?` · ${Math.round(c.hardware.ramMiB/1024)} GB RAM`:''}</p>}
    {c.status==="not-ready"&&<p className={styles.muted}>Open Kavero Connect to check setup or resume a paused computer. Model readiness is not confirmed yet.</p>}
    {c.status==="permission-needed"&&<p className={styles.muted}>Review model permission in Kavero Connect on this computer.</p>}
    {c.status==="maintenance"&&<p className={styles.muted}>This computer is finishing maintenance. Check again shortly.</p>}
    {c.outstanding>0&&<p className={styles.muted}>{c.outstanding} unfinished {c.outstanding===1?"job":"jobs"}</p>}
    {!['revoked','expired'].includes(c.status)&&<div className={css.tools}>
     {c.status==='ready'&&<a className={`${styles.button} ${styles.primary}`} href="/generate">Open Generate<span className="sr-only"> for {c.name}</span></a>}
     <button className={styles.button} disabled={disabled} aria-expanded={settings===c.id} aria-controls={`computer-settings-${c.id}`} onClick={()=>{setSettings(settings===c.id?null:c.id);setEdit(null);}}>Settings <span className="sr-only">for {c.name}</span></button>
     <button className={styles.button} disabled={disabled} onClick={()=>{setDisconnect(c);setEdit(null);}}>Disconnect <span className="sr-only">{c.name}</span></button></div>}
    {settings===c.id&&<div className={css.editor} id={`computer-settings-${c.id}`}><p className={styles.name}>Computer settings</p><button className={styles.button} disabled={disabled} onClick={()=>{setEdit(c);setNewName(c.name);setDisconnect(null);}}>Rename <span className="sr-only">{c.name}</span></button>
     {c.hardware&&<div className={css.hardware}><p>Reported memory: {c.hardware.ramMiB?`${Math.round(c.hardware.ramMiB/1024)} GB RAM`:"unavailable"}</p>{c.hardware.gpus.map((g,i)=><p key={i}>{g.label}{g.vramMiB?` · ${Math.round(g.vramMiB/1024)} GB reported VRAM`:""}</p>)}<p>Hardware reports are not a performance benchmark.</p></div>}
    </div>}
    {edit?.id===c.id&&<form className={css.editor} onSubmit={e=>{e.preventDefault();void mutate(async()=>{await request("devices",{action:"rename",id:c.id,name:newName.trim()});if(mounted.current)setEdit(null);});}}><label htmlFor={`rename-${c.id}`}>New computer name</label><div className={css.tools}><input id={`rename-${c.id}`} className={styles.input} value={newName} onChange={e=>setNewName(e.target.value)} maxLength={60} required disabled={busy}/><button className={styles.button} disabled={busy||!newName.trim()}>Save name</button><button className={styles.button} type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancel</button></div></form>}
    {disconnect?.id===c.id&&<div className={css.editor} role="group" aria-label={`Disconnect ${c.name}?`}><p className={styles.name}>Disconnect {c.name}?</p><p className={styles.muted}>It may finish work already accepted while offline. New access from this connection will be blocked.</p><div className={css.tools}><button className={styles.button} disabled={busy} onClick={()=>void mutate(async()=>{setDisconnecting(c.id);try{await request("devices",{action:"revoke",id:c.id});if(mounted.current)setDisconnect(null);}finally{if(mounted.current)setDisconnecting(null);}})}>{disconnecting===c.id?'Disconnecting…':'Confirm disconnect'}</button><button className={styles.button} disabled={busy} onClick={()=>setDisconnect(null)}>Keep connected</button></div></div>}
   </article>)}
  </div>
 </section>;
}
