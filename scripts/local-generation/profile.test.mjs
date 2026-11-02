// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolvePackageFile } from './profile.mjs';
describe('Approved package paths',()=>{
 it('rejects absolute paths and traversal outside the package',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'kavero-package-'));try{mkdirSync(path.join(root,'package'));writeFileSync(path.join(root,'outside'),'x');expect(()=>resolvePackageFile(path.join(root,'package'),path.join(root,'outside'))).toThrow();expect(()=>resolvePackageFile(path.join(root,'package'),'../outside')).toThrow('unsafe-package-path');writeFileSync(path.join(root,'package','inside'),'y');expect(resolvePackageFile(path.join(root,'package'),'inside')).toBe(path.join(root,'package','inside'));}finally{rmSync(root,{recursive:true,force:true});}});
});
