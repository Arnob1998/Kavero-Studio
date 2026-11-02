import { spawn } from 'node:child_process';
import { sha } from '../install/manifest.mjs';
// Kernel ownership is released when this helper exits, including abandoned
// launchers. No expiry, PID-only kill or racy filesystem lock stealing.
export async function acquireHostMutex(root,{spawnImpl=spawn}={}) {
  const name='Global\\KaveroHost-'+sha(root.toLowerCase());
  const command=`$m = [System.Threading.Mutex]::new($false, '${name}'); $owned = $false; try { try { $owned = $m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }; if (!$owned) { Write-Output 'BUSY'; exit 2 }; Write-Output 'READY'; [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { if ($owned) { $m.ReleaseMutex() }; $m.Dispose() }`;
  const child=spawnImpl('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',released=false;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.stdin.end();reject(Error('host-lock-unavailable'));},15000);
    const done=()=>clearTimeout(timer);
    child.once('error',()=>{done();reject(Error('host-lock-unavailable'));});
    child.once('exit',()=>{done();reject(Error(output.includes('BUSY')?'host-already-running':'host-lock-unavailable'));});
    child.stdout.on('data',bytes=>{output+=bytes;if(output.length>1024){child.stdin.end();done();reject(Error('host-lock-unavailable'));}else if(output.includes('READY')){done();resolve();}});
    child.stderr.on('data',()=>{});
  });
  return {
    assert(){if(released||child.exitCode!==null||child.signalCode!==null)throw Error('host-lock-lost');},
    async release(){if(released)return;released=true;const ended=child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));child.stdin.end('\n');await ended;},
  };
}
