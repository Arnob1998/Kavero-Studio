// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {managedPackageDelivery} from '../host/model-package.mjs';
import {validateManifest} from '../install/manifest.mjs';
import {noticesForSetup} from './approval.mjs';
describe('Connect model notice identity',()=>{
 const manifest=managedPackageDelivery('qwen-2-1-internal-evaluation'),verified=validateManifest(manifest,'internal-evaluation');
 const setup={manifest:verified.hash,termsDigest:manifest.termsDigest,purpose:'research-evaluation'};
 it('shows the exact pinned notices for the requested consent',()=>{expect(noticesForSetup(setup,'qwen-image-2.1-q4-evaluation').termsDigest).toBe(setup.termsDigest);});
 it.each([{manifest:'a'.repeat(64)},{termsDigest:'b'.repeat(64)},{purpose:'commercial'}])('rejects stale or mismatched consent identity %j',change=>{expect(()=>noticesForSetup({...setup,...change},'qwen-image-2.1-q4-evaluation')).toThrow('connect-setup-notices-changed');});
 it('rejects a different model profile',()=>{expect(()=>noticesForSetup(setup,'qwen-image-2.1-q3-evaluation')).toThrow('connect-setup-notices-changed');});
});
