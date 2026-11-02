import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
if(process.argv.length!==4)throw Error('Provide package and private state directories');
const [packageRoot,stateRoot]=process.argv.slice(2).map(value=>path.resolve(value));
mkdirSync(stateRoot,{recursive:true});
const filename=path.join(stateRoot,'worker-config.json');
if(existsSync(filename))throw Error('Config already exists; do not rotate a secret under active jobs');
if(process.platform==='win32') {
  const account=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync('icacls',[stateRoot,'/inheritance:r','/grant:r',`${account}:(OI)(CI)F`],{stdio:'ignore',windowsHide:true});
}
writeFileSync(filename,JSON.stringify({packageRoot,stateRoot,port:8791,secret:randomBytes(32).toString('hex')},null,2),{mode:0o600,flag:'wx'});
console.log('Private worker config created. Never send its secret to the browser.');
