import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// CurrentUser DPAPI: private bytes travel over stdin, never process arguments.
export function protectWindows(value, decrypt = false) {
  if (process.platform !== 'win32') throw Error('connect-windows-only');
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $ErrorActionPreference='Stop'; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script,'utf16le').toString('base64')], {
    input: Buffer.from(value).toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536,
  });
  if (result.error || result.status !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(result.stdout)) throw Error('connect-credential-protection-failed');
  return Buffer.from(result.stdout,'base64');
}

export class CredentialStore {
  constructor(file, protect = protectWindows) { this.file=file; this.protect=protect; }
  load() {
    if (!existsSync(this.file)) return null;
    const info=lstatSync(this.file);
    if (!info.isFile() || info.isSymbolicLink() || info.size>32768) throw Error('connect-credential-file-invalid');
    try { return JSON.parse(this.protect(readFileSync(this.file),true).toString('utf8')); }
    catch { throw Error('connect-credentials-unavailable'); }
  }
  save(value) {
    const root=path.dirname(this.file);mkdirSync(root,{recursive:true});
    if (lstatSync(root).isSymbolicLink() || (existsSync(this.file)&&lstatSync(this.file).isSymbolicLink())) throw Error('connect-credential-path-invalid');
    const encrypted=this.protect(Buffer.from(JSON.stringify(value))),tmp=`${this.file}.${randomUUID()}.tmp`;
    writeFileSync(tmp,encrypted,{flag:'wx',mode:0o600});renameSync(tmp,this.file);
  }
}
