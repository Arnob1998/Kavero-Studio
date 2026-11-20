"use client";
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Download,ExternalLink,FileBadge2,Loader2,Monitor,RefreshCw,ShieldCheck,XCircle,X} from 'lucide-react';
import {profileForSnapshot,localProfile} from '../browser-profiles';
import type {CompatibilityResult} from '../compatibility-contract';
import type {Computer} from './computer-contract';
import {setupPreparation} from './setup-contract';
import {setupAPI,setupTerminal,type Preparation,type RemoteSetupControl} from './use-remote-setup';
import styles from '../model-hub.module.css';
import css from './remote-setup.module.css';
function usable(pc:Computer|undefined,profile:string){return !!pc&&pc.status==='ready'&&pc.model?.profile===profile&&!!pc.capability&&Date.parse(pc.lastSeenAt??'')>Date.now()-150000&&Date.parse(pc.lastSeenAt??'')<=Date.now()+60000;}
export function RemoteSetupActions({result,computer,control}:{result:CompatibilityResult;computer?:Computer;control:RemoteSetupControl}){
 const model=profileForSnapshot(result.snapshot),deviceId=result.destination.kind==='remote'?result.destination.deviceId:null;
 const identity=JSON.stringify([control.ownerId,result.assessmentId,result.source,deviceId,model?.profile]);
 const [review,setReview]=useState<{identity:string;value:Preparation}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[clock,setClock]=useState(0);
 const revision=useRef(0),abort=useRef<AbortController|null>(null);
 const preparation=review?.identity===identity?review.value:null;
 useEffect(()=>{setReview(null);setAccepted(false);setError('');return()=>{revision.current++;abort.current?.abort();};},[identity]);
 useEffect(()=>{if(!preparation)return;const timer=setTimeout(()=>{setAccepted(false);setClock(v=>v+1);},Math.max(0,Date.parse(preparation.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[preparation]);
 const fresh=!!preparation&&Date.parse(preparation.expiresAt)>Date.now()&&Date.parse(result.expiresAt)>Date.now();void clock;
 const active=control.list.some(e=>e.command.deviceId===deviceId&&(!e.request||!setupTerminal(e.request.state)));
 async function prepare(){if(!model||!deviceId||!control.ready)return;const version=++revision.current;abort.current?.abort();const current=new AbortController();abort.current=current;setBusy(true);setError('');setAccepted(false);
  try{const value=setupPreparation.parse(await setupAPI(control.ownerId,{action:'prepare',deviceId,profile:model.profile},current.signal));
   if(value.intent.ownerId!==control.ownerId||value.intent.origin!==location.origin||value.intent.deviceId!==deviceId||value.intent.profile!==model.profile||value.intent.manifestHash!==model.manifest)throw Error('The model or computer changed. Check again.');
   if(version===revision.current&&!current.signal.aborted){setReview({identity,value});if(value.active)control.adopt(value.active,value.deviceName);}
  }catch(e){if(version===revision.current&&!current.signal.aborted)setError(e instanceof Error?e.message:'Computer checks are unavailable.');}finally{if(version===revision.current)setBusy(false);}
 }
 useEffect(()=>{if(control.enabled&&control.ready&&model&&deviceId)void prepare();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[identity,control.enabled,control.ready]);
 const assessed=control.list.find(e=>e.command.deviceId===deviceId&&e.command.profile===model?.profile&&e.request?.state==='assessed')?.request?.id;
 useEffect(()=>{if(assessed)void prepare();/* Refresh this exact candidate after its native assessment. */
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[assessed]);
 async function start(kind:'assess'|'install'){if(!preparation)return;const version=revision.current;setBusy(true);setError('');try{await control.start(preparation,kind);}catch(e){if(version===revision.current)setError(e instanceof Error?e.message:'Setup is unavailable.');}finally{if(version===revision.current)setBusy(false);}}
 if(!model||!deviceId||!control.enabled)return null;
 const switching=!!computer?.model&&computer.model.profile!==model.profile;
 return <section className={css.setup} aria-label="Remote setup review">
  <div className={css.heading}><div><h3><Monitor size={16}/>Set up on {result.destinationName}</h3><p>{model.label} · Image generation</p></div><button className={styles.button} aria-label="Refresh setup checks" disabled={busy||!control.ready} onClick={()=>void prepare()}>{busy?<Loader2 size={14} className="animate-spin"/>:<RefreshCw size={14}/>}Refresh</button></div>
  {(error||control.error)&&<p role="alert" className={styles.error}>{error||control.error}</p>}
  {!preparation?<p className={styles.muted}>Check this computer for the selected file before requesting a download.</p>:<>
   <p className={styles.muted}>{fresh?preparation.message:'These setup checks have expired. Refresh before continuing.'}</p>
   {preparation.capable&&<button className={styles.button} disabled={busy||!fresh||active} onClick={()=>void start('assess')}><ShieldCheck size={15}/>Check {preparation.deviceName}</button>}
   {preparation.assessment?.evidence&&<dl className={css.resources}><div><dt>Available GPU memory</dt><dd>{preparation.assessment.evidence.freeVramMiB===null?'Unknown':`${(preparation.assessment.evidence.freeVramMiB/1024).toFixed(1)} GB`}</dd></div><div><dt>Available system memory</dt><dd>{preparation.assessment.evidence.freeRamBytes===null?'Unknown':`${(preparation.assessment.evidence.freeRamBytes/1024**3).toFixed(1)} GB`}</dd></div><div><dt>Free setup disk space</dt><dd>{preparation.assessment.evidence.freeDiskBytes===null?'Unknown':`${(preparation.assessment.evidence.freeDiskBytes/1024**3).toFixed(1)} GB`}</dd></div><div><dt>Required setup space</dt><dd>{preparation.assessment.evidence.requiredFreeBytes===null?'Unknown':`${(preparation.assessment.evidence.requiredFreeBytes/1024**3).toFixed(1)} GB`}</dd></div></dl>}
   {switching&&<p className={styles.muted}>This computer has a different active model. Switching models is not available yet.</p>}
   {preparation.installable&&fresh&&!switching&&!active&&<div className={css.review}>
    <h4><FileBadge2 size={16}/>Review this download</h4><p>{model.label} will be downloaded to <strong>{preparation.deviceName}</strong>. Model and component terms apply for research/evaluation.</p>
    <details><summary>Included component notices</summary><ul>{preparation.notices.map(notice=><li key={notice.name}>{notice.name}</li>)}</ul><p>These notices are pinned to this recipe. Kavero Connect shows the complete terms for your approval on the selected computer before installation.</p></details>
    <label className={css.accept}><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/>I understand this model is for research/evaluation and will review its full terms on {preparation.deviceName}.</label>
    <button className={`${styles.button} ${styles.primary}`} disabled={busy||!accepted} onClick={()=>void start('install')}><Download size={15}/>Download to {preparation.deviceName}</button><p className={styles.muted}>You will confirm this request in Kavero Connect. Closing this page does not cancel accepted work.</p>
   </div>}
  </>}
  {usable(computer,model.profile)&&<Link className={styles.button} href="/generate"><ExternalLink size={14}/>Open Generate</Link>}
 </section>;
}
const labels:Record<string,string>={requested:'Waiting for computer',delivered:'Waiting for local review','awaiting-approval':'Approve in Kavero Connect',approved:'Approved · waiting to start',admitted:'Download queued',downloading:'Downloading',verifying:'Verifying files','activation-needed':'Downloaded · activation needed',ready:'Setup complete',assessed:'Computer checked',cancelling:'Cancelling original operation',cancelled:'Cancelled',failed:'Setup could not finish',rejected:'Setup declined',interrupted:'Recovery needs your attention',expired:'Request expired'};
export function RemoteSetupTracker({control,computers}:{control:RemoteSetupControl;computers:Computer[]|null}){
 if(!control.enabled)return null;
 return <section className={css.tracker} aria-label="Remote setup requests">
  {control.error&&<p role="alert" className={styles.error}>{control.error}</p>}
  {control.list.map(entry=>{const r=entry.request,busy=control.busy.includes(entry.command.key),pc=computers?.find(c=>c.id===entry.command.deviceId),model=localProfile(entry.command.profile),ended=!!r&&setupTerminal(r.state);
   return <article key={entry.command.key} className={css.request} aria-label={`Setup on ${entry.deviceName}`}>
    <div className={css.heading}><div><h3><Monitor size={16}/>{model?.label} <span>on {entry.deviceName}</span></h3><p role="status">{r?labels[r.state]:'Reconnecting to the original request'}</p></div>{ended?['ready','assessed'].includes(r!.state)?<CheckCircle2 size={20}/>:<XCircle size={20}/>:<Loader2 size={18} className="animate-spin"/>}</div>
    <p className={styles.muted}>{!r?'The request key is saved. Recover or retry this same request; do not start another download.':entry.command.kind==='assess'?'Only model/resource checks are requested. No model is downloaded.':['delivered','awaiting-approval'].includes(r.state)?`Open Kavero Connect on ${entry.deviceName} and review this request and its terms.`:r.state==='interrupted'?`Reopen Kavero Connect on ${entry.deviceName} and explicitly continue the original operation.`:r.state==='activation-needed'?'Files are downloaded. The companion must confirm native readiness before this model can be used.':r.state==='ready'&&!usable(pc,entry.command.profile)?'Setup finished. Refresh the computer connection to verify current model readiness.':r.reason==='cancel-unconfirmed'?'Cancellation was too late to confirm. Check the original operation in Kavero Connect.':'This request stays with its original computer and model across page changes.'}</p>
    {r&&r.processedBytes>0&&<p className={styles.muted}>{(r.processedBytes/1024**2).toFixed(1)} MB processed</p>}
    <div className={styles.actions}>{!r&&<button className={styles.button} disabled={busy} onClick={()=>void control.retry(entry)}><RefreshCw size={14}/>Recover original request</button>}
     {r&&!ended&&!r.cancelRequested&&<button className={styles.button} disabled={busy} onClick={()=>void control.cancel(entry)}><XCircle size={14}/>Cancel setup on {entry.deviceName}</button>}
     {r?.state==='ready'&&usable(pc,entry.command.profile)&&<Link className={styles.button} href="/generate"><ExternalLink size={14}/>Open Generate</Link>}
     {ended&&<button className={styles.button} onClick={()=>control.dismiss(entry)}><X size={14}/>Dismiss finished request</button>}
    </div>
   </article>;
  })}
 </section>;
}
