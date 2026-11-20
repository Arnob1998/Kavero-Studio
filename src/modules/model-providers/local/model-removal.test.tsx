import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {ModelRemoval} from './model-removal';
import {localProfiles} from './browser-profiles';
const owner='110fce0e-22ba-4a44-a68a-6619b477ca1b',instance='44697489-d22b-432b-818b-155f201cc52d',id='ca422864-c89d-4432-88c9-fb3a69b64704',p=localProfiles[0];
const review={instanceId:instance,packageId:p.packageId,manifest:p.manifest,scope:'managed-delivery',canRemove:true,reclaimableBytes:3*1024**3,retainedBytes:1024**3,reason:null};
const op={id,key:id,instanceId:instance,packageId:p.packageId,manifest:p.manifest,state:'interrupted',reclaimedBytes:0,retainedBytes:0,error:null};
const fetcher=vi.fn(),changed=vi.fn();
const mount=(online=true)=>render(<ModelRemoval ownerId={owner} profile={p.profile} online={online} onChanged={changed}/>);
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async()=>Response.json({ownerId:owner,review,operation:null}));
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
const ready=async()=>{await waitFor(()=>expect(screen.getByRole('button',{name:/Remove model/})).toBeEnabled());};
it('mounts and refreshes with GET only, and requires model/computer/file confirmation',async()=>{
 mount();await ready();expect(fetcher).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:/Remove model/}));
 expect(screen.getByRole('dialog',{name:`Remove ${p.label}?`})).toBeVisible();expect(screen.getByText(/this computer to free up to 3.00 GB/)).toBeVisible();expect(screen.getByText(/Saved images and shared files are kept/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Keep model'}));expect(screen.queryByRole('dialog')).toBeNull();expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});
it('posts a confirmed bounded host/package identity and suppresses duplicate clicks',async()=>{
 let resolve!:(r:Response)=>void;fetcher.mockImplementation(async(_url:string,o:RequestInit)=>o.method==='POST'?await new Promise<Response>(done=>{resolve=done;}):Response.json({ownerId:owner,review,operation:null}));
 mount();await ready();fireEvent.click(screen.getByRole('button',{name:/Remove model/}));fireEvent.click(screen.getByRole('button',{name:'Remove downloaded files'}));
 expect(screen.getByRole('button',{name:/Removing/})).toBeDisabled();const sent=JSON.parse(fetcher.mock.calls.find(([,o])=>o.method==='POST')![1].body);
 expect(sent).toEqual({key:expect.any(String),instanceId:instance,packageId:p.packageId,manifest:p.manifest,confirmed:true});expect(sent).not.toHaveProperty('owner');
 await act(async()=>resolve(Response.json({ownerId:owner,operation:{...op,key:sent.key,state:'removed',reclaimedBytes:2*1024**3,retainedBytes:1024**3}})));
 await screen.findByText(/2.00 GB of managed files reclaimed/);expect(changed).toHaveBeenCalled();expect(fetcher.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
});
it('retains the same confirmation and key after lost acknowledgement and remount without automatic retry',async()=>{
 fetcher.mockImplementation(async(_u:string,o:RequestInit)=>o.method==='POST'?Promise.reject(Error('ack lost')):Response.json({ownerId:owner,review,operation:null}));
 const first=mount();await ready();fireEvent.click(screen.getByRole('button',{name:/Remove model/}));fireEvent.click(screen.getByRole('button',{name:'Remove downloaded files'}));await screen.findByText('ack lost');
 const sent=fetcher.mock.calls.find(([,o])=>o.method==='POST')![1].body;first.unmount();mount();await waitFor(()=>expect(screen.getByRole('button',{name:/Retry removal/})).toBeEnabled());
 expect(fetcher.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:/Retry removal/}));await screen.findByText('ack lost');
 expect(fetcher.mock.calls.filter(([,o])=>o.method==='POST')[1][1].body).toBe(sent);
});
it('recovers the server operation on another tab without browser cache and offers explicit retry',async()=>{
 fetcher.mockResolvedValue(Response.json({ownerId:owner,review:{...review,canRemove:false},operation:op}));mount();await screen.findByRole('button',{name:/Retry removal/});expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});
it('keeps removal in model options and still requires explicit confirmation',async()=>{
 render(<ModelRemoval ownerId={owner} profile={p.profile} online onChanged={changed} compact onDetails={vi.fn()}/>);
 const options=await screen.findByLabelText(`Options for ${p.label}`);expect(screen.getByRole('button',{name:/Remove model/})).not.toBeVisible();
 fireEvent.click(options);fireEvent.click(screen.getByRole('button',{name:/Remove model/}));expect(screen.getByRole('dialog',{name:`Remove ${p.label}?`})).toBeVisible();
 expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});
it('never authorizes offline, cross-owner or replaced-installation replies',async()=>{
 const first=mount(false);expect(screen.queryByRole('button',{name:/Remove model/})).toBeNull();expect(fetcher).not.toHaveBeenCalled();first.unmount();
 fetcher.mockImplementation(async()=>Response.json({ownerId:id,review,operation:null}));mount();await screen.findByText('Removal identity changed.');expect(screen.getByRole('button',{name:/Remove model/})).toBeDisabled();
});
it('keeps an older host fail-closed and explains the required restart',async()=>{
 fetcher.mockResolvedValue(Response.json({ownerId:owner,review:{...review,canRemove:false,reason:'removal-other-owner'},operation:null}));mount();await screen.findByText(/Restart Kavero with the latest version/);expect(screen.getByRole('button',{name:/Remove model/})).toBeDisabled();
});
it('ignores a late reply after the owner changes',async()=>{
 let resolve!:(r:Response)=>void;fetcher.mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done;}));const view=mount();view.rerender(<ModelRemoval ownerId={id} profile={p.profile} online={true} onChanged={changed}/>);
 await act(async()=>resolve(Response.json({ownerId:owner,review,operation:null})));expect(screen.getByRole('button',{name:/Remove model/})).toBeDisabled();expect(changed).not.toHaveBeenCalled();
});

it('confirms account-only removal while keeping shared files for other accounts',async()=>{
 fetcher.mockImplementation(async(_url:string,options:RequestInit)=>options.method==='POST'?Response.json({ownerId:owner,operation:{...op,state:'removed',accountOnly:true,retainedBytes:3*1024**3,key:JSON.parse(options.body as string).key}}):Response.json({ownerId:owner,review:{...review,accountOnly:true,reclaimableBytes:0},operation:null}));
 mount();await ready();fireEvent.click(screen.getByRole('button',{name:/Remove model/}));
 expect(screen.getByText(/Files still needed by other accounts will be kept/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Remove downloaded files'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Remove from my account'}));
 await screen.findByText('Removed from your account. Shared model files are kept for other accounts.');
 expect(changed).toHaveBeenCalled();expect(fetcher.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(1);
});
