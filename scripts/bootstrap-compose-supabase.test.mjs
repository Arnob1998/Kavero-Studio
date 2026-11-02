// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchOk} from './bootstrap-compose-supabase.mjs';

afterEach(()=>vi.unstubAllGlobals());
describe('Compose readiness probes',()=>{
 it.each([true,false])('releases unread HTTP bodies, including unsuccessful probes (%s)',async ok=>{
  const cancel=vi.fn().mockResolvedValue(undefined);
  const fetch=vi.fn().mockResolvedValue({ok,body:{cancel}});
  vi.stubGlobal('fetch',fetch);
  const init={headers:{apikey:'test-key'}};
  expect(await fetchOk('http://service/health',init)).toBe(ok);
  expect(fetch).toHaveBeenCalledWith('http://service/health',init);
  expect(cancel).toHaveBeenCalledOnce();
 });
 it('accepts an empty response body',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,body:null}));
  expect(await fetchOk('http://service/health')).toBe(true);
 });
 it('propagates a network failure for the existing retry loop',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('connection refused')));
  await expect(fetchOk('http://service/health')).rejects.toThrow('connection refused');
 });
});
