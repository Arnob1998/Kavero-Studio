// Metadata-only discovery: this module cannot install, activate or execute models.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseLocalModelSource,modelRelativePath} from '../../src/modules/model-providers/local/model-contract.ts';
import {httpsTransport} from './install/download.mjs';
import {allowedURL,canonical} from './install/manifest.mjs';
import {verifiedQwenRecipes} from './model-catalog.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class ModelDiscoveryError extends Error {constructor(code){super(code);this.code=code;}}
const reject=code=>{throw new ModelDiscoveryError(code);};

export function normalizeModelLink(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['id','source','preferredFile'].includes(k)))reject('invalid-model-source');
 let url;try{url=new URL(input.source);}catch{reject('invalid-model-source');}
 if(url.protocol!=='https:'||url.hostname!=='huggingface.co'||url.port||url.username||url.password||url.search||url.hash||url.href!==input.source)reject('invalid-model-source');
 const parts=url.pathname.replace(/\/$/,'').slice(1).split('/');
 const base=`https://huggingface.co/${parts.slice(0,2).join('/')}`;
 let revision='main',preferredFile=input.preferredFile;
 if(parts.length>2){
  if(!['tree','blob','resolve'].includes(parts[2])||!parts[3]||!/^[-a-zA-Z0-9_.]{1,120}$/.test(parts[3])||['.','..'].includes(parts[3]))reject('unsupported-model-link');
  revision=parts[3];
  if(parts[2]==='tree'){if(parts.length!==4)reject('unsupported-model-link');}
  else{if(parts.length<5)reject('unsupported-model-link');const file=modelRelativePath(parts.slice(4).join('/'));if(preferredFile!==undefined&&preferredFile!==file)reject('conflicting-model-file');preferredFile=file;}
 }
 const source=parseLocalModelSource({id:input.id,source:base,...(preferredFile!==undefined?{preferredFile}:{})});
 return {source,repo:new URL(source.source).pathname.slice(1),requestedRevision:revision};
}

