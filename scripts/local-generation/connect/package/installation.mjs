import path from 'node:path';
import {existsSync} from 'node:fs';
import {InstallFiles} from '../../install/filesystem.mjs';
import {canonical,sha} from '../../install/manifest.mjs';
export function installationConfiguration(value,release){
 if(!value||Object.keys(value).sort().join(',')!=='channel,installationId,origin,protocol,schema'||value.schema!==1||value.protocol!==1||value.protocol!==release.protocol||value.channel!==release.channel||value.origin!==release.origin||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.installationId))throw Error('connect-installation-config-invalid');return value;
}
export function installedPaths(localAppData,config){
 if(typeof localAppData!=='string'||!path.isAbsolute(localAppData))throw Error('connect-installation-directory-invalid');
 if(!['developer','release'].includes(config.channel)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(config.installationId))throw Error('connect-installation-config-invalid');
 const root=path.join(localAppData,'Kavero','Connect','installed',config.channel,config.installationId.toLowerCase()),originRoot=path.join(root,'origins',sha(config.origin));
 return {root,hostRoot:path.join(root,'host'),originRoot,credentials:path.join(originRoot,'identity.dpapi'),journal:path.join(originRoot,'execution.sqlite')};
}
// No checkout scanning/adoption/migration. Existing local Docker hostRoot stays
// unchanged. Both hosts retain existing exclusive loopback ownership checks;
// concurrent use must fail closed rather than displace an unrelated listener.
export function openInstalledState(localAppData,raw,release,options){
 const config=installationConfiguration(raw,release),layout=installedPaths(localAppData,config),owned=existsSync(path.join(layout.root,'.instance.json')),files=new InstallFiles(layout.root,config.installationId.toLowerCase(),options);
 if(files.exists('installation.json')){if(canonical(JSON.parse(files.read('installation.json',4096)))!==canonical(config))throw Error('connect-installation-identity-changed');}
 else {if(owned)throw Error('connect-installation-config-missing');files.atomicJSON('installation.json',config);}
 return {config,layout,files};
}
