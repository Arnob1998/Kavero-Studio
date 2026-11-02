// MH-1 catalog foundation only. No network, installation or activation side effects.
import { readFileSync } from 'node:fs';
import { parseLocalModelConfig,parseLocalModelSource,parseResolvedLocalRecipe,assertResolvedRecipeMatches } from '../../src/modules/model-providers/local/model-contract.ts';
import { qwenResearchDelivery,qwenQ3Delivery } from './install/qwen-delivery.mjs';
import { validateManifest } from './install/manifest.mjs';
import { MODEL_RECEIPT_HASH,EVALUATION_PACKAGE,Q3_PACKAGE,managedPackageIdentity } from './host/model-package.mjs';

export function readModelConfig(filename=new URL('./models.json',import.meta.url)) {
  const bytes=readFileSync(filename);if(bytes.length>128*1024)throw Error('model-config-too-large');
  return parseLocalModelConfig(JSON.parse(bytes.toString('utf8')));
}

/** @returns {import('../../src/modules/model-providers/local/model-contract.ts').ResolvedLocalRecipe} */
export function existingQwenRecipe() {
  const manifest=qwenResearchDelivery(),verified=validateManifest(manifest,'user-selected');
  const recipe=JSON.parse(readFileSync(new URL('./install/qwen-recipe.json',import.meta.url),'utf8'));
  const audit=JSON.parse(readFileSync(new URL('./install/qwen-research-audit.json',import.meta.url),'utf8'));
  const source=parseLocalModelSource({id:'qwen-image-2-1',source:'https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF',preferredFile:'qwen_image_2.1_Q4_K_M.gguf'});
  const notice=(path)=>{
    const file=manifest.bundledFiles.find(file=>file.path===path);
    if(!file)throw Error('model-license-reference-missing');
    return {path:file.path,bytes:file.bytes,sha256:file.sha256};
  };
  const license=(component,identifier,filename,attribution='cached-upstream-license')=>{
    const path='notices/'+filename,entry=audit.evidence.find(entry=>entry.path.endsWith('/'+filename));
    if(!entry)throw Error('model-license-reference-missing');
    return {component,identifier,attribution,sourceUrl:entry.url,text:notice(path)};
  };
  return parseResolvedLocalRecipe({
    schemaVersion:1,id:source.id,recipeVersion:1,source:{...source,revision:recipe.model_revision},label:'Qwen Image 2.1 · Q4',
    runtime:{adapter:'stable-diffusion-cpp',revision:recipe.engine_commit,platform:'win32',arch:'x64',backend:'vulkan'},
    legacy:{profile:'qwen-image-2.1-q4-evaluation',packageId:EVALUATION_PACKAGE,packageFingerprint:manifest.profile,
      receiptHash:MODEL_RECEIPT_HASH,manifestHash:verified.hash,termsDigest:manifest.termsDigest},
    components:manifest.artifacts.map(artifact=>({role:artifact.role,url:artifact.url,revision:artifact.revision,
      bytes:artifact.bytes,sha256:artifact.sha256,path:artifact.destination??artifact.retainAs})),
    capabilities:{textToImage:true,referenceEditing:false,masks:false,planning:false,sequence:false,maximumReferences:0,
      sizes:[{width:512,height:512}],counts:[1],prompt:{maximum:1000,unit:'utf16-code-units',overflow:'reject'},quality:[],background:[],reasoning:[]},
    defaults:{steps:20,cfg:6,seed:42,sampler:'euler'},
    execution:{diffusion:'gpu',encoder:'cpu',vae:'gpu',offloadToCpu:true,maxVramGiB:6,flashAttention:true,vaeTiling:true},
    hardware:{minimumVramMiB:8000,minimumRamBytes:15*1024**3,maximumDevices:1,deviceFamilies:['NVIDIA GeForce RTX 30','NVIDIA GeForce RTX 40']},
    licenses:[
      license('image-weights','qwen-research','qwen-image-LICENSE.txt'),
      license('text-encoder','apache-2.0','encoder-Apache-LICENSE.txt'),
      license('vae','qwen-research','qwen-image-LICENSE.txt','cached-model-card'),
      license('engine','mit','engine-LICENSE.txt'),
    ],
    evidence:{source:'pinned-existing-recipe',runtime:'verified-existing-workload',hardware:'check-required',installed:'check-required',performance:'device-specific'},
  });
}

// Exact registry lookup is intentional. Merely editing the seed cannot grant
// support to another quantization/family. MH-2 will return richer inspection data.
export function inspectConfiguredModel(input) {
  const source=parseLocalModelSource(input),recipe=verifiedQwenRecipes().find(recipe=>source.source===recipe.source.source&&source.preferredFile===recipe.source.preferredFile);
  if(!recipe)
    return {source,status:'unresolved',recipe:null};
  return {source,status:'known-recipe',recipe};
}
export function qwenQ3Recipe(){
 const recipe=existingQwenRecipe(),manifest=qwenQ3Delivery(),verified=validateManifest(manifest,'user-selected'),identity=managedPackageIdentity(Q3_PACKAGE);
 return parseResolvedLocalRecipe({...recipe,id:'qwen-image-2-1-q3',label:'Qwen Image 2.1 · Q3',source:{...recipe.source,id:'qwen-image-2-1-q3',preferredFile:'qwen_image_2.1_Q3_K_M.gguf'},
  legacy:{...recipe.legacy,profile:'qwen-image-2.1-q3-evaluation',packageId:Q3_PACKAGE,packageFingerprint:identity.profile,receiptHash:identity.receipt,manifestHash:verified.hash},
  components:manifest.artifacts.map(artifact=>({role:artifact.role,url:artifact.url,revision:artifact.revision,bytes:artifact.bytes,sha256:artifact.sha256,path:artifact.destination??artifact.retainAs}))});
}
export function verifiedQwenRecipes(){return [existingQwenRecipe(),qwenQ3Recipe()];}
export function validateExistingRecipeSnapshot(input) {
  assertResolvedRecipeMatches(input,existingQwenRecipe());
}
