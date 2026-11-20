import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {StrictMode} from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {RemoteSetupActions,RemoteSetupTracker} from './remote-setup-controls';
import {useRemoteSetup,type Preparation} from './use-remote-setup';
import {previewOwner as owner,previewDevice as device,previewSource,previewSnapshot} from '../compatibility.test-fixtures';
import {projectCompatibility} from '../compatibility-projection';
import type {Computer} from './computer-contract';
import type {CompatibilityResult} from '../compatibility-contract';
const profile='qwen-image-2.1-q4-evaluation' as const;
const pc:Computer={id:device,name:'Studio PC',status:'not-ready',lastSeenAt:new Date().toISOString(),model:null,capability:null,outstanding:0,hardware:null};
const snapshot=previewSnapshot();
function preparation():Preparation{return {setupProtocol:1,intent:{setupProtocol:1,ownerId:owner,origin:location.origin,deviceId:device,installationId:'94697489-d22b-432b-818b-155f201cc52d',keyVersion:1,profile,manifestHash:snapshot.recipeManifest!,termsDigest:'b'.repeat(64),purpose:'research-evaluation',recipeHash:'c'.repeat(64)},intentHash:'a'.repeat(64),deviceName:'Studio PC',expiresAt:new Date(Date.now()+120000).toISOString(),capable:true,installable:true,message:'Native checks passed.',assessment:null,active:null,notices:[{name:'Qwen-LICENSE.txt',sha256:'b'.repeat(64)}]};}
const makeResult=()=>projectCompatibility({ownerId:owner,source:previewSource,destination:{kind:'remote',deviceId:device},snapshot,computer:pc});
function request(command:{key:string;kind:'assess'|'install'}){return {id:'b4697489-d22b-432b-818b-155f201cc52d',deviceId:device,key:command.key,kind:command.kind,intent:preparation().intent,intentHash:'a'.repeat(64),state:'requested',cancelRequested:false,processedBytes:0,operationId:null,evidence:null,reason:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),version:1};}
const fetcher=vi.fn();let created:ReturnType<typeof request>|null,commands:Record<string,unknown>[];
function Harness({ownerId=owner,enabled=true,candidate=true,computers=[pc],result=makeResult()}:{ownerId?:string;enabled?:boolean;candidate?:boolean;computers?:Computer[];result?:CompatibilityResult}){
 const control=useRemoteSetup(ownerId,enabled);return <>{candidate&&<RemoteSetupActions result={result} computer={computers[0]} control={control}/>}<RemoteSetupTracker control={control} computers={computers}/></>;
}
beforeEach(()=>{localStorage.clear();commands=[];created=null;vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async(_url,options)=>{const body=JSON.parse(options.body);commands.push(body);
 if(body.action==='prepare')return Response.json(preparation());
 if(body.action==='create'){created=request(body);return Response.json({setupProtocol:1,request:created});}
 if(body.action==='recover'||body.action==='inspect')return created?Response.json({setupProtocol:1,request:created}):Response.json({error:'not-found'},{status:404});
 if(body.action==='cancel'){created={...created!,state:'cancelling',cancelRequested:true};return Response.json({setupProtocol:1,request:created});}
 throw Error('Unexpected setup action');
 });});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();fetcher.mockReset();localStorage.clear();});
