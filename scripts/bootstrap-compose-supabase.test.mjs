// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchOk,applyConnectSetupFoundation} from './bootstrap-compose-supabase.mjs';

afterEach(()=>vi.unstubAllGlobals());
describe('Compose readiness probes',()=>{
 it('does not create Connect foundations during a normal Local bootstrap',()=>{
  const apply=vi.fn();expect(applyConnectSetupFoundation({query:()=> 'f',apply})).toBe(false);expect(apply).not.toHaveBeenCalled();
 });
 it('applies and verifies setup RPC privileges only when identity prerequisites exist',()=>{
  const query=vi.fn(()=> 't'),apply=vi.fn();expect(applyConnectSetupFoundation({query,apply})).toBe(true);
  expect(apply).toHaveBeenCalledWith('Remote setup protocol',expect.stringContaining('202611150001_connect_setup_protocol.sql'));
  expect(apply).toHaveBeenCalledWith('Remote setup recovery',expect.stringContaining('202611150002_connect_setup_recovery.sql'));
  expect(apply).toHaveBeenCalledWith('Remote setup browser recovery',expect.stringContaining('202611160001_connect_setup_browser.sql'));
  expect(query.mock.calls.filter(([sql])=>sql.includes('has_function_privilege'))).toHaveLength(2);
  expect(()=>applyConnectSetupFoundation({query:sql=>sql.includes('has_function_privilege')?'f':'t',apply})).toThrow('function/grants');
 });
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
