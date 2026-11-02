// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import {discoverModel,normalizeModelLink} from './model-discovery.mjs';
import {existingQwenRecipe} from './model-catalog.mjs';
const recipe=existingQwenRecipe();
const seed={id:recipe.id,source:recipe.source.source,preferredFile:recipe.source.preferredFile};
function fixture(){
 const repos=new Map();
 for(const component of recipe.components.filter(c=>c.role!=='engine')){
  const link=normalizeModelLink({id:component.role,source:component.url});
  repos.set(link.repo,{id:link.repo,sha:component.revision,gated:false,pipeline_tag:'text-to-image',cardData:{license:'mit'},siblings:[
   {rfilename:link.source.preferredFile,size:component.bytes,lfs:{sha256:component.sha256,size:component.bytes}},
   {rfilename:'README.md',size:100},{rfilename:'LICENSE',size:100},
  ]});
 }
 const calls=[],disposed=[];
 const transport=vi.fn(async(url,options)=>{
  const u=new URL(url);calls.push({url:u.href,headers:options.headers});
  const match=/^\/api\/models\/(.+\/.+)\/revision\/(.+)$/.exec(u.pathname);
  let status=200,data;
  if(match){data=repos.get(match[1]);if(!data)status=404;data=JSON.stringify(data??{});}
  else if(u.pathname.endsWith('/README.md'))data='<script>neverExecute()</script>\nPublisher description';
  else if(u.pathname.endsWith('/LICENSE'))data='Upstream fixture license text';
  else throw Error('Unexpected non-metadata request: '+u.href);
  return {status,headers:{},body:Readable.from([Buffer.from(data)]),dispose(){disposed.push(u.href);}};
 });
 return {repos,calls,disposed,transport,main:repos.get('Abiray/Qwen-Image-2.1-GGUF')};
}
describe('Bounded Hugging Face model discovery',()=>{
 it('normalizes repo, revision and file links without accepting ambiguous selection',()=>{
  expect(normalizeModelLink(seed)).toMatchObject({source:seed,requestedRevision:'main'});
  for(const kind of ['blob','resolve'])expect(normalizeModelLink({id:seed.id,source:`${seed.source}/${kind}/${recipe.source.revision}/${seed.preferredFile}`})).toMatchObject({source:seed,requestedRevision:recipe.source.revision});
  expect(normalizeModelLink({id:seed.id,source:seed.source+'/tree/main'}).requestedRevision).toBe('main');
  expect(()=>normalizeModelLink({...seed,source:seed.source+'/resolve/main/other.gguf'})).toThrow('conflicting-model-file');
  expect(()=>normalizeModelLink({id:seed.id,source:seed.source+'/tree/main/subfolder'})).toThrow();
 });
 it.each(['http://huggingface.co/owner/repo','https://huggingface.co.evil.test/owner/repo','https://huggingface.co@127.0.0.1/owner/repo','https://huggingface.co/owner/repo?token=secret','https://huggingface.co/owner/repo/resolve/main/../bad.gguf','https://huggingface.co/owner/repo/blob/%2fmain/a.gguf'])(
  'rejects unsafe source before any request: %s',async source=>{
   const f=fixture();await expect(discoverModel({...seed,source},{transport:f.transport})).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();
  });
 it('pins complete known metadata but never enables installation, editing or readiness',async()=>{
  const f=fixture(),s=await discoverModel(seed,{transport:f.transport});
  expect(s).toMatchObject({revision:recipe.source.revision,sourceValidity:'valid',recipeSupport:'known-recipe',recipeManifest:recipe.legacy.manifestHash,ready:false,installable:false,hardware:'not-checked',smoke:'not-run'});
  expect(s.effectiveCapabilities.referenceEditing).toBe(false);expect(s.readme.text).toContain('<script>');expect(s.license.status).toBe('cached-upstream-text');
  expect(s.components).toHaveLength(4);expect(s.components.every(c=>c.license.text.content)).toBe(true);
  expect(f.disposed).toHaveLength(f.calls.length);
  for(const call of f.calls){expect(call.url).not.toMatch(/\.(gguf|safetensors|exe|zip)(?:\?|$)/);expect(call.headers.authorization).toBeUndefined();}
 });
 it('does not infer compatibility from model card claims or new repository revisions',async()=>{
  const f=fixture();f.main.cardData={license:'mit',capabilities:{editing:true},command:'evil'};f.main.sha='a'.repeat(40);
  const s=await discoverModel(seed,{transport:f.transport});expect(s.recipeSupport).toBe('revision-changed');expect(s.effectiveCapabilities).toBeNull();
 });
 it('requires a variant when there are multiple weights and refuses unsupported formats',async()=>{
  const f=fixture();f.main.siblings.push({rfilename:'other.gguf',size:20,lfs:{sha256:'a'.repeat(64),size:20}});
  expect((await discoverModel({id:seed.id,source:seed.source},{transport:f.transport})).recipeSupport).toBe('needs-variant');
  expect((await discoverModel({...seed,preferredFile:'README.md'},{transport:f.transport})).recipeSupport).toBe('unsupported-format');
  expect((await discoverModel({...seed,preferredFile:'missing.gguf'},{transport:f.transport})).issues).toContain('selected-file-not-found');
 });
 it.each(['missing','corrupt','hashless','gated'])('fails closed on %s dependency metadata',async mode=>{
  const f=fixture(),encoder=f.repos.get('Qwen/Qwen3-VL-8B-Instruct-GGUF');
  if(mode==='missing')encoder.siblings.shift();if(mode==='corrupt')encoder.siblings[0].lfs.sha256='a'.repeat(64);
  if(mode==='hashless')delete encoder.siblings[0].lfs;if(mode==='gated')encoder.gated='manual';
  const s=await discoverModel(seed,{transport:f.transport});expect(s.recipeSupport).toBe('needs-components');expect(s.effectiveCapabilities).toBeNull();expect(s.ready).toBe(false);
 });
 it('records unknown architecture/task without inventing capabilities or hashes',async()=>{
  const f=fixture();f.repos.set('owner/language',{id:'owner/language',sha:'b'.repeat(40),gated:false,pipeline_tag:'text-generation',cardData:{},siblings:[{rfilename:'weights.gguf',size:100}]});
  const s=await discoverModel({id:'language',source:'https://huggingface.co/owner/language'},{transport:f.transport});
  expect(s).toMatchObject({sourceValidity:'valid',recipeSupport:'unsupported-runtime',effectiveCapabilities:null});expect(s.issues).toEqual(['missing-integrity-metadata','unsupported-task']);expect(s.license.status).toBe('unknown');
 });
 it.each([[404,'source-not-found'],[403,'publisher-access-required'],[429,'source-rate-limited'],[500,'metadata-unavailable']])('returns bounded failure for HTTP %i',async(status,code)=>{
  const dispose=vi.fn();const s=await discoverModel(seed,{transport:async()=>({status,headers:{},body:Readable.from([]),dispose})});
  expect(s.sourceValidity).toBe('unavailable');expect(s.issues).toContain(code);expect(dispose).toHaveBeenCalledOnce();
 });
 it('rejects redirects to private hosts and to model weight paths',async()=>{
  for(const location of ['https://127.0.0.1/secret','https://evil.test/LICENSE',seed.source+'/resolve/main/weights.gguf']){
   const transport=vi.fn(async()=>({status:302,headers:{location},body:Readable.from([]),dispose(){}}));
   const s=await discoverModel(seed,{transport});expect(s.sourceValidity).toBe('unavailable');expect(transport).toHaveBeenCalledOnce();
  }
 });
 it.each(['malformed','oversized','stream-limit','file-count','duplicate','wrong-revision','unsafe-path'])('rejects %s metadata',async mode=>{
  const f=fixture();if(mode==='file-count')f.main.siblings=Array.from({length:1001},(_,i)=>({rfilename:`${i}.gguf`}));
  if(mode==='duplicate')f.main.siblings.push({...f.main.siblings[0],rfilename:f.main.siblings[0].rfilename.toUpperCase()});
  if(mode==='wrong-revision')f.main.sha='b'.repeat(40);if(mode==='unsafe-path')f.main.siblings[0].rfilename='../weights.gguf';
  const transport=['malformed','oversized','stream-limit'].includes(mode)?async()=>({status:200,headers:mode==='oversized'?{'content-length':String(3*1024**2)}:{},body:Readable.from([Buffer.from(mode==='malformed'?'broken': 'x'.repeat(2*1024**2+1))]),dispose(){}}):f.transport;
  const s=await discoverModel({...seed,source:seed.source+'/tree/'+recipe.source.revision},{transport});expect(s.sourceValidity).toBe('unavailable');expect(s.ready).toBe(false);
 });
 it('does not follow arbitrary external license links or fetch weight-like license targets',async()=>{
  const f=fixture();f.main.cardData.license_link='http://127.0.0.1/secret';f.main.siblings=f.main.siblings.filter(file=>file.rfilename!=='LICENSE');
  const s=await discoverModel(seed,{transport:f.transport});expect(s.license.status).toBe('declared-only');expect(f.calls.every(call=>new URL(call.url).hostname==='huggingface.co')).toBe(true);
 });
 it('reports upstream gating without fetching cards, licenses or dependencies',async()=>{
  const f=fixture();f.main.gated='auto';const s=await discoverModel(seed,{transport:f.transport});expect(s.recipeSupport).toBe('access-required');expect(f.calls).toHaveLength(1);
 });
 it('honors cancellation before any transport call',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  const s=await discoverModel(seed,{transport:f.transport,signal:controller.signal});expect(s.sourceValidity).toBe('unavailable');expect(f.transport).not.toHaveBeenCalled();
 });
});
