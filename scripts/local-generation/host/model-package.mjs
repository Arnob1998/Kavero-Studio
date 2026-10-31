import { readFileSync,constants,copyFileSync,lstatSync,realpathSync } from 'node:fs';
import path from 'node:path';
import { FINGERPRINT } from '../profile.mjs';
import { sha,canonical } from '../install/manifest.mjs';
import { InstallFiles } from '../install/filesystem.mjs';
import { PackageInstaller } from '../install/transaction.mjs';
import { qwenResearchDelivery } from '../install/qwen-delivery.mjs';
import { validateManifest } from '../install/manifest.mjs';
export const EVALUATION_PACKAGE='qwen-2-1-internal-evaluation';
const pinned=JSON.parse(readFileSync(new URL('../profile.json',import.meta.url),'utf8'));
const entries=[...pinned.files,{path:'evidence/package-manifest.json',bytes:5009,sha256:'a1a8dca181f17f960657f6d606510287ea8199368c9c1294ae4f2cebf5862c9f'}];
export const MODEL_RECEIPT={schema:1,packageId:EVALUATION_PACKAGE,purpose:'internal-evaluation',publicApproved:false,profile:FINGERPRINT,files:entries};
export const MODEL_RECEIPT_HASH=sha(canonical(MODEL_RECEIPT));
export const MODEL_VERSION=`model-versions/${MODEL_RECEIPT_HASH}`;
export function readOnlyPackageSource(root){
  const absolute=path.resolve(root),actual=realpathSync(absolute);if(actual.toLowerCase()!==absolute.toLowerCase())throw Error('unsafe-install-link');
  const info=lstatSync(actual);if(!info.isDirectory()||info.isSymbolicLink())throw Error('unsafe-install-link');
  const guard=Object.create(InstallFiles.prototype);Object.assign(guard,{root:actual,device:info.dev,inode:info.ino});guard.check();
  return Object.freeze({matches:(relative,entry)=>guard.matches(relative,entry),resolve:relative=>guard.resolve(relative)});
}
export async function verifyModel(files,{check=()=>{}}={}) {
  const manifest=qwenResearchDelivery(),verified=validateManifest(manifest,'internal-evaluation');
  if(files.exists('delivery')){
    const installer=new PackageInstaller({root:files.resolve('delivery',{directory:true}),instanceId:files.instanceId,catalog:[manifest],purpose:'internal-evaluation'});
    try{const version=`versions/${verified.hash}`;
      if(installer.files.exists(version)){check();if(!await installer.verifyVersion(version,verified))throw Error('model-receipt-changed');check();
        return {packageId:EVALUATION_PACKAGE,receipt:MODEL_RECEIPT_HASH,profile:FINGERPRINT,deliveryManifest:verified.hash,packageRoot:installer.files.resolve(version,{directory:true})};}
    }finally{installer.close();}
  }
  const receipt=files.read(`${MODEL_VERSION}/.receipt.json`,32768).toString();
  if(canonical(JSON.parse(receipt))!==canonical(MODEL_RECEIPT))throw Error('model-receipt-changed');
  const actual=files.listTree(MODEL_VERSION);
  if(actual.length!==entries.length+1||actual.some(name=>name!=='.receipt.json'&&!entries.some(entry=>entry.path===name)))throw Error('model-package-changed');
  for(const entry of entries){check();if(!await files.matches(`${MODEL_VERSION}/${entry.path}`,entry))throw Error('model-package-changed');}
  check();return {packageId:EVALUATION_PACKAGE,receipt:MODEL_RECEIPT_HASH,profile:FINGERPRINT,packageRoot:files.resolve(MODEL_VERSION,{directory:true})};
}
// Internal proof import only: not a user setup path or a public download/import
// API. Caller holds the host mutex. Destination is a fresh immutable version;
// trusted pinned hashes, not source names/metadata, authorize every byte.
export async function importEvaluationModel(files,sourceFiles,{check=()=>{}}={}) {
  if(files.exists(MODEL_VERSION))return verifyModel(files,{check});
  const total=entries.reduce((n,file)=>n+file.bytes,0);if(files.freeBytes()<total+1024**3)throw Error('install-disk-full');
  const stage=`staging/model-${MODEL_RECEIPT_HASH}`;files.directory(stage);
  for(const entry of entries){check();if(!await sourceFiles.matches(entry.path,entry))throw Error('model-source-changed');const target=`${stage}/${entry.path}`;
    if(!await files.matches(target,entry)){if(files.exists(target))files.remove(target);files.directory(path.posix.dirname(target));copyFileSync(sourceFiles.resolve(entry.path),files.resolve(target),constants.COPYFILE_EXCL);}
    if(!await files.matches(target,entry))throw Error('model-package-changed');
  }
  const expected=new Set(entries.map(file=>file.path));for(const name of files.listTree(stage)){if(/^\.receipt\.json\.[a-f0-9-]{36}\.tmp$/.test(name))files.remove(`${stage}/${name}`);else if(name!=='.receipt.json'&&!expected.has(name))throw Error('model-package-changed');}
  files.atomicJSON(`${stage}/.receipt.json`,MODEL_RECEIPT);
  check();files.directory('model-versions');files.rename(stage,MODEL_VERSION);files.syncParent(MODEL_VERSION);return verifyModel(files,{check});
}
