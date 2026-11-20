#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { digest,connectOrigin } from '../../../src/modules/model-providers/local/connect/protocol.ts';
import { CredentialStore } from './credentials.mjs';
import { ConnectClient } from './client.mjs';
import { acquireHostMutex } from '../host/mutex.mjs';

// KC-1 private development companion: no inference, arbitrary URL or shell RPC.
async function main() {
  if(process.platform!=='win32'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])<24)throw Error('connect-requires-windows-x64-node24');
  const command=process.argv[2];
  if(!['pair','status','rotate','unpair','reset'].includes(command))throw Error('usage: node scripts/local-generation/connect/cli.mjs pair|status|rotate|unpair|reset');
  const origin=connectOrigin(process.env.KAVERO_CONNECT_ORIGIN??'',process.env.KAVERO_CONNECT_ALLOW_LOOPBACK==='1'&&process.env.NODE_ENV!=='production');
  if(!process.env.APPDATA)throw Error('connect-appdata-unavailable');
  const root=path.join(process.env.APPDATA,'Kavero','Connect',digest(origin));mkdirSync(root,{recursive:true});
  const lock=await acquireHostMutex(root);
  try{
    const client=new ConnectClient({origin,allowLoopback:process.env.KAVERO_CONNECT_ALLOW_LOOPBACK==='1'&&process.env.NODE_ENV!=='production',store:new CredentialStore(path.join(root,'identity.dpapi'))});
    const io=createInterface({input:stdin,output:stdout});
    try {
      console.log(`Kavero Connect development foundation — ${origin}`);
      if(command==='pair') {
        const code=(await io.question('Pairing code from your signed-in Kavero website: ')).trim().replaceAll('-','');
        const result=await client.pair(code);console.log(JSON.stringify(result,null,2));
        console.log('Confirm this installation and fingerprint in the same signed-in account, then run status. Remote generation is disabled.');
      }else if(command==='reset'){
        if(await io.question('Revoke the old computer in Kavero first. Type RESET to forget its local binding: ')==='RESET')await client.forgetRevoked();
      }else{
        let report={platform:'win32',arch:'x64',node:process.versions.node,ramMiB:0,gpus:[]};
        if(command!=='unpair') {
          const script=`$ErrorActionPreference='Stop'; @{ramMiB=[math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1MB);gpus=@(Get-CimInstance Win32_VideoController | Select-Object -First 8 | ForEach-Object {@{label=$_.Name;vramMiB=[math]::Floor($_.AdapterRAM/1MB)}})} | ConvertTo-Json -Depth 4 -Compress`;
          const observed=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16384}));
          report={...report,ramMiB:observed.ramMiB,gpus:observed.gpus.map(g=>({label:String(g.label).slice(0,60),vramMiB:g.vramMiB}))};
        }
        console.log(JSON.stringify(command==='status'?await client.status(report):command==='rotate'?await client.rotate(report):await client.unpair(),null,2));
      }
    }finally{io.close();}
  }finally{await lock.release();}
}
main().catch(error=>{console.error(error.message==='EEXIST'?'connect-client-already-running':String(error.message).startsWith('connect-')?error.message:'connect-operation-failed');process.exitCode=1;});
