// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {SetupHub} from './setup-hub.mjs';
import {EVALUATION_PACKAGE,Q3_PACKAGE} from './model-package.mjs';
import {DatabaseSync} from 'node:sqlite';
function fixture(){
 const managers=[],rows=[];
 const db={prepare:()=>({get:(owner,second,terms,purpose)=>rows.find(r=>r.owner===owner&&(terms?r.manifest===second&&r.terms===terms&&r.purpose===purpose:r.operation===second))})};
 const hub=new SetupHub({},db,{}, {factory:packageId=>{const m={packageId,verified:{hash:packageId,manifest:{termsDigest:'terms'}},busy:false,admitting:false,pending:null,
 snapshot:vi.fn(owner=>({owner,packageId})),terms:vi.fn(()=>packageId),access:vi.fn(),admit:vi.fn(async()=>({id:packageId})),run:vi.fn(async()=>({state:'installed'})),installer:{store:{removalPending:vi.fn(()=>false)},status:vi.fn(()=>({state:'installed'}))},close:vi.fn()};managers.push(m);return m;}});
 return {hub,managers,rows};
}
it('keeps the legacy default and requires explicit supported second profile',()=>{const {hub}=fixture();expect(hub.snapshot('owner').packageId).toBe(EVALUATION_PACKAGE);expect(hub.snapshot('owner','qwen-image-2.1-q3-evaluation').packageId).toBe(Q3_PACKAGE);expect(()=>hub.snapshot('owner','arbitrary')).toThrow('invalid-setup');});
it('requires independent exact owner, manifest, terms and completed installation',()=>{
 const {hub,rows,managers}=fixture();rows.push({owner:'a',manifest:Q3_PACKAGE,terms:'terms',purpose:'research-evaluation',operation:'op'});
 expect(hub.permission('a',Q3_PACKAGE)).toBe(true);expect(hub.permission('b',Q3_PACKAGE)).toBe(false);expect(hub.permission('a',EVALUATION_PACKAGE)).toBe(false);
 managers[1].installer.store.removalPending.mockReturnValue(true);expect(hub.permission('a',Q3_PACKAGE)).toBe(false);managers[1].installer.store.removalPending.mockReturnValue(false);
 managers[1].installer.status.mockReturnValue({state:'downloading'});expect(hub.permission('a',Q3_PACKAGE)).toBe(false);
 rows[0].terms='stale';expect(hub.permission('a',Q3_PACKAGE)).toBe(false);expect(hub.operation('b','op')).toBeNull();
});
it('serializes admissions across profiles and rejects another pending install',async()=>{
 const {hub,managers}=fixture();let release;managers[0].admit.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const first=hub.admit({manifest:EVALUATION_PACKAGE});await expect(hub.admit({manifest:Q3_PACKAGE})).rejects.toThrow('setup-busy');release({id:'first'});await first;
 managers[0].pending='op';await expect(hub.admit({manifest:Q3_PACKAGE})).rejects.toThrow('setup-busy');expect(()=>hub.close()).toThrow('setup-busy');
});
it('recovers exactly the original owner/key receipt rather than the most recent setup',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE setup_consents(owner TEXT,submission_key TEXT,manifest TEXT,operation TEXT,PRIMARY KEY(owner,submission_key))');
  db.exec("INSERT INTO setup_consents VALUES('owner','original','qwen-2-1-internal-evaluation','old-op'),('owner','newer','qwen-2-1-q3-internal-evaluation','new-op')");
  const hub=new SetupHub({},db,{}, {factory:packageId=>({verified:{hash:packageId},operation:(owner,id)=>({owner,id,packageId})})});
  expect(hub.receipt('owner','original')).toMatchObject({id:'old-op',packageId:EVALUATION_PACKAGE});
  expect(hub.receipt('owner','newer')).toMatchObject({id:'new-op',packageId:Q3_PACKAGE});
  expect(hub.receipt('other','original')).toBeNull();expect(hub.receipt('owner','missing')).toBeNull();
 }finally{db.close();}
});
