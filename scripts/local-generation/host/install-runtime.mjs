import { readFileSync } from 'node:fs';
import { PackageInstaller } from '../install/transaction.mjs';
import { HOST_RUNTIME } from './runtime.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const installer=new PackageInstaller({root:config.root,instanceId:config.instanceId,catalog:[HOST_RUNTIME]});
try {
  await installer.recover();
  const op=installer.admit({owner:config.instanceId,key:config.runtimeKey,packageId:HOST_RUNTIME.id});
  const result=await installer.run(config.instanceId,op.id);
  if(result.state!=='installed')throw Error('host-runtime-not-installed');
  console.log(JSON.stringify({installed:true}));
}finally{installer.close();}
