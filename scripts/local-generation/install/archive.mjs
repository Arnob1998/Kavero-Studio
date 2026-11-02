import { inflateRawSync } from 'node:zlib';
import { relativePath,sha } from './manifest.mjs';
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
export function inspectZIP(bytes,expected) {
  if(bytes.length>64*1024**2||bytes.length<22)throw Error('install-archive-invalid');
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10))throw Error('install-archive-invalid');
  const count=bytes.readUInt16LE(end+10),length=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  if(count>1024||start+length!==end)throw Error('install-archive-invalid');
  let cursor=start;const seen=new Set(),found=new Set(),entries=[],ranges=[];
  for(let i=0;i<count;i++) {
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)throw Error('install-archive-invalid');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),checksum=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),attributes=bytes.readUInt32LE(cursor+38),local=bytes.readUInt32LE(cursor+42);
    if(cursor+46+nameLength+extra+comment>end||bytes.readUInt16LE(cursor+34)||flags&1||![0,8].includes(method)||expanded===0xffffffff||compressed===0xffffffff||local===0xffffffff)throw Error('install-archive-invalid');
    const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8'),directory=name.endsWith('/'),clean=directory?name.slice(0,-1):name;
    relativePath(clean);if(seen.has(clean.toLowerCase()))throw Error('install-archive-collision');seen.add(clean.toLowerCase());
    const type=(attributes>>>16)&0xf000;
    if(type&&type!==(directory?0x4000:0x8000)||attributes&0x400)throw Error('install-archive-link');
    const file=expected.find(entry=>entry.member===name);
    if(directory) {if(expanded||!expected.some(entry=>entry.member.startsWith(name)))throw Error('install-archive-unexpected');}
    else if(!file||expanded!==file.bytes)throw Error('install-archive-unexpected');
    if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method)throw Error('install-archive-invalid');
    const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),body=local+30+localNameLength+localExtra;
    if(body+compressed>start||bytes.subarray(local+30,local+30+localNameLength).toString('utf8')!==name||ranges.some(([a,b])=>local<b&&body+compressed>a))throw Error('install-archive-invalid');
    if(!(flags&8)&&(bytes.readUInt32LE(local+14)!==checksum||bytes.readUInt32LE(local+18)!==compressed||bytes.readUInt32LE(local+22)!==expanded))throw Error('install-archive-invalid');
    ranges.push([local,body+compressed]);
    if(file){found.add(name);entries.push({file,method,checksum,compressed:bytes.subarray(body,body+compressed)});}
    cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end||found.size!==expected.length)throw Error('install-archive-missing');return entries;
}
export async function extractZIP(files,archiveRelative,artifact,stage,{check=()=>{}}={}) {
  const entries=inspectZIP(files.read(archiveRelative,64*1024**2),artifact.entries);
  for(const {file,method,checksum,compressed} of entries) {
    await new Promise(resolve=>setImmediate(resolve));
    check();const target=`${stage}/${file.path}`;
    if(await files.matches(target,file))continue;
    if(files.exists(target))files.remove(target);
    const bytes=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:file.bytes});
    if(bytes.length!==file.bytes||crc(bytes)!==checksum||sha(bytes)!==file.sha256)throw Error('install-extracted-checksum');
    check();files.write(target,bytes,true);
  }
}
