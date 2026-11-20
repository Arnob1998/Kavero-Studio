// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {compile,DESKTOP_SOURCES} from './build.mjs';
it.skipIf(process.platform!=='win32'||process.arch!=='x64')('closes the real WinForms shell during polling and opening without late dialogs or leaked sessions',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'kc-lifecycle-unit-'));
 try{
  const exe=path.join(root,'Lifecycle.exe');
  compile({destination:exe,sources:[path.resolve('scripts/local-generation/connect/desktop/CompanionForm.cs'),path.resolve('scripts/local-generation/connect/desktop/LifecycleHarness.cs')]});
  const result=spawnSync(exe,[],{windowsHide:true,timeout:20000,encoding:'utf8'});
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toContain('quit-during-poll window-close-during-poll late-startup-disposed');
  expect(result.stdout).toContain('state-actions');
  expect(DESKTOP_SOURCES).not.toContain('LifecycleHarness.cs');
 }finally{
  if(!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(root).startsWith('kc-lifecycle-unit-'))throw Error('unsafe-test-cleanup');
  rmSync(root,{recursive:true,force:true});
 }
},30000);
