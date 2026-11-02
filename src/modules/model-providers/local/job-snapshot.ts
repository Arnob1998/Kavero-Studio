// Dependency-free shared admission contract for app and native Node worker.
import {createHash} from 'node:crypto';
import recipe from '../../../../scripts/local-generation/install/qwen-recipe.json' with {type:'json'};
import q3Recipe from '../../../../scripts/local-generation/install/qwen-q3-recipe.json' with {type:'json'};
export type LocalRecipeSnapshot={
 schemaVersion:1;recipeId:string;recipeVersion:number;profile:string;label:string;
 source:{repo:string;revision:string;file:string};runtime:{adapter:string;revision:string;backend:string};
 manifestHash:string;packageFingerprint:string;
 settings:{width:number;height:number;count:number;steps:number;cfg:number;seed:number;sampler:string};
};
export const canonicalSnapshot=(value:unknown):string=>JSON.stringify(sort(value));
function sort(value:unknown):unknown{return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,entry])=>[key,sort(entry)])):value;}
export function existingJobSnapshot():LocalRecipeSnapshot{
 return {schemaVersion:1,recipeId:'qwen-image-2-1',recipeVersion:1,profile:'qwen-image-2.1-q4-evaluation',label:'Qwen Image 2.1 Q4 (local evaluation)',
 source:{repo:'https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF',revision:recipe.model_revision,file:'qwen_image_2.1_Q4_K_M.gguf'},
 runtime:{adapter:'stable-diffusion-cpp',revision:recipe.engine_commit,backend:'vulkan'},manifestHash:'35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822',packageFingerprint:recipe.fingerprint,
 settings:{width:recipe.recipe.width,height:recipe.recipe.height,count:recipe.recipe.count,steps:recipe.recipe.steps,cfg:recipe.recipe.cfg,seed:recipe.recipe.seed,sampler:'euler'}};
}
export function validateJobSnapshot(value:unknown):LocalRecipeSnapshot{
 // Registry admission, never an arbitrary card/config-derived runtime grant.
 if(!value||![existingJobSnapshot(),q3JobSnapshot()].some(snapshot=>canonicalSnapshot(value)===canonicalSnapshot(snapshot)))throw Error('unsupported-job-recipe');
 return JSON.parse(JSON.stringify(value)) as LocalRecipeSnapshot;
}
export function q3JobSnapshot():LocalRecipeSnapshot{
 return {...existingJobSnapshot(),recipeId:'qwen-image-2-1-q3',profile:'qwen-image-2.1-q3-evaluation',label:'Qwen Image 2.1 Q3 (local evaluation)',
  source:{repo:'https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF',revision:q3Recipe.model_revision,file:'qwen_image_2.1_Q3_K_M.gguf'},
  manifestHash:'d730d6d53b7c7fb0c39d5fce0a60c93ae1b00113db3ec4009854463e0c5c29bb',packageFingerprint:q3Recipe.fingerprint};
}
export function jobSnapshotForProfile(profile:string){
 const found=[existingJobSnapshot(),q3JobSnapshot()].find(snapshot=>snapshot.profile===profile);if(!found)throw Error('unsupported-job-recipe');return found;
}
type Intent={profile:string;prompt:string;width:number;height:number;count:number};
export function validateSnapshotIntent(intent:Intent,value:unknown,packageFingerprint:string){
 const snapshot=validateJobSnapshot(value);
 if(snapshot.packageFingerprint!==packageFingerprint||snapshot.profile!==intent.profile||snapshot.settings.width!==intent.width||snapshot.settings.height!==intent.height||snapshot.settings.count!==intent.count)throw Error('job-recipe-identity-mismatch');
 return snapshot;
}
export function jobRequestHash(intent:Intent,snapshot?:LocalRecipeSnapshot|null){
 const legacy={profile:intent.profile,prompt:intent.prompt,width:intent.width,height:intent.height,count:intent.count};
 return createHash('sha256').update(snapshot?canonicalSnapshot({schemaVersion:2,intent:legacy,recipeSnapshot:validateJobSnapshot(snapshot)}):JSON.stringify(legacy)).digest('hex');
}
export function jobSnapshotForRecord(job:{intent:Intent;package_fingerprint:string;recipe_snapshot?:LocalRecipeSnapshot|null}){
 if(job.recipe_snapshot)return validateSnapshotIntent(job.intent,job.recipe_snapshot,job.package_fingerprint);
 // Legacy decoding preserves original hash/record; never backfill/remap it.
 return validateSnapshotIntent(job.intent,existingJobSnapshot(),job.package_fingerprint);
}
