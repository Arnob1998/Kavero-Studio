import { readFileSync } from 'node:fs';
import { sha,validateManifest } from './manifest.mjs';
import {nativeProfile,Q3_FINGERPRINT} from '../profiles.mjs';
const fingerprint='d9cd1dc7cc93a20c2ffc8cc780393a04cfc6043a5560ddf12f2924c3ea575f07';
const terms='35dc562ce673a5602f6f03d377538b52a8af144384ec85829d430c63f0e9ad41';
// Host-owned research proof catalog. Never construct this from browser input or
// promote it to public approval because transport/installation succeeds.
export function qwenResearchDelivery() {
  const audit=JSON.parse(readFileSync(new URL('./qwen-research-audit.json',import.meta.url),'utf8'));
  const recipeBytes=readFileSync(new URL('./qwen-recipe.json',import.meta.url));
  const recipe=JSON.parse(recipeBytes),pinned=JSON.parse(readFileSync(new URL('../profile.json',import.meta.url),'utf8'));
  if(audit.packageFingerprint!==fingerprint||audit.termsIdentity!==terms||sha(JSON.stringify(audit.termsFiles))!==terms
    ||audit.publicApproved!==false||audit.noticesVerified!==false||recipe.fingerprint!==fingerprint
    ||sha(recipeBytes)!=='a1a8dca181f17f960657f6d606510287ea8199368c9c1294ae4f2cebf5862c9f'
    ||JSON.stringify(audit.allPayloadFiles)!==JSON.stringify(pinned.files)||JSON.stringify(recipe.files)!==JSON.stringify(pinned.files))throw Error('delivery-audit-changed');
  const bundledFiles=audit.termsFiles.map(file=>{
    const prefix='scripts/local-generation/notices/qwen-research-v1/';
    if(!file.path.startsWith(prefix)||file.path.slice(prefix.length).includes('/'))throw Error('delivery-audit-changed');
    const bytes=readFileSync(new URL('../notices/qwen-research-v1/'+file.path.slice(prefix.length),import.meta.url));
    if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('delivery-notice-changed');
    return {path:'notices/'+file.path.slice(prefix.length),role:'notice',bytes:bytes.length,sha256:sha(bytes),dataBase64:bytes.toString('base64')};
  });
  bundledFiles.push({path:'evidence/package-manifest.json',role:'recipe-metadata',bytes:recipeBytes.length,sha256:sha(recipeBytes),dataBase64:recipeBytes.toString('base64')});
  const roles=['engine','image-weights','text-encoder','vae'];
  const revisions=[recipe.engine_commit,recipe.model_revision,recipe.encoder_revision,recipe.vae_revision];
  const sources=[
    'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-929-3f8527a/sd-master-3f8527a-bin-win-vulkan-x64.zip',
    `https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF/resolve/${recipe.model_revision}/qwen_image_2.1_Q4_K_M.gguf`,
    `https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/${recipe.encoder_revision}/Qwen3VL-8B-Instruct-Q4_K_M.gguf`,
    `https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/${recipe.vae_revision}/vae/qwen_image_2.1_vae_bf16.safetensors`,
  ];
  const artifacts=audit.components.map((component,index)=>{
    const expected=pinned.files.find(file=>file.path===component.path);
    if(!expected||expected.bytes!==component.bytes||expected.sha256!==component.sha256||component.url!==sources[index])throw Error('delivery-audit-changed');
    return {id:roles[index],role:roles[index],revision:revisions[index],url:sources[index],
      hosts:index===0?['github.com','release-assets.githubusercontent.com']:['huggingface.co','us.aws.cdn.hf.co'],
      bytes:expected.bytes,sha256:expected.sha256,
      ...(index===0?{archive:'zip',retainAs:expected.path,entries:pinned.files.filter(file=>file.path.startsWith('engine/')).map(file=>({member:file.path.slice(7),...file}))}:{destination:expected.path})};
  });
  if(artifacts.length!==4)throw Error('delivery-audit-changed');
  const manifest={schema:1,id:'qwen-2-1-research-delivery-v1',publicApproved:false,noticesVerified:false,
    termsDigest:terms,purpose:'research-evaluation-only',profile:fingerprint,artifacts,bundledFiles};
  validateManifest(manifest,'internal-evaluation');return manifest;
}
export function qwenQ3Delivery(){
  const manifest=qwenResearchDelivery(),profile=nativeProfile(Q3_FINGERPRINT),recipe=profile.recipe;
  const weights=recipe.files.find(file=>file.path===profile.diffusion);
  manifest.id='qwen-2-1-q3-research-delivery-v1';manifest.profile=Q3_FINGERPRINT;
  manifest.artifacts=manifest.artifacts.map(file=>file.role==='image-weights'?{...file,bytes:weights.bytes,sha256:weights.sha256,destination:weights.path,
    url:`https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF/resolve/${recipe.model_revision}/qwen_image_2.1_Q3_K_M.gguf`}:file);
  const bytes=readFileSync(new URL('./qwen-q3-recipe.json',import.meta.url));
  manifest.bundledFiles=manifest.bundledFiles.map(file=>file.role==='recipe-metadata'?{...file,...profile.metadata,dataBase64:bytes.toString('base64')}:file);
  validateManifest(manifest,'internal-evaluation');return manifest;
}
