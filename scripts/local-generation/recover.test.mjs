// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { assertNoOwnedProcess } from './recover.mjs';
const row={id:'job-id',claim:'private-claim',pid:123,process_creation_identity:'tick-1'};
describe('Explicit abandoned-job recovery guard',()=>{
 it('does not reclaim a live supervisor by timeout',()=>{expect(()=>assertNoOwnedProcess(row,[{Name:'node.exe',ProcessId:123,CreationTicks:'tick-1',CommandLine:'node worker'}])).toThrow('supervisor-still-alive');});
 it('handles PID reuse without treating another process as owned',()=>{expect(()=>assertNoOwnedProcess(row,[{Name:'node.exe',ProcessId:123,CreationTicks:'tick-2',CommandLine:'another app'}])).not.toThrow();});
 it('detects a supervisor still starting before its PID checkpoint',()=>{expect(()=>assertNoOwnedProcess(row,[{Name:'node.exe',ProcessId:456,CommandLine:'worker supervisor job-id private-claim'}])).toThrow('owned-process-still-alive');});
 it('refuses recovery while an orphan native process owns the output path',()=>{expect(()=>assertNoOwnedProcess(row,[{Name:'sd-cli.exe',ProcessId:456,CommandLine:'sd-cli --prompt-file jobs/job-id/prompt.txt'}])).toThrow('owned-process-still-alive');});
 it('fails closed on incomplete process inspection',()=>{expect(()=>assertNoOwnedProcess(row,[{Name:'node.exe',CommandLine:null}])).toThrow('process-inventory-incomplete');});
 it('allows confirmation only when no owned processes remain',()=>{expect(()=>assertNoOwnedProcess(row,[])).not.toThrow();});
});
