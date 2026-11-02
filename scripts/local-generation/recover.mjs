import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync,lstatSync,realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Ledger } from './ledger.mjs';

export function assertNoOwnedProcess(row,processes) {
  for(const process of processes){
    const command=process.CommandLine;
    if(!command)throw Error('process-inventory-incomplete');
    if(Number(process.ProcessId)===row.pid && String(process.CreationTicks)===row.process_creation_identity)
      throw Error('supervisor-still-alive');
    if(command.includes(row.id) && (process.Name==='sd-cli.exe' || command.includes(row.claim)))
      throw Error('owned-process-still-alive');
  }
}
async function processInventory() {
  if(process.platform!=='win32')throw Error('recovery-host-not-verified');
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'sd-cli.exe'\" | Select-Object Name,ProcessId,CommandLine,@{Name='CreationTicks';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  const rows=stdout.trim()?JSON.parse(stdout):[];
  return Array.isArray(rows)?rows:[rows];
}
export async function recoverAbandonedJob(configPath,id,inventory=processInventory) {
  if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('invalid-job-id');
  const config=JSON.parse(readFileSync(configPath,'utf8')),ledger=new Ledger(path.join(config.stateRoot,'ledger.sqlite'));
  try{
    const row=ledger.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if(!row||row.state!=='submission-unknown'||!row.claim||Date.now()-row.heartbeat<30000)throw Error('job-not-abandoned');
    assertNoOwnedProcess(row,await inventory());
    await new Promise(resolve=>setTimeout(resolve,1000));
    assertNoOwnedProcess(row,await inventory());
    const current=ledger.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if(current.state!==row.state||current.claim!==row.claim||current.heartbeat!==row.heartbeat)throw Error('job-recovered-concurrently');
    const output=path.join(config.stateRoot,'jobs',id,'final.png');
    let candidate=false;
    try{
      const stat=lstatSync(output);
      if(realpathSync(output)!==path.join(realpathSync(config.stateRoot),'jobs',id,'final.png'))throw Error('unsafe-staged-output');
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size>32*1024*1024)throw Error('unsafe-staged-output');
      candidate=stat.size>0&&stat.birthtimeMs>=row.created;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    // This is explicit private operator recovery, never a timeout retry. Output
    // stays unvalidated/private; LG-2B must validate it before any exposure.
    ledger.finish(id,row.claim,candidate?'generated-unvalidated':'failed',null);
    return {id,state:ledger.db.prepare('SELECT state FROM jobs WHERE id=?').get(id).state};
  }finally{ledger.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await recoverAbandonedJob(path.resolve(process.argv[2]),process.argv[3]);
  console.log(JSON.stringify(result));
}
