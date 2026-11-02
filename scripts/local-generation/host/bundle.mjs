import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha,canonical } from '../install/manifest.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const WORKER_SOURCES=[
  'scripts/local-generation/host/setup-hub.mjs',
  'scripts/local-generation/profiles.mjs','scripts/local-generation/gguf.mjs','scripts/local-generation/install/qwen-q3-recipe.json',
  'src/modules/model-providers/local/job-snapshot.ts',
  'scripts/local-generation/host/imports.mjs','scripts/local-generation/model-imports.mjs','scripts/local-generation/model-discovery.mjs','scripts/local-generation/model-catalog.mjs','scripts/local-generation/models.json','src/modules/model-providers/local/model-contract.ts',
  'scripts/local-generation/host/selection.mjs','scripts/local-generation/host/agent.mjs','scripts/local-generation/host/activation.mjs','scripts/local-generation/host/model-package.mjs',
  'scripts/local-generation/worker.mjs','scripts/local-generation/ledger.mjs','scripts/local-generation/profile.mjs','scripts/local-generation/profile.json','scripts/local-generation/hardware.mjs',
  'scripts/local-generation/staging.mjs','scripts/local-generation/protocol.mjs',
  'scripts/local-generation/install/filesystem.mjs','scripts/local-generation/install/manifest.mjs',
  'src/modules/model-providers/local/png.ts','src/modules/model-providers/local/failure.ts',
  'scripts/local-generation/host/setup.mjs','scripts/local-generation/install/transaction.mjs','scripts/local-generation/install/store.mjs','scripts/local-generation/install/download.mjs','scripts/local-generation/install/archive.mjs',
  'scripts/local-generation/install/qwen-delivery.mjs','scripts/local-generation/install/qwen-research-audit.json','scripts/local-generation/install/qwen-recipe.json',
];
const audit=JSON.parse(readFileSync(path.join(project,'scripts/local-generation/install/qwen-research-audit.json'),'utf8'));
WORKER_SOURCES.push(...audit.termsFiles.map(file=>file.path));
// Preserve the source import graph, including native Node TypeScript stripping;
// the private worker has no dependency on a checkout or node_modules at runtime.
export function packageWorker(files) {
  const sources=WORKER_SOURCES.map(name=>({name,bytes:readFileSync(path.join(project,name))}));
  const entries=sources.map(({name,bytes})=>({path:name,bytes:bytes.length,sha256:sha(bytes)}));
  const fingerprint=sha(canonical(entries)),root=`code/${fingerprint}`;files.directory(root);
  for(const {name,bytes} of sources){const target=`${root}/${name}`;if(files.exists(target)){if(sha(files.read(target,256*1024))!==sha(bytes))throw Error('host-code-changed');}else files.write(target,bytes,true);}
  const receipt={schema:1,fingerprint,files:entries};
  if(files.exists(`${root}/.bundle.json`)){if(files.read(`${root}/.bundle.json`,32768).toString()!==canonical(receipt))throw Error('host-code-changed');}
  else files.write(`${root}/.bundle.json`,Buffer.from(canonical(receipt)),true);
  const actual=files.listTree(root);if(actual.length!==entries.length+1||actual.some(name=>name!=='.bundle.json'&&!entries.some(file=>file.path===name)))throw Error('host-code-changed');
  return {fingerprint,entry:files.resolve(`${root}/scripts/local-generation/host/agent.mjs`)};
}
