"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {setupRequestView,setupPreparation} from './setup-contract';
import {localProfiles,type LocalProfile} from '../browser-profiles';
const create=z.object({action:z.literal('create'),key:z.string().uuid(),deviceId:z.string().uuid(),profile:z.enum(['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation']),kind:z.enum(['assess','install']),reviewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),accepted:z.literal(true).optional()}).strict();
const entrySchema=z.object({command:create,deviceName:z.string().min(1).max(60),intentHash:z.string().regex(/^[a-f0-9]{64}$/),request:setupRequestView.nullable()}).strict().superRefine((entry,ctx)=>{const c=entry.command;if(c.kind==='install'?(c.accepted!==true||c.reviewHash!==entry.intentHash):(c.accepted!==undefined||c.reviewHash!==undefined))ctx.addIssue({code:'custom',message:'Saved setup consent does not match its original intent.'});});
const entries=z.array(entrySchema).max(20);
export type SetupEntry=z.infer<typeof entrySchema>;
export type Preparation=z.infer<typeof setupPreparation>;
export const setupTerminal=(state:string)=>['ready','assessed','cancelled','failed','rejected','expired'].includes(state);
class SetupAPIError extends Error{constructor(message:string,readonly status:number,readonly notSubmitted=false){super(message);}}
export async function setupAPI(ownerId:string,body:unknown,signal?:AbortSignal){
 const response=await fetch('/api/connect/setups',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-kavero-connect-owner':ownerId},body:JSON.stringify(body)});
 const reader=response.body?.getReader();if(!reader)throw Error('Setup response is unavailable.');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('Setup response is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
 if(!response.ok)throw new SetupAPIError(typeof data.error==='string'?data.error.slice(0,250):'Setup is unavailable.',response.status,data.notSubmitted===true||[400,401,403,404,429].includes(response.status));return data;
}
function verify(entry:SetupEntry,raw:unknown,ownerId:string){
 const value=z.object({setupProtocol:z.literal(1),request:setupRequestView}).strict().parse(raw),r=value.request,c=entry.command;
 if(r.intent.ownerId!==ownerId||r.intent.origin!==location.origin||r.key!==c.key||r.deviceId!==c.deviceId||r.kind!==c.kind||r.intent.profile!==c.profile||r.intentHash!==entry.intentHash)throw Error('Setup identity changed. Keep the original request and reconnect.');
 return r;
}
export function useRemoteSetup(ownerId:string,enabled:boolean){
 const [list,setList]=useState<SetupEntry[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string[]>([]);
 const values=useRef<SetupEntry[]>([]),epoch=useRef(0),locks=useRef(new Set<string>()),key=`kavero.remote-setup.v1:${ownerId}`;
 const persist=useCallback((next:SetupEntry[])=>{const parsed=entries.parse(next);localStorage.setItem(key,JSON.stringify(parsed));values.current=parsed;setList(parsed);},[key]);
 useEffect(()=>{const version=++epoch.current;if(!enabled){setReady(false);return()=>{epoch.current++;};}
  const load=()=>{try{const raw=localStorage.getItem(key),parsed=entries.parse(raw?JSON.parse(raw):[]);for(const e of parsed)if(e.request)verify(e,{setupProtocol:1,request:e.request},ownerId);if(version===epoch.current){values.current=parsed;setList(parsed);setReady(true);setError('');}}catch{setReady(false);setError('Saved setup requests could not be read. Keep this browser data and reconnect before starting another request.');}};
  const storage=(event:StorageEvent)=>{if(event.key===key)load();};load();window.addEventListener('storage',storage);return()=>{epoch.current++;window.removeEventListener('storage',storage);};
 },[enabled,key,ownerId]);
 const replace=useCallback((entry:SetupEntry)=>persist(values.current.map(e=>e.command.key===entry.command.key?entry:e)),[persist]);
 const run=useCallback(async(id:string,work:()=>Promise<void>)=>{if(locks.current.has(id))return;const version=epoch.current;locks.current.add(id);setBusy([...locks.current]);try{await work();if(version===epoch.current)setError('');}catch(e){if(version===epoch.current)setError(e instanceof Error?e.message:'Reconnect to the original setup request.');}finally{locks.current.delete(id);if(version===epoch.current)setBusy([...locks.current]);}},[]);
 const refresh=useCallback(async(entry:SetupEntry)=>{
  const version=epoch.current;
  try{const raw=await setupAPI(ownerId,entry.request?{action:'inspect',id:entry.request.id}:{action:'recover',key:entry.command.key});const request=verify(entry,raw,ownerId);if(version===epoch.current)replace({...entry,request});}
  catch(e){if(e instanceof SetupAPIError&&e.status===404&&!entry.request)throw Error('The original request has not been acknowledged. Retry it using its saved key.');throw e;}
 },[ownerId,replace]);
 useEffect(()=>{if(!ready||!enabled)return;const poll=()=>{if(document.hidden)return;for(const e of values.current)if(!e.request||!setupTerminal(e.request.state))void run(e.command.key,()=>refresh(e));};
  poll();const timer=setInterval(poll,5000);document.addEventListener('visibilitychange',poll);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
 },[ready,enabled,refresh,run]);
 const adopt=useCallback((request:z.infer<typeof setupRequestView>,deviceName:string)=>{
  if(!ready||request.intent.ownerId!==ownerId||request.intent.origin!==location.origin)throw Error('Setup account or website changed.');
  if(values.current.some(e=>e.command.key===request.key))return;
  const command={action:'create' as const,key:request.key,deviceId:request.deviceId,profile:request.intent.profile,kind:request.kind,...(request.kind==='install'?{accepted:true as const,reviewHash:request.intentHash}:{})};
  const entry={command,deviceName,intentHash:request.intentHash,request};persist([...values.current.filter(e=>!e.request||!setupTerminal(e.request.state)).slice(-19),entry]);
 },[ownerId,persist,ready]);
 const submit=async(entry:SetupEntry)=>{const version=epoch.current;const raw=await setupAPI(ownerId,entry.command);const request=verify(entry,raw,ownerId);if(version===epoch.current)replace({...entry,request});};
 const start=async(preparation:Preparation,kind:'assess'|'install')=>{
  if(!ready||!enabled||preparation.intent.ownerId!==ownerId||preparation.intent.origin!==location.origin||Date.parse(preparation.expiresAt)<=Date.now())throw Error('Review this account and computer again.');
  if(!preparation.capable||kind==='install'&&!preparation.installable)throw Error(preparation.message);
  // Read the shared browser journal immediately before creating an original key.
  const stored=entries.parse(JSON.parse(localStorage.getItem(key)??'[]'));
  if(stored.filter(e=>!e.request||!setupTerminal(e.request.state)).length>=2)throw Error('Recover or finish the existing setup requests before starting another.');
  if(stored.some(e=>e.command.deviceId===preparation.intent.deviceId&&(!e.request||!setupTerminal(e.request.state))))throw Error('A setup request already exists for this computer. Recover it below.');
  const entry:SetupEntry={deviceName:preparation.deviceName,intentHash:preparation.intentHash,request:null,command:{action:'create',key:crypto.randomUUID(),deviceId:preparation.intent.deviceId,profile:preparation.intent.profile,kind,...(kind==='install'?{reviewHash:preparation.intentHash,accepted:true}:{})}};
  persist([...stored.filter(e=>!e.request||!setupTerminal(e.request.state)).slice(-19),entry]);
  await run(entry.command.key,async()=>{try{await submit(entry);}catch(e){if(e instanceof SetupAPIError&&e.notSubmitted)persist(values.current.filter(v=>v.command.key!==entry.command.key));throw e;}});
 };
 const retry=(entry:SetupEntry)=>run(entry.command.key,async()=>{const version=epoch.current;
  try{const raw=await setupAPI(ownerId,{action:'recover',key:entry.command.key});const request=verify(entry,raw,ownerId);if(version===epoch.current)replace({...entry,request});}
  catch(e){if(e instanceof SetupAPIError&&e.status===404&&!entry.request){if(version!==epoch.current)return;await submit(entry);return;}throw e;}
 });
 const cancel=(entry:SetupEntry)=>run(entry.command.key,async()=>{if(!entry.request)throw Error('Recover the original request before cancelling.');const version=epoch.current,raw=await setupAPI(ownerId,{action:'cancel',id:entry.request.id}),request=verify(entry,raw,ownerId);if(version===epoch.current)replace({...entry,request});});
 const dismiss=(entry:SetupEntry)=>{if(entry.request&&setupTerminal(entry.request.state))persist(values.current.filter(e=>e.command.key!==entry.command.key));};
 return {ownerId,enabled,ready,list,error,busy,start,retry,cancel,dismiss,adopt,profile:(p:LocalProfile)=>localProfiles.find(v=>v.profile===p)!};
}
export type RemoteSetupControl=ReturnType<typeof useRemoteSetup>;
