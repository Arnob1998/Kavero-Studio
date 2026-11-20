import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {localProfiles} from '@/modules/model-providers/local/browser-profiles';
import {useAvailableLocalModels} from './use-available-local-models';
const fetcher=vi.fn();
function setup(index:number,changes={}){
 return {packageId:index?'qwen-2-1-q3-research-delivery-v1':'qwen-2-1-research-delivery-v1',manifest:localProfiles[index].manifest,termsDigest:'b'.repeat(64),consentToken:'1760000000000.'+'c'.repeat(64),purpose:'research-evaluation',accepted:true,available:true,supported:true,installed:true,ready:!index,freeBytes:100*1024**3,downloadBytes:1024**3,workBytes:2*1024**3,requiredFreeBytes:3*1024**3,operation:null,...changes};
}
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();fetcher.mockReset();});
it('lists only installed, consented, supported account models and clears stale availability offline',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async(url:string)=>Response.json({ownerId:'owner-a',setup:setup(url.includes('q3')?1:0,url.includes('q3')?{installed:false}:{})}));
 const view=renderHook(()=>useAvailableLocalModels(true));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(view.result.current).toEqual([localProfiles[0].profile]);
 expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
 fetcher.mockRejectedValue(Error('offline'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});expect(view.result.current).toEqual([]);
});
it.each([{accepted:false},{supported:false},{available:false},{installed:false},{manifest:'a'.repeat(64)}])('excludes unavailable or changed local models: %j',async changes=>{
 vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async(url:string)=>Response.json({ownerId:'owner-a',setup:setup(url.includes('q3')?1:0,changes)}));
 const view=renderHook(()=>useAvailableLocalModels(true));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(view.result.current).toEqual([]);
});
it('does not probe local setup when disabled and rejects mixed owner responses',async()=>{
 vi.stubGlobal('fetch',fetcher);fetcher.mockImplementation(async(url:string)=>Response.json({ownerId:url.includes('q3')?'owner-b':'owner-a',setup:setup(url.includes('q3')?1:0)}));
 const view=renderHook(({enabled})=>useAvailableLocalModels(enabled),{initialProps:{enabled:false}});
 expect(fetcher).not.toHaveBeenCalled();view.rerender({enabled:true});await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(view.result.current).toEqual([]);
});
