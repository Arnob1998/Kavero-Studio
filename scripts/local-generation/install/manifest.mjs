import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])])) : value; }
export function relativePath(value) {
  if(typeof value!=='string'||value.length>180||!value||value.includes('\\')||!/^[-a-zA-Z0-9_./]+$/.test(value))throw Error('unsafe-install-path');
  for(const part of value.split('/')) if(!part||part==='.'||part==='..'||part.endsWith('.')||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))throw Error('unsafe-install-path');
  return value;
}
const digest = value => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bytes = value => Number.isSafeInteger(value)&&value>0&&value<=32*1024**3;
const id = value => typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
export function allowedURL(value,hosts) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||isIP(url.hostname)||!hosts.includes(url.hostname)
    ||!hosts.every(host=>/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)&&!host.endsWith('.local')&&!host.endsWith('.localhost')))throw Error('install-source-rejected');
  return url;
}
export function validateManifest(input,purpose='public') {
  const manifest=structuredClone(input);
  if(!manifest||manifest.schema!==1||!id(manifest.id)||!Array.isArray(manifest.artifacts)||!manifest.artifacts.length||manifest.artifacts.length>32
    ||!['internal-evaluation','user-selected','public'].includes(purpose)||!digest(manifest.termsDigest))throw Error('invalid-install-manifest');
  if(purpose==='public'&&(manifest.publicApproved!==true||manifest.noticesVerified!==true))throw Error('package-not-approved');
  const outputs=new Map();let total=0;
  for(const artifact of manifest.artifacts) {
    if(!id(artifact.id)||!digest(artifact.sha256)||!bytes(artifact.bytes)||!Array.isArray(artifact.hosts)||!artifact.hosts.length||artifact.hosts.length>5
      ||!['image-weights','text-encoder','vae','engine','runtime','notice','test-fixture'].includes(artifact.role)
      ||!(/^[a-f0-9]{40}$/.test(artifact.revision)||/^v\d+\.\d+\.\d+$/.test(artifact.revision)))throw Error('invalid-install-manifest');
    allowedURL(artifact.url,artifact.hosts);total+=artifact.bytes;
    if(artifact.archive) {
      if(artifact.archive!=='zip'||artifact.bytes>64*1024**2||!Array.isArray(artifact.entries)||!artifact.entries.length||artifact.entries.length>512)throw Error('invalid-install-archive');
      let expanded=0;const members=new Set();
      for(const file of artifact.entries) { relativePath(file.member); if(members.has(file.member.toLowerCase()))throw Error('duplicate-archive-member');members.add(file.member.toLowerCase());validateFile(file);expanded+=file.bytes;add(file); }
      if(expanded>512*1024**2)throw Error('archive-expansion-limit');total+=expanded;
      if(artifact.retainAs!==undefined){validateFile({...artifact,path:artifact.retainAs});add({path:artifact.retainAs,bytes:artifact.bytes,sha256:artifact.sha256});total+=artifact.bytes;}
    }else { if(artifact.retainAs!==undefined)throw Error('invalid-install-archive');validateFile({...artifact,path:artifact.destination});add({path:artifact.destination,bytes:artifact.bytes,sha256:artifact.sha256});total+=artifact.bytes; }
  }
  if(manifest.bundledFiles!==undefined){
    if(!Array.isArray(manifest.bundledFiles)||manifest.bundledFiles.length>64)throw Error('invalid-bundled-files');
    let bundledBytes=0;
    for(const file of manifest.bundledFiles){
      validateFile(file);
      if(!['notice','recipe-metadata'].includes(file.role)||file.bytes>256*1024||typeof file.dataBase64!=='string'||file.dataBase64.length>349528)throw Error('invalid-bundled-files');
      bundledBytes+=file.bytes;if(bundledBytes>1024*1024)throw Error('bundled-size-limit');
      const data=Buffer.from(file.dataBase64,'base64');
      if(data.toString('base64')!==file.dataBase64||data.length!==file.bytes||sha(data)!==file.sha256)throw Error('invalid-bundled-files');
      try{if(new TextDecoder('utf-8',{fatal:true}).decode(data).includes('\0'))throw Error();}catch{throw Error('invalid-bundled-text');}
      add(file);
    }
    if(bundledBytes>1024*1024)throw Error('bundled-size-limit');total+=bundledBytes;
  }
  if(total>64*1024**3||new Set(manifest.artifacts.map(a=>a.id)).size!==manifest.artifacts.length)throw Error('invalid-install-manifest');
  const files=[...outputs.values()];
  for(const file of files)if(file.path==='.receipt.json'||files.some(other=>other!==file&&other.path.toLowerCase().startsWith(file.path.toLowerCase()+'/')))throw Error('install-path-collision');
  const hash=sha(canonical(manifest));
  // Only the reviewed direct-upstream research recipe may bypass redistribution
  // approval. This is host-owned policy, never a purpose supplied by a browser.
  if(purpose==='user-selected'&&(manifest.purpose!=='research-evaluation-only'||!['35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822','d730d6d53b7c7fb0c39d5fce0a60c93ae1b00113db3ec4009854463e0c5c29bb'].includes(hash)))throw Error('user-selected-package-rejected');
  return {manifest,hash,files,totalBytes:total};
  function validateFile(file) {relativePath(file.path);if(!bytes(file.bytes)||!digest(file.sha256))throw Error('invalid-install-manifest');}
  function add(file) {const key=file.path.toLowerCase();if(outputs.has(key)||key==='.receipt.json')throw Error('install-path-collision');outputs.set(key,{path:file.path,bytes:file.bytes,sha256:file.sha256});}
}
