import {managedPackageDelivery} from '../host/model-package.mjs';
import {validateManifest} from '../install/manifest.mjs';
// Show exactly the pinned notices that the host will record, never an old/new mix.
export function noticesForSetup(setup,profile){
 const id=profile==='qwen-image-2.1-q4-evaluation'?'qwen-2-1-internal-evaluation':profile==='qwen-image-2.1-q3-evaluation'?'qwen-2-1-q3-internal-evaluation':null;
 if(!id)throw Error('connect-profile-unsupported');
 const manifest=managedPackageDelivery(id),verified=validateManifest(manifest,'internal-evaluation');
 if(setup.manifest!==verified.hash||setup.termsDigest!==manifest.termsDigest||setup.purpose!=='research-evaluation')throw Error('connect-setup-notices-changed');
 return manifest;
}