async function review(){await screen.findByRole('checkbox');}
async function download(){await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));await screen.findByText('Waiting for computer');}
it('keeps setup unavailable by default and does not contact setup APIs when disabled',async()=>{
 render(<Harness enabled={false}/>);expect(screen.queryByRole('button',{name:'Download to Studio PC'})).toBeNull();expect(screen.queryByRole('button',{name:'Refresh setup checks'})).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it('does not offer setup for an unsupported catalog entry even when private setup is enabled',()=>{
 const result=makeResult();result.snapshot=previewSnapshot({recipeSupport:'unsupported-runtime',recipeId:null,recipeManifest:null});render(<Harness result={result}/>);expect(screen.queryByRole('button',{name:'Refresh setup checks'})).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it('retains the original submission through React development effect replay',async()=>{
 render(<StrictMode><Harness/></StrictMode>);await download();expect(commands.filter(c=>c.action==='create')).toHaveLength(1);expect(screen.getByRole('article',{name:'Setup on Studio PC'})).toBeVisible();
});
it('bounds unacknowledged browser requests before submitting another computer',async()=>{
 const pending=['54697489-d22b-432b-818b-155f201cc52d','64697489-d22b-432b-818b-155f201cc52d'].map((id,index)=>({deviceName:`Other PC ${index}`,intentHash:'a'.repeat(64),request:null,command:{action:'create',key:id,deviceId:id,profile,kind:'install',accepted:true,reviewHash:'a'.repeat(64)}}));localStorage.setItem(`kavero.remote-setup.v1:${owner}`,JSON.stringify(pending));
 render(<Harness/>);await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));await screen.findByText('Recover or finish the existing setup requests before starting another.');expect(commands.some(c=>c.action==='create')).toBe(false);
});
it('requests a native assessment before showing Download for unverified resources',async()=>{
 const actual=fetcher.getMockImplementation()!;let checked=false;
 fetcher.mockImplementation(async(url,options)=>JSON.parse(options.body).action==='prepare'?Response.json({...preparation(),installable:checked}):actual(url,options));
 render(<Harness/>);const check=await screen.findByRole('button',{name:'Check Studio PC'});expect(screen.queryByRole('button',{name:'Download to Studio PC'})).toBeNull();fireEvent.click(check);
 await screen.findByText('Waiting for computer');expect(commands.find(c=>c.action==='create')).toMatchObject({kind:'assess'});expect(commands.find(c=>c.action==='create')).not.toHaveProperty('accepted');
 checked=true;created={...created!,state:'assessed'};fireEvent(document,new Event('visibilitychange'));await screen.findByRole('button',{name:'Download to Studio PC'});expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('requires explicit exact-destination review and saves the original key before submission',async()=>{
 const actual=fetcher.getMockImplementation()!;fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(options.body);if(body.action==='create'){const saved=JSON.parse(localStorage.getItem(`kavero.remote-setup.v1:${owner}`)!);expect(saved[0].command.key).toBe(body.key);expect(saved[0].deviceName).toBe('Studio PC');}return actual(url,options);});
 render(<Harness/>);await review();expect(screen.getByRole('button',{name:'Download to Studio PC'})).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));
 await screen.findByText('Waiting for computer');expect(commands.find(c=>c.action==='create')).toMatchObject({deviceId:device,profile,kind:'install',reviewHash:'a'.repeat(64),accepted:true});
 expect(fetcher.mock.calls.every(([,options])=>options.headers['x-kavero-connect-owner']===owner)).toBe(true);
});
it('keeps request cancellation attached to the original computer after the candidate changes',async()=>{
 const view=render(<Harness/>);await download();const next={...pc,id:'54697489-d22b-432b-818b-155f201cc52d',name:'Laptop'};view.rerender(<Harness candidate={false} computers={[next]}/>);
 expect(screen.getByRole('article',{name:'Setup on Studio PC'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancel setup on Studio PC'}));await screen.findByText('Cancelling original operation');expect(commands.find(c=>c.action==='cancel')).toEqual({action:'cancel',id:created!.id});
 expect(screen.queryByText(/^Cancelled$/)).toBeNull();created={...created!,state:'cancelled'};fireEvent(document,new Event('visibilitychange'));await screen.findByText('Cancelled');
});
it('restores an acknowledged request after refresh without submitting it again',async()=>{
 const view=render(<Harness/>);await download();const key=created!.key;view.unmount();render(<Harness candidate={false}/>);await screen.findByText('Waiting for computer');await waitFor(()=>expect(commands.some(c=>c.action==='inspect')).toBe(true));
 expect(commands.filter(c=>c.action==='create')).toHaveLength(1);expect(created!.key).toBe(key);
});
it('recovers a lost create acknowledgement by its saved key after remount',async()=>{
 const actual=fetcher.getMockImplementation()!;let lose=true;fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(options.body);const response=await actual(url,options);if(body.action==='create'&&lose){lose=false;throw Error('Connection lost');}return response;});
 const view=render(<Harness/>);await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));await screen.findByText('Reconnecting to the original request');const key=created!.key;view.unmount();render(<Harness candidate={false}/>);
 await screen.findByText('Waiting for computer');expect(commands.filter(c=>c.action==='create')).toHaveLength(1);expect(commands.find(c=>c.action==='recover')).toMatchObject({key});
});
it('retries an unacknowledged request using the identical original command',async()=>{
 const actual=fetcher.getMockImplementation()!;let lose=true;fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(options.body);if(body.action==='create'&&lose){lose=false;commands.push(body);throw Error('offline');}return actual(url,options);});
 render(<Harness/>);await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));const button=await screen.findByRole('button',{name:'Recover original request'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
 await screen.findByText('Waiting for computer');const creates=commands.filter(c=>c.action==='create');expect(creates).toHaveLength(2);expect(creates[1]).toEqual(creates[0]);
});
it('does not submit when its original request key cannot be persisted',async()=>{
 render(<Harness/>);await review();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Browser storage is full');});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));
 await screen.findByText('Browser storage is full');expect(commands.some(c=>c.action==='create')).toBe(false);
});
it('never treats setup completion as current Generate permission',async()=>{
 const command={action:'create',key:'e4697489-d22b-432b-818b-155f201cc52d',deviceId:device,profile,kind:'install',accepted:true,reviewHash:'a'.repeat(64)};created={...request({key:command.key,kind:'install'}),state:'ready'};localStorage.setItem(`kavero.remote-setup.v1:${owner}`,JSON.stringify([{command,intentHash:'a'.repeat(64),deviceName:'Studio PC',request:created}]));
 const view=render(<Harness candidate={false}/>);await screen.findByText('Setup complete');expect(screen.queryByRole('link',{name:'Open Generate'})).toBeNull();
 const ready:Computer={...pc,status:'ready',model:{profile,label:'Qwen Q4'},capability:{bindingHash:'d'.repeat(64),width:512,height:512,count:1,promptLimit:1000}};view.rerender(<Harness candidate={false} computers={[ready]}/>);expect(screen.getByRole('link',{name:'Open Generate'})).toHaveAttribute('href','/generate');
});
it('hides expired review and invalidates consent when the selected source changes',async()=>{
 const view=render(<Harness/>);await review();fireEvent.click(screen.getByRole('checkbox'));
 const changed=makeResult();changed.assessmentId='d'.repeat(64);view.rerender(<Harness result={changed}/>);expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByRole('button',{name:'Download to Studio PC'})).toBeNull();await screen.findByRole('checkbox');expect(screen.getByRole('checkbox')).not.toBeChecked();
 fetcher.mockResolvedValueOnce(Response.json({...preparation(),expiresAt:new Date(Date.now()-1).toISOString()}));fireEvent.click(screen.getByRole('button',{name:'Refresh setup checks'}));await screen.findByText(/These setup checks have expired/);expect(screen.queryByRole('button',{name:'Download to Studio PC'})).toBeNull();
});
it('leaves a new account untouched by an old account response',async()=>{
 const actual=fetcher.getMockImplementation()!;let resolve:((r:Response)=>void)|undefined;fetcher.mockImplementation(async(url,options)=>{const body=JSON.parse(options.body);if(body.action==='create'){created=request(body);commands.push(body);return new Promise<Response>(r=>{resolve=r;});}return actual(url,options);});
 const view=render(<Harness key={owner}/>);await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 const next='f4697489-d22b-432b-818b-155f201cc52d';view.rerender(<Harness key={next} ownerId={next} candidate={false}/>);resolve!(Response.json({setupProtocol:1,request:created}));await waitFor(()=>expect(localStorage.getItem(`kavero.remote-setup.v1:${next}`)).toBeNull());expect(screen.queryByRole('article')).toBeNull();
});
it('preserves an uncertain submission but releases a fresh key after a definite pre-admission refusal',async()=>{
 const actual=fetcher.getMockImplementation()!;fetcher.mockImplementation(async(url,options)=>JSON.parse(options.body).action==='create'?Response.json({error:'Checks expired. Review again.',notSubmitted:true},{status:409}):actual(url,options));
 render(<Harness/>);await review();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Download to Studio PC'}));await screen.findAllByText('Checks expired. Review again.');await waitFor(()=>expect(JSON.parse(localStorage.getItem(`kavero.remote-setup.v1:${owner}`)!)).toHaveLength(0));
});
