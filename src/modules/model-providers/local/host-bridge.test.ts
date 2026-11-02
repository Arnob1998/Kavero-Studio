// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { localHostRequest } from "./host-bridge";
const secret = "ab".repeat(32);
it('allows larger signed metadata only on the model endpoints and rejects prototype actions',async()=>{
 const body={snapshot:{text:'x'.repeat(20000)}};
 vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const encoded=JSON.stringify(body);return new Response(encoded,{headers:{'x-kavero-response':createHmac('sha256',secret).update(options.headers['x-kavero-nonce']+'\n'+createHash('sha256').update(encoded).digest('hex')).digest('hex')}});}));
 expect((await localHostRequest('/host/models/detail',{})).body).toEqual(body);
 await expect(localHostRequest('/host/status',{})).rejects.toThrow('local-host-response-invalid');
 await expect(localHostRequest('toString',{})).rejects.toThrow('local-host-action-invalid');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(32769))));await expect(localHostRequest('/host/models/list',{})).rejects.toThrow('local-host-response-invalid');
});
beforeEach(() => { vi.stubEnv("KAVERO_LOCAL_HOST_SECRET", secret); vi.stubEnv("KAVERO_LOCAL_HOST_URL", "http://127.0.0.1:8792"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("accepts only a nonce-bound signed response, including owner-hidden 404", async () => { vi.stubGlobal("fetch", vi.fn(async (_url, options) => { const bytes = JSON.stringify({ operation: null }); const nonce = options.headers["x-kavero-nonce"]; const signature = createHmac("sha256", secret).update(nonce + "\n" + createHash("sha256").update(bytes).digest("hex")).digest("hex"); return new Response(bytes, { status: 404, headers: { "x-kavero-response": signature } }); })); expect(await localHostRequest("/host/activation", {})).toEqual({ status: 404, body: { operation: null } }); });
it("rejects unsigned, altered, and stale-nonce replies", async () => { for (const signature of ["", "a".repeat(64), createHmac("sha256", secret).update("another nonce").digest("hex")]) { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-kavero-response": signature } }))); await expect(localHostRequest("/host/status", {})).rejects.toThrow("local-host-response-invalid"); } });
it("rejects an oversized host response", async () => { vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(4097)))); await expect(localHostRequest("/host/status", {})).rejects.toThrow("local-host-response-invalid"); });
it("permits bounded signed full notices only on the terms endpoint",async()=>{
 const body={terms:[{name:"License",text:"notice ".repeat(3000)}]};
 vi.stubGlobal("fetch",vi.fn(async(_url,options)=>{const bytes=JSON.stringify(body),signature=createHmac("sha256",secret).update(options.headers["x-kavero-nonce"]+"\n"+createHash("sha256").update(bytes).digest("hex")).digest("hex");return new Response(bytes,{headers:{"x-kavero-response":signature}});}));
 expect((await localHostRequest("/host/setup/terms",{})).body).toEqual(body);await expect(localHostRequest("/host/setup",{})).rejects.toThrow("local-host-response-invalid");
 vi.stubGlobal("fetch",vi.fn(async()=>new Response("x".repeat(256*1024+1))));await expect(localHostRequest("/host/setup/terms",{})).rejects.toThrow("local-host-response-invalid");
});
it("refuses remote URLs and browser-inaccessible lifecycle actions", async () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); for (const url of ["https://127.0.0.1:8792", "http://example.com:8792", "http://127.0.0.1:8792/other", "http://user@127.0.0.1:8792"]) { vi.stubEnv("KAVERO_LOCAL_HOST_URL", url); await expect(localHostRequest("/host/status", {})).rejects.toThrow("local-host-config-invalid"); } vi.stubEnv("KAVERO_LOCAL_HOST_URL", "http://127.0.0.1:8792"); await expect(localHostRequest("/host/shutdown", {})).rejects.toThrow("local-host-action-invalid"); expect(fetch).not.toHaveBeenCalled(); });