function metadataClient({transport=httpsTransport,signal}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let requests=0,total=0;
 async function bytes(address,limit=2*1024**2){
  let url=allowedURL(address,['huggingface.co']);
  const paths=new Set([url.pathname,url.pathname.replace(/^\/(.+\/.+)\/raw\/([a-f0-9]{40})\//,'/api/resolve-cache/models/$1/$2/')]);
  for(let redirects=0;redirects<=2;redirects++){
   if(++requests>24||controller.signal.aborted)reject('metadata-request-limit');
   let response;try{response=await transport(url,{headers:{'accept-encoding':'identity','user-agent':'Kavero-Model-Discovery/1'},signal:controller.signal});}catch{reject(controller.signal.aborted?'metadata-timeout':'metadata-unavailable');}
   try{
    if([301,302,303,307,308].includes(response.status)){
     if(redirects===2||typeof response.headers.location!=='string')reject('metadata-redirect-rejected');
     // DNS/private-address rejection happens in httpsTransport for every hop.
     url=allowedURL(new URL(response.headers.location,url).href,['huggingface.co']);
     if(!paths.has(url.pathname))reject('metadata-redirect-rejected');continue;
    }
    if(response.status!==200)reject(response.status===404?'source-not-found':[401,403].includes(response.status)?'publisher-access-required':response.status===429?'source-rate-limited':'metadata-unavailable');
    if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')reject('metadata-encoding-rejected');
    if(response.headers['content-length']!==undefined&&(!/^\d+$/.test(String(response.headers['content-length']))||Number(response.headers['content-length'])>limit))reject('metadata-too-large');
    const chunks=[];let size=0;
    for await(const chunk of response.body){
     if(controller.signal.aborted)reject('metadata-timeout');
     size+=chunk.length;total+=chunk.length;if(size>limit||total>8*1024**2)reject('metadata-too-large');chunks.push(chunk);
    }
    const data=Buffer.concat(chunks);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{reject('metadata-invalid-text');}
    if(text.includes('\0'))reject('metadata-invalid-text');
    return {text,sha256:hash(data),bytes:data.length,url:url.href};
   }finally{response.dispose();}
  }
 }
 return {bytes,async info(repo,revision){
  const raw=await bytes(`https://huggingface.co/api/models/${repo}/revision/${encodeURIComponent(revision)}?blobs=true`);
  let data;try{data=JSON.parse(raw.text);}catch{reject('metadata-invalid-json');}
  if(!data||typeof data!=='object'||!commit(data.sha)||(commit(revision)&&data.sha!==revision)||typeof data.id!=='string'||data.id.toLowerCase()!==repo.toLowerCase()
    ||!Array.isArray(data.siblings)||data.siblings.length>1000)reject('metadata-invalid-model');
  const names=new Set();const files=data.siblings.map(file=>{
   let name;try{name=modelRelativePath(file.rfilename);}catch{reject('metadata-invalid-file');}
   if(names.has(name.toLowerCase()))reject('metadata-invalid-file');names.add(name.toLowerCase());
   const size=Number.isSafeInteger(file.size)&&file.size>=0?file.size:null;
   const sha256=digest(file.lfs?.sha256)?file.lfs.sha256:null;
   if(sha256&&(!Number.isSafeInteger(file.lfs.size)||file.lfs.size!==size))reject('metadata-invalid-file');
   return {name,bytes:size,sha256};
  });
  const card=data.cardData&&typeof data.cardData==='object'&&!Array.isArray(data.cardData)?data.cardData:{};
  const string=value=>typeof value==='string'&&value.length<=512?value:null;
  return {repo,revision:data.sha,gated:data.gated===true||typeof data.gated==='string',task:string(data.pipeline_tag),files,
   declared:{license:string(card.license==='other'?card.license_name:card.license),licenseLink:string(card.license_link),baseModel:string(card.base_model)},metadataSha256:raw.sha256};
 },close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}

async function licenseFor(client,info){
 let target=null;
 if(info.declared.licenseLink){
  try{target=normalizeModelLink({id:'license',source:info.declared.licenseLink});if(!target.source.preferredFile)target=null;}catch{/* External/unsafe license links are never fetched. */}
 }
 if(!target){const file=info.files.find(f=>/^(?:LICENSE|LICENCE)(?:\.(?:txt|md))?$/i.test(f.name));if(file)target={repo:info.repo,requestedRevision:info.revision,source:{preferredFile:file.name}};}
 if(!target)return {identifier:info.declared.license,sourceUrl:null,text:null,status:info.declared.license?'declared-only':'unknown'};
 if(!/^(?:[^/]+\/)*(?:LICENSE|LICENCE)(?:\.(?:txt|md))?$/i.test(target.source.preferredFile))return {identifier:info.declared.license,sourceUrl:null,text:null,status:'unsupported-license-link'};
 try{
  const upstream=target.repo===info.repo&&[info.revision,'main'].includes(target.requestedRevision)?info:await client.info(target.repo,target.requestedRevision);
  if(upstream.gated)reject('publisher-access-required');
  const raw=await client.bytes(`https://huggingface.co/${upstream.repo}/raw/${upstream.revision}/${target.source.preferredFile}`,256*1024);
  return {identifier:info.declared.license,sourceUrl:raw.url,text:{content:raw.text,sha256:raw.sha256,bytes:raw.bytes},status:'cached-upstream-text'};
 }catch(error){return {identifier:info.declared.license,sourceUrl:null,text:null,status:error.code??'license-unavailable'};}
}

export async function discoverModel(input,options={}){
 const normalized=normalizeModelLink(input),client=metadataClient(options),issues=[];
 const snapshot={schemaVersion:1,source:normalized.source,requestedRevision:normalized.requestedRevision,revision:null,
  sourceValidity:'unverified',recipeSupport:'unverified',selectedFile:null,variants:[],declared:null,readme:null,license:null,components:[],
  recipeId:null,recipeManifest:null,effectiveCapabilities:null,hardware:'not-checked',installation:'not-checked',smoke:'not-run',installable:false,ready:false,issues};
 try{
  const info=await client.info(normalized.repo,normalized.requestedRevision);
  Object.assign(snapshot,{revision:info.revision,sourceValidity:'valid',declared:{task:info.task,...info.declared},metadataSha256:info.metadataSha256});
  if(info.gated){issues.push('publisher-access-required');snapshot.recipeSupport='access-required';return snapshot;}
  snapshot.license=await licenseFor(client,info);
  const readme=info.files.find(file=>file.name==='README.md');
  if(readme){try{snapshot.readme=await client.bytes(`https://huggingface.co/${info.repo}/raw/${info.revision}/README.md`,256*1024);}catch(error){issues.push(error.code??'readme-unavailable');}}
  const variants=info.files.filter(file=>/\.(?:gguf|safetensors)$/i.test(file.name));snapshot.variants=variants;
  const chosen=normalized.source.preferredFile?info.files.find(file=>file.name===normalized.source.preferredFile):variants.length===1?variants[0]:null;
  snapshot.selectedFile=chosen??null;
  if(!chosen){snapshot.recipeSupport=variants.length?'needs-variant':'unsupported-format';issues.push(normalized.source.preferredFile?'selected-file-not-found':variants.length?'choose-model-file':'no-supported-weights');return snapshot;}
  if(!/\.(?:gguf|safetensors)$/i.test(chosen.name)){snapshot.recipeSupport='unsupported-format';issues.push('unsupported-weight-format');return snapshot;}
  if(!chosen.sha256||chosen.bytes===null)issues.push('missing-integrity-metadata');
  const recipe=verifiedQwenRecipes().find(recipe=>normalized.source.source===recipe.source.source&&chosen.name===recipe.source.preferredFile);
  if(!recipe){
   snapshot.recipeSupport='unsupported-runtime';issues.push(info.task&&info.task!=='text-to-image'&&info.task!=='image-to-image'?'unsupported-task':'no-verified-recipe');return snapshot;
  }
  if(info.revision!==recipe.source.revision){snapshot.recipeSupport='revision-changed';issues.push('recipe-revision-mismatch');return snapshot;}
  let complete=true;
  for(const component of recipe.components){
   if(component.role==='engine'){snapshot.components.push({...component,status:'pinned-recipe-only',license:knownLicense(recipe,'engine')});continue;}
   const link=normalizeModelLink({id:component.role,source:component.url});
   let status='verified-metadata';
   try{
    const dependency=link.repo===info.repo?info:await client.info(link.repo,component.revision);
    const file=dependency.files.find(file=>file.name===link.source.preferredFile);
    if(dependency.gated)status='publisher-access-required';
    else if(!file)status='missing-component';
    else if(file.bytes!==component.bytes||file.sha256!==component.sha256)status=file.sha256?'component-identity-mismatch':'missing-integrity-metadata';
   }catch(error){status=error.code??'dependency-unavailable';}
   if(status!=='verified-metadata'){complete=false;issues.push(status);}
   snapshot.components.push({...component,status,license:knownLicense(recipe,component.role)});
  }
  snapshot.recipeSupport=complete?'known-recipe':'needs-components';
  if(complete){snapshot.recipeId=recipe.id;snapshot.recipeManifest=recipe.legacy.manifestHash;snapshot.effectiveCapabilities=recipe.capabilities;}
  return snapshot;
 }catch(error){snapshot.sourceValidity='unavailable';issues.push(error.code??'metadata-unavailable');return snapshot;}
 finally{client.close();}
}

export function discoveryDigest(snapshot){return hash(canonical(snapshot));}

function knownLicense(recipe,role){
 const reference=recipe.licenses.find(entry=>entry.component===role);
 if(!reference?.text)return {identifier:reference?.identifier??null,status:'unknown',sourceUrl:reference?.sourceUrl??null,text:null};
 const filename=reference.text.path.replace(/^notices\//,'');modelRelativePath(filename);
 const bytes=readFileSync(new URL('./notices/qwen-research-v1/'+filename,import.meta.url));
 if(bytes.length!==reference.text.bytes||hash(bytes)!==reference.text.sha256)reject('cached-license-changed');
 return {identifier:reference.identifier,sourceUrl:reference.sourceUrl,status:'cached-existing-recipe',attribution:reference.attribution,
  text:{content:bytes.toString('utf8'),bytes:bytes.length,sha256:hash(bytes)}};
}
