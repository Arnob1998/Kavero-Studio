import { describe, it, expect } from "vitest";
import { localSourceBlockReason, localPromptError, localProgressMessage, localJobMessage, type LocalBrowserReadiness } from "./capabilities";
import { localJobIntentSchema } from "./contracts";
const base = { references: 0, activeResult: false, generating: false, sequence: false };
const readiness: LocalBrowserReadiness = { ownerId:'owner',ready:true,saveAvailable:true,saveDestination:'Gallery',hardware:{freeVramMiB:7956,freeRamBytes:4.7*1024**3} };
describe("Local source capability boundary", () => {
  it('reports system-memory waiting before execution, then generating even after allocations reduce free RAM', () => {
    const job={id:'job',state:'queued',createdAt:''};
    expect(localProgressMessage(job,false,readiness)).toBe('Waiting for system memory · 4.7 GB available; 8 GB required.');
    expect(localJobMessage(job,false,{state:'unsaved'},readiness)).toBe(localProgressMessage(job,false,readiness));
    expect(localProgressMessage({...job,state:'running'},false,readiness)).toBe('Generating on your GPU.');
    expect(localProgressMessage({...job,state:'dispatching'},false,readiness)).toBe('Preparing generation…');
  });
  it('reports GPU memory first, matches dispatch thresholds, and keeps unknown/offline waits honest', () => {
    const job={id:'job',state:'queued',createdAt:''};
    expect(localProgressMessage(job,false,{...readiness,hardware:{freeVramMiB:4096,freeRamBytes:4.7*1024**3}})).toBe('Waiting for GPU memory · 4.0 GB available; 6 GB required.');
    expect(localProgressMessage(job,false,{...readiness,hardware:{freeVramMiB:6144,freeRamBytes:8*1024**3}})).toBe('Queued · waiting for available resources.');
    expect(localProgressMessage(job,false,{...readiness,ready:false})).toBe('Queued · waiting for available resources.');
    expect(localProgressMessage(job,true,readiness)).toBe('Reconnecting to your existing job…');
    expect(localProgressMessage(null,false,readiness)).not.toContain('Generating');
  });
  it("blocks references, editing/results, active inference and sequences without changing their state", () => {
    for (const state of [{ ...base, references: 1 }, { ...base, activeResult: true }, { ...base, generating: true }, { ...base, sequence: true }]) {
      const original = { ...state }; expect(localSourceBlockReason(state)).toBeTruthy(); expect(state).toEqual(original);
    }
    expect(localSourceBlockReason(base)).toBeNull();
  });
  it("shares exact prompt/dimension/count limits between UI and server", () => {
    const intent = { profile: "qwen-image-2.1-q4-evaluation", width: 512, height: 512, count: 1, prompt: "x".repeat(1000) };
    expect(localJobIntentSchema.safeParse(intent).success).toBe(true); expect(localPromptError(intent.prompt)).toBeNull();
    for (const prompt of ["", "  ", "x".repeat(1001)]) { expect(localPromptError(prompt)).toBeTruthy(); expect(localJobIntentSchema.safeParse({ ...intent, prompt }).success).toBe(false); }
    for (const unsupported of [{ width: 1024 }, { count: 2 }, { references: [] }, { quality: "high" }, { reasoning: "high" }]) expect(localJobIntentSchema.safeParse({ ...intent, ...unsupported }).success).toBe(false);
  });
});
