// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {existingQwenRecipe,readModelConfig,inspectConfiguredModel,validateExistingRecipeSnapshot} from './model-catalog.mjs';
import {parseResolvedLocalRecipe,validateLocalRecipeIntent} from '../../src/modules/model-providers/local/model-contract.ts';
import {LOCAL_IMAGE_CAPABILITIES} from '../../src/modules/generation/local/capabilities.ts';
import {localJobIntentSchema} from '../../src/modules/generation/local/contracts.ts';
import {validateIntent} from './ledger.mjs';
import {engineCommand,FINGERPRINT} from './profile.mjs';
import {qwenResearchDelivery} from './install/qwen-delivery.mjs';
import {validateManifest,sha} from './install/manifest.mjs';

describe('MH-1 existing recipe boundary',()=>{
 it('loads seed requests without making unknown model/variant links runnable',()=>{
  const [seed]=readModelConfig().models;
  expect(inspectConfiguredModel(seed).status).toBe('known-recipe');
  for(const input of [{...seed,preferredFile:undefined},{...seed,preferredFile:'qwen_image_2.1_Q8_0.gguf'},{...seed,source:'https://huggingface.co/owner/another-model'}]){
   if(input.preferredFile===undefined)delete input.preferredFile;
   expect(inspectConfiguredModel(input)).toMatchObject({status:'unresolved',recipe:null});
  }
 });
 it('preserves the exact manifest, receipt and model identities',()=>{
  const r=existingQwenRecipe();
  expect(r.legacy).toEqual({profile:'qwen-image-2.1-q4-evaluation',packageId:'qwen-2-1-internal-evaluation',packageFingerprint:FINGERPRINT,
   receiptHash:'cdfa06c56c9fdbf2a248497483e0cf0972e83d81d4b91be7ea6fa384348d2054',manifestHash:'35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822',termsDigest:'35dc562ce673a5602f6f03d377538b52a8af144384ec85829d430c63f0e9ad41'});
  const manifest=qwenResearchDelivery();expect(validateManifest(manifest,'user-selected').hash).toBe(r.legacy.manifestHash);
  expect(r.components).toEqual(manifest.artifacts.map(a=>({role:a.role,url:a.url,revision:a.revision,bytes:a.bytes,sha256:a.sha256,path:a.destination??a.retainAs})));
  expect(r.capabilities).toMatchObject({sizes:[{width:LOCAL_IMAGE_CAPABILITIES.width,height:LOCAL_IMAGE_CAPABILITIES.height}],counts:[LOCAL_IMAGE_CAPABILITIES.count],prompt:{maximum:LOCAL_IMAGE_CAPABILITIES.maxPromptCharacters},referenceEditing:false,planning:false,sequence:false});
 });
 it.each([
  r=>{r.capabilities.referenceEditing=true;},r=>{r.capabilities.prompt.maximum=1001;},r=>{r.runtime.revision='a'.repeat(40);},
  r=>{r.components[1].sha256='a'.repeat(64);},r=>{r.legacy.termsDigest='a'.repeat(64);},r=>{r.command='bad';},r=>{r.extra=undefined;},
 ])('rejects changed policy or extra fields in resolved snapshots',change=>{
  const r=existingQwenRecipe();change(r);expect(()=>validateExistingRecipeSnapshot(r)).toThrow('resolved-model-recipe-mismatch');
 });
 it('validates descriptor structure and does not treat descriptors as readiness',()=>{
  const r=existingQwenRecipe();expect(parseResolvedLocalRecipe(r)).toEqual(r);expect(()=>validateExistingRecipeSnapshot(r)).not.toThrow();
  expect(r.evidence).toMatchObject({installed:'check-required',hardware:'check-required',performance:'device-specific'});
  for(const change of [v=>{v.schemaVersion=2;},v=>{v.components[1].bytes=-1;},v=>{v.components[1].path='../model';},v=>{v.capabilities.counts=[];},v=>{v.licenses[0].text.sha256='bad';},v=>{v.evidence.installed='ready';}]){
   const changed=structuredClone(r);change(changed);expect(()=>parseResolvedLocalRecipe(changed)).toThrow();
  }
 });
 it('matches app and worker validation including UTF-16 prompt boundaries',()=>{
  const r=existingQwenRecipe(),base={profile:r.legacy.profile,prompt:'A vase',width:512,height:512,count:1};
  for(const intent of [base,{...base,prompt:'😀'.repeat(500)},{...base,prompt:'😀'.repeat(501)},{...base,prompt:' '},{...base,width:1024},{...base,count:2},{...base,profile:'other'},{...base,referenceImages:[]}]){
   const accepted=validateLocalRecipeIntent(r,intent);expect(accepted).toBe(localJobIntentSchema.safeParse(intent).success);
   let worker=true;try{validateIntent(intent);}catch{worker=false;}expect(accepted).toBe(worker);
  }
 });
 it('provides pinned upstream license text references without changing existing notice bytes',()=>{
  const r=existingQwenRecipe(),manifest=qwenResearchDelivery();
  expect(r.licenses.map(l=>l.identifier)).toEqual(['qwen-research','apache-2.0','qwen-research','mit']);
  expect(r.licenses.find(l=>l.component==='vae').attribution).toBe('cached-model-card');
  for(const license of r.licenses){const file=manifest.bundledFiles.find(f=>f.path===license.text.path);
   expect(sha(Buffer.from(file.dataBase64,'base64'))).toBe(license.text.sha256);expect(file.bytes).toBe(license.text.bytes);
   expect(license.sourceUrl).toMatch(/^https:\/\//);
  }
  r.capabilities.counts.push(2);expect(existingQwenRecipe().capabilities.counts).toEqual([1]);
 });
 it('preserves every existing engine command argument without launching an engine',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-mh1-command-'));
  try{
   for(const filename of ['engine/sd-cli.exe',...existingQwenRecipe().components.filter(c=>c.role!=='engine').map(c=>c.path)]){
    mkdirSync(path.dirname(path.join(root,filename)),{recursive:true});writeFileSync(path.join(root,filename),'fixture');
   }
   const job=path.join(root,'job'),r=existingQwenRecipe();
   expect(engineCommand(root,job,1)).toEqual({file:path.join(root,'engine/sd-cli.exe'),args:[
    '--diffusion-model',path.join(root,r.components[1].path),'--llm',path.join(root,r.components[2].path),'--vae',path.join(root,r.components[3].path),
    '--backend','diffusion=vulkan1,clip=cpu,vae=vulkan1','--offload-to-cpu','--max-vram','6','--fa','--vae-tiling',
    '--prompt-file',path.join(job,'prompt.txt'),'-W','512','-H','512','--steps',String(r.defaults.steps),'--cfg-scale',String(r.defaults.cfg),'--sampling-method',r.defaults.sampler,'-s',String(r.defaults.seed),'-o',path.join(job,'final.png')]});
  }finally{rmSync(root,{recursive:true,force:true});}
 });
 it('runs the shared contract in an isolated Node package with no node_modules',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-mh1-contract-'));
  try{
   const file=path.join(root,'model-contract.ts');copyFileSync(new URL('../../src/modules/model-providers/local/model-contract.ts',import.meta.url),file);
   const code=`import {parseLocalModelConfig,parseResolvedLocalRecipe} from ${JSON.stringify(pathToFileURL(file).href)};const data=JSON.parse(process.argv[1]);console.log(JSON.stringify({config:parseLocalModelConfig(data.config).schemaVersion,recipe:parseResolvedLocalRecipe(data.recipe).id}));`;
   const result=execFileSync(process.execPath,['--input-type=module','-e',code,JSON.stringify({config:readModelConfig(),recipe:existingQwenRecipe()})],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true});
   expect(JSON.parse(result)).toEqual({config:1,recipe:'qwen-image-2-1'});
   expect(readFileSync(file,'utf8')).not.toContain('from "zod"');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
