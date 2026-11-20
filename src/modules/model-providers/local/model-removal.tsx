"use client";
import {useEffect,useRef,useState,useId} from 'react';
import {localProfile,type LocalProfile} from './browser-profiles';
import {removalOperationSchema,removalReviewSchema,removalUUID,type RemovalOperation,type RemovalReview} from './removal-contract';
import styles from './model-hub.module.css';
import {MoreHorizontal,Trash2,Loader2,FileBadge2,X} from 'lucide-react';
type Attempt={key:string;instanceId:string;packageId:string;manifest:string;confirmed:true};
const gb=(n:number)=>(n/1024**3).toFixed(2);
export function ModelRemoval({ownerId,profile,online,onChanged,compact=false,onDetails}:{ownerId:string;profile:LocalProfile;online:boolean;onChanged:()=>void;compact?:boolean;onDetails?:()=>void}){
 const target=localProfile(profile)!;
 const [review,setReview]=useState<RemovalReview|null>(null),[operation,setOperation]=useState<RemovalOperation|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[fresh,setFresh]=useState(false);
 const attempt=useRef<Attempt|null>(null),dialog=useRef<HTMLDialogElement>(null),epoch=useRef(0),cache=useRef<string|null>(null),locked=useRef(false),changed=useRef(onChanged);changed.current=onChanged;
 const title=useId();
 useEffect(()=>{
  const generation=++epoch.current;let live=true,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
  attempt.current=null;cache.current=null;setReview(null);setOperation(null);setError(null);setFresh(false);setOpen(false);setBusy(false);
  if(!online)return;
  const poll=async()=>{
   try{
    const response=await fetch(`/api/local-generation/removals?profile=${profile}`,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])});
    if(!response.ok)throw Error('Removal status is unavailable. Reconnect to the same computer to recover it.');
    const data=await response.json(),next=removalReviewSchema.parse(data.review),op=data.operation?removalOperationSchema.parse(data.operation):null;
    if(data.ownerId!==ownerId||next.packageId!==target.packageId||next.manifest!==target.manifest||op&&(op.instanceId!==next.instanceId||op.packageId!==next.packageId||op.manifest!==next.manifest))throw Error('Removal identity changed.');
    if(!live||epoch.current!==generation)return;
    const key=`kavero-local-removal:${ownerId}:${next.instanceId}:${profile}`;
    if(cache.current!==key){
     attempt.current=null;cache.current=key;
     try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored?.confirmed===true&&stored.instanceId===next.instanceId&&stored.packageId===next.packageId&&stored.manifest===next.manifest&&removalUUID.safeParse(stored.key).success)attempt.current={key:stored.key,instanceId:next.instanceId,packageId:next.packageId,manifest:next.manifest,confirmed:true};}catch{}
    }
    if(op&&op.state!=='removed'&&!attempt.current)attempt.current={key:op.key,instanceId:op.instanceId,packageId:op.packageId,manifest:op.manifest,confirmed:true};
    if(op?.state==='removed'&&attempt.current?.key===op.key){attempt.current=null;try{localStorage.removeItem(key);}catch{}changed.current();}
    setReview(next);setOperation(op);setFresh(true);if(!attempt.current)setError(null);
   }catch(e){if(live&&epoch.current===generation){setFresh(false);setError(e instanceof Error?e.message:'Removal status is unavailable.');}}
   if(live)timer=setTimeout(poll,4000);
  };
  void poll();return()=>{live=false;abort.abort();clearTimeout(timer);};
 },[ownerId,profile,online,target.packageId,target.manifest]);
 useEffect(()=>{if(open){dialog.current?.showModal();return()=>dialog.current?.close();}},[open]);
 async function remove(){
  if(locked.current||!review||!fresh||!online)return;locked.current=true;setBusy(true);setError(null);setOpen(false);const generation=epoch.current;
  const submitted=attempt.current??{key:crypto.randomUUID(),instanceId:review.instanceId,packageId:review.packageId,manifest:review.manifest,confirmed:true as const};attempt.current=submitted;
  try{
   if(cache.current)localStorage.setItem(cache.current,JSON.stringify(submitted));
   const response=await fetch('/api/local-generation/removals',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(submitted),signal:AbortSignal.timeout(25000)});
   const data=await response.json();if(epoch.current!==generation)return;
   if(data.operation){const op=removalOperationSchema.parse(data.operation);if(data.ownerId!==ownerId||op.key!==submitted.key||op.instanceId!==submitted.instanceId||op.packageId!==submitted.packageId||op.manifest!==submitted.manifest)throw Error('Removal identity changed.');setOperation(op);
    if(op.state==='removed'){attempt.current=null;if(cache.current)localStorage.removeItem(cache.current);changed.current();}}
   if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Removal could not be confirmed. Retry the same removal.');
   changed.current();
  }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:'Removal could not be confirmed. Retry the same removal.');}
  finally{locked.current=false;if(epoch.current===generation)setBusy(false);}
 }
 const pending=!!attempt.current||operation&&operation.state!=='removed';
 const running=operation&&['admitted','removing'].includes(operation.state);
 if(!pending&&!operation&&(!review&&!error||review?.reason==='removal-not-owned'))return null;
 const removeButton=<button className={compact?styles.menuItem:styles.dangerButton} disabled={busy||!!running||!online||!fresh||!review||!pending&&!review.canRemove} onClick={()=>pending?void remove():setOpen(true)} aria-label={`${busy||running?'Removing':pending?'Retry removal':'Remove model'} — ${target.label}`}>{busy||running?<Loader2 size={16} strokeWidth={1.75} aria-hidden className="animate-spin"/>:<Trash2 size={16} strokeWidth={1.75} aria-hidden/>}{busy||running?'Removing…':pending?'Retry removal':'Remove model'}</button>;
 return <div className={compact?styles.optionsHost:styles.removalActions}>
  {operation&&<p className={styles.muted} role="status">{operation.state==='removed'?operation.accountOnly?'Removed from your account. Shared model files are kept for other accounts.':`Last removal completed · ${gb(operation.reclaimedBytes)} GB of managed files reclaimed. ${gb(operation.retainedBytes)} GB retained for shared or unrecognized files.`:running?'Removing model files…':operation.state==='refused'?'Removal refused. Check setup, jobs and other accounts using this model.':'Removal needs recovery. Retry this removal on the same computer.'}</p>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {compact?<details className={styles.optionsMenu}><summary className={styles.iconButton} aria-label={`Options for ${target.label}`}><MoreHorizontal size={18}/></summary><div className={styles.menuPopup}>{onDetails&&<button className={styles.menuItem} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onDetails();}}><FileBadge2 size={16} strokeWidth={1.75} aria-hidden/>Model details</button>}{removeButton}</div></details>:removeButton}
  {review?.reason==='removal-other-owner'&&<p className={styles.muted}>Restart Kavero with the latest version to enable account-only removal of shared models.</p>}
  {open&&review&&<dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onClose={()=>setOpen(false)}>
   <div className={styles.heading}><h2 id={title}>Remove {target.label}?</h2></div>
   <div className={styles.dialogBody}>
    <p>{review.accountOnly ? "Remove this model from your account. Files still needed by other accounts will be kept." : `Remove from this computer to free up to ${gb(review.reclaimableBytes)} GB.`}</p>
    <p className={`${styles.muted} mt-3`}>Saved images and shared files are kept. Other copies of the model are not included. {gb(review.retainedBytes)} GB will be kept for shared or unrecognized files.</p>
    <p className={`${styles.muted} mt-3`}>Save or download any unsaved results first. You can download this model again later.</p>
    <div className={styles.actions}><button autoFocus className={styles.button} onClick={()=>setOpen(false)}><X size={16} strokeWidth={1.75} aria-hidden/>Keep model</button><button className={`${styles.button} !border-red-400/30 !text-red-300`} disabled={!fresh||!online||busy} onClick={()=>void remove()}><Trash2 size={16} strokeWidth={1.75} aria-hidden/>{review.accountOnly ? 'Remove from my account' : 'Remove downloaded files'}</button></div>
   </div>
  </dialog>}
 </div>;
}
