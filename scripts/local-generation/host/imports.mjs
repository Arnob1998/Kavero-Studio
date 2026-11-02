import {InstallFiles} from '../install/filesystem.mjs';
import {ModelImportStore,ModelImportService} from '../model-imports.mjs';
import {readModelConfig} from '../model-catalog.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const keys=(body,expected)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')===expected;
export const IMPORT_PATHS=['/host/models/import','/host/models/list','/host/models/detail','/host/models/license'];
export class HostImports {
 constructor(config,{store,service,seeds=readModelConfig()}={}){
  this.store=store??new ModelImportStore(new InstallFiles(config.root,config.instanceId));
  this.service=service??new ModelImportService(this.store);this.seeds=seeds.models;
 }
 get busy(){return this.service.inflight.size>0;}
 summary(row){
  const s=row.snapshot;
  return {id:row.id,key:row.submissionKey,createdAt:row.createdAt,state:s?'inspected':this.active.has(row.id)?'inspecting':'retry-required',source:row.request.source,
   requestedRevision:row.request.requestedRevision,revision:s?.revision??null,sourceValidity:s?.sourceValidity??'unverified',
   recipeSupport:s?.recipeSupport??'unverified',license:s?.license?.identifier??null,ready:false,installable:false};
 }
 active=new Set();
 handle(path,body){
  if(!uuid(body?.owner))throw Error('invalid-model-import-request');
  if(path==='/host/models/import'){
   if(!keys(body,'key,model,owner')||!uuid(body.key))throw Error('invalid-model-import-request');
   const {row,pending}=this.service.begin(body.owner,body.key,body.model);
   if(!row.snapshot){this.active.add(row.id);void pending.catch(()=>{}).finally(()=>this.active.delete(row.id));}
   return {status:row.snapshot?200:202,body:{model:this.summary(row)}};
  }
  if(path==='/host/models/list'){
   if(!keys(body,'offset,owner')||!Number.isInteger(body.offset)||body.offset<0||body.offset>100)throw Error('invalid-model-import-request');
   const all=this.store.list(body.owner),rows=all.slice(body.offset,body.offset+5);
   return {status:200,body:{models:rows.map(row=>this.summary(row)),nextOffset:body.offset+5<Math.max(all.length,this.seeds.length)?body.offset+5:null,
    // Seeds are requests only, never inferred readiness. Private imports cannot overwrite them.
    seeds:this.seeds.slice(body.offset,body.offset+5).map(source=>({source,ready:false,installable:false})),seedCount:this.seeds.length}};
  }
  if(!keys(body,path==='/host/models/license'?'component,id,owner':'id,owner')||!uuid(body.id))throw Error('invalid-model-import-request');
  const row=this.store.get(body.owner,body.id);if(!row)return {status:404,body:{error:'model-import-not-found'}};
  if(path==='/host/models/detail')return {status:200,body:{model:this.summary(row),snapshot:row.snapshot}};
  if(path==='/host/models/license'){
   if(!['model','engine','image-weights','text-encoder','vae'].includes(body.component))throw Error('invalid-model-import-request');
   const license=body.component==='model'?row.snapshot?.license:row.snapshot?.components?.find(c=>c.role===body.component)?.license;
   return {status:200,body:{license:license??{identifier:null,text:null,sourceUrl:null,status:'unknown'}}};
  }
  throw Error('invalid-model-import-request');
 }
 close(){if(this.busy)throw Error('model-discovery-busy');this.store.close();}
}
