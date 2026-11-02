import {openSync,closeSync,readSync,fstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Inspect format/tensor layout only. Trusted whole-file hashes authorize bytes;
// a plausible GGUF header alone never grants model/runtime compatibility.
export function inspectGGUF(filename){
 const fd=openSync(filename,'r');let bytes,size;
 try{size=fstatSync(fd).size;bytes=Buffer.alloc(Math.min(size,4*1024**2));let read=0;
  while(read<bytes.length){const n=readSync(fd,bytes,read,bytes.length-read,read);if(!n)throw Error('invalid-gguf');read+=n;}
 }finally{closeSync(fd);}
 let cursor=0;
 const take=n=>{if(!Number.isSafeInteger(n)||n<0||cursor+n>bytes.length)throw Error('gguf-header-limit');const start=cursor;cursor+=n;return start;};
 const u32=()=>bytes.readUInt32LE(take(4));
 const u64=()=>{const n=bytes.readBigUInt64LE(take(8));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('gguf-header-limit');return Number(n);};
 const str=(limit=16384)=>{const n=u64();if(n>limit)throw Error('gguf-header-limit');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor,take(n)+n));};
 if(bytes.subarray(take(4),4).toString()!=='GGUF'||u32()!==3)throw Error('invalid-gguf');
 const count=u64(),entries=u64();if(!count||count>8192||entries>1024)throw Error('gguf-header-limit');
 function value(type,depth=0){
  if(depth>3)throw Error('gguf-header-limit');
  if(type===8)return str();
  if(type===9){const element=u32(),length=u64();if(length>8192)throw Error('gguf-header-limit');for(let i=0;i<length;i++)value(element,depth+1);return null;}
  const width=[1,1,2,2,4,4,4,1,0,0,8,8,8][type];if(!width)throw Error('invalid-gguf');take(width);return null;
 }
 const metadata=new Map();
 for(let i=0;i<entries;i++){const key=str(256);if(metadata.has(key))throw Error('invalid-gguf');metadata.set(key,value(u32()));}
 const tensors=[],names=new Set();
 for(let i=0;i<count;i++){
  const name=str(256),dimensions=u32();if(names.has(name)||!name||!dimensions||dimensions>4)throw Error('invalid-gguf');names.add(name);
  const shape=Array.from({length:dimensions},()=>u64());if(shape.some(n=>n<1||n>1000000))throw Error('invalid-gguf');
  const type=u32(),offset=u64();if(type>64||offset>=size)throw Error('invalid-gguf');tensors.push({name,shape});
 }
 tensors.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 return {version:3,tensorCount:count,architecture:metadata.get('general.architecture')??null,headerBytes:cursor,
  tensorLayoutSha256:createHash('sha256').update(JSON.stringify(tensors)).digest('hex')};
}
