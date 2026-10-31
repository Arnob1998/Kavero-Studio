import { mkdirSync,existsSync,readdirSync,lstatSync,realpathSync,openSync,closeSync,readFileSync,writeFileSync,fsyncSync,fstatSync,constants,renameSync,unlinkSync,statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { relativePath } from './manifest.mjs';
export function protectRoot(root) {
  if(process.platform==='win32') {
    const account=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
    execFileSync('icacls',[root,'/inheritance:r','/grant:r',`${account}:(OI)(CI)F`],{stdio:'ignore',windowsHide:true});
  }
}
export class InstallFiles {
  constructor(root,instanceId,{protect=protectRoot}={}) {
    if(!/^[a-f0-9-]{36}$/i.test(instanceId))throw Error('invalid-install-instance');
    const absolute=path.resolve(root);assertAncestors(absolute);
    if(!existsSync(absolute))mkdirSync(absolute,{recursive:true,mode:0o700});
    this.root=realpathSync(absolute);this.device=lstatSync(this.root).dev;this.inode=lstatSync(this.root).ino;
    if(!existsSync(path.join(this.root,'.instance.json'))) {
      if(readdirSync(this.root).length)throw Error('install-root-not-owned');protect(this.root);
      this.write('.instance.json',Buffer.from(JSON.stringify({schema:1,instanceId})),true);
    }
    const identity=JSON.parse(this.read('.instance.json',1024));if(identity.schema!==1||identity.instanceId!==instanceId)throw Error('install-instance-mismatch');
    this.instanceId=instanceId;
    for(const name of ['cache','parts','staging','versions'])this.directory(name);
  }
  check() {
    assertAncestors(this.root);const info=lstatSync(this.root);
    if(info.dev!==this.device||info.ino!==this.inode)throw Error('install-root-changed');
  }
  resolve(relative,{directory=false}={}) {
    this.check();relativePath(relative);let current=this.root;
    for(const [index,part] of relative.split('/').entries()) {
      current=path.join(current,part);
      if(!existsSync(current)) { try {lstatSync(current);throw Error('unsafe-install-link');}catch(e){if(e.code!=='ENOENT')throw e;} continue; }
      const info=lstatSync(current);if(info.isSymbolicLink()||info.dev!==this.device||(info.isFile()&&info.nlink!==1))throw Error('unsafe-install-link');
      if(index<relative.split('/').length-1||directory) {if(!info.isDirectory())throw Error('unsafe-install-parent');}
      else if(!info.isFile()&&!info.isDirectory())throw Error('unsafe-install-file');
      if(path.resolve(realpathSync(current)).toLowerCase()!==path.resolve(current).toLowerCase())throw Error('unsafe-install-link');
    }
    return current;
  }
  directory(relative) {const filename=this.resolve(relative,{directory:true});mkdirSync(filename,{recursive:true,mode:0o700});this.resolve(relative,{directory:true});return filename;}
  open(relative,flags) {
    const filename=this.resolve(relative),fd=openSync(filename,flags|constants.O_NOFOLLOW,0o600),info=fstatSync(fd);
    try {this.resolve(relative);if(!info.isFile()||info.nlink!==1||info.dev!==this.device||lstatSync(filename).ino!==info.ino)throw Error('unsafe-install-file');return fd;}catch(e){closeSync(fd);throw e;}
  }
  read(relative,max=16384) {const fd=this.open(relative,constants.O_RDONLY);try{if(fstatSync(fd).size>max)throw Error('install-file-too-large');return readFileSync(fd);}finally{closeSync(fd);}}
  write(relative,data,exclusive=false) {
    const parent=path.posix.dirname(relative);if(parent!=='.')this.directory(parent);
    const fd=this.open(relative,constants.O_WRONLY|constants.O_CREAT|(exclusive?constants.O_EXCL:constants.O_TRUNC));try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}
  }
  atomicJSON(relative,data) {
    const temp=`${relative}.${randomUUID()}.tmp`;this.write(temp,Buffer.from(JSON.stringify(data)),true);this.rename(temp,relative);this.syncParent(relative);
  }
  rename(from,to) {const source=this.resolve(from),target=this.resolve(to);renameSync(source,target);this.resolve(to);}
  remove(relative) {const filename=this.resolve(relative);if(existsSync(filename)){if(!lstatSync(filename).isFile())throw Error('unsafe-install-delete');unlinkSync(filename);}}
  exists(relative) {return existsSync(this.resolve(relative));}
  listTree(relative,max=2048) {
    const result=[];let count=0;
    const visit=(prefix,depth)=>{if(depth>32)throw Error('install-tree-limit');for(const name of readdirSync(this.resolve(prefix,{directory:true}))){if(++count>max)throw Error('install-tree-limit');const child=`${prefix}/${name}`,info=lstatSync(this.resolve(child));if(info.isDirectory())visit(child,depth+1);else result.push(child.slice(relative.length+1));}};
    visit(relative,0);return result;
  }
  size(relative) {return lstatSync(this.resolve(relative)).size;}
  freeBytes() {this.check();const info=statfsSync(this.root);return Number(info.bavail)*Number(info.bsize);}
  syncParent(relative) {if(process.platform==='win32')return;const fd=openSync(path.dirname(this.resolve(relative)),constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
  async matches(relative,file) {
    if(!this.exists(relative))return false;
    const fd=this.open(relative,constants.O_RDONLY);try {
      if(fstatSync(fd).size!==file.bytes)return false;
      const hash=createHash('sha256');for await(const chunk of createReadStream('',{fd,autoClose:false}))hash.update(chunk);
      this.resolve(relative);return hash.digest('hex')===file.sha256;
    }finally{closeSync(fd);}
  }
}
function assertAncestors(absolute) {
  let current=absolute;
  while(true){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('unsafe-install-link');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
