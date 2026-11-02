// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), host: vi.fn(), switch:vi.fn(), reconcile:vi.fn(async(_owner,value)=>value) }));
vi.mock("./service", () => ({ context: mocks.context }));
vi.mock("@/modules/model-providers/local/host-bridge", () => ({ localHostRequest: mocks.host }));
vi.mock("@/modules/model-providers/local/runtime-switch",async importOriginal=>({...await importOriginal<typeof import("@/modules/model-providers/local/runtime-switch")>(),switchManagedLocalPackage:mocks.switch,reconcileLocalSwitch:mocks.reconcile}));
import { localSetupGET, localSetupPOST } from "./setup-service";
const id = "44697489-d22b-432b-818b-155f201cc52d", owner = "110fce0e-22ba-4a44-a68a-6619b477ca1b";
const operation = { id, packageId: "qwen-2-1-internal-evaluation", state: "admitted", error: null };
const get = (suffix = "") => new Request("http://localhost/api/local-generation/setup" + suffix);
const post = (body: unknown) => new Request(get(), { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "1"); vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "1"); mocks.context.mockResolvedValue({ owner }); mocks.host.mockResolvedValue({ status: 202, body: { operation } }); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("keeps the setup endpoint gated before authentication", async () => { vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "0"); expect((await localSetupGET(get())).status).toBe(404); expect(mocks.context).not.toHaveBeenCalled(); });
it("requires a signed-in owner", async () => { mocks.context.mockResolvedValue({ response: new Response(null, { status: 401 }) }); expect((await localSetupPOST(post({}))).status).toBe(401); expect(mocks.host).not.toHaveBeenCalled(); });
it("derives ownership from auth and preserves the retry key", async () => { const response = await localSetupPOST(post({ action: "activate", key: id, packageId: operation.packageId })); expect(response.status).toBe(202); expect(mocks.host).toHaveBeenCalledWith("/host/activate", { owner, key: id, packageId: operation.packageId }); expect(await response.json()).toEqual({ operation }); });
it("derives switch ownership from auth and rejects browser fence overrides",async()=>{
 mocks.switch.mockResolvedValue({status:202,body:{operation}});expect((await localSetupPOST(post({action:"switch",key:id,packageId:operation.packageId}))).status).toBe(202);
 expect(mocks.switch).toHaveBeenCalledWith(owner,id,operation.packageId);
 expect((await localSetupPOST(post({action:"switch",key:id,packageId:operation.packageId,appFence:{id}}))).status).toBe(400);
});
it("rejects browser-supplied owners and arbitrary packages", async () => { for (const body of [{ action: "activate", key: id, packageId: operation.packageId, owner: id }, { action: "activate", key: id, packageId: "arbitrary" }]) expect((await localSetupPOST(post(body))).status).toBe(400); expect(mocks.host).not.toHaveBeenCalled(); });
it("cancels and reads only the authenticated owner's operation", async () => { mocks.host.mockResolvedValue({ status: 404, body: { operation: null } }); expect((await localSetupGET(get("?id=" + id))).status).toBe(404); expect(mocks.host).toHaveBeenCalledWith("/host/activation", { owner, id }); expect((await localSetupPOST(post({ action: "cancel", id }))).status).toBe(404); expect(mocks.host).toHaveBeenCalledWith("/host/activation/cancel", { owner, id }); });
it("rejects duplicate and unexpected query fields", async () => { for (const query of ["?id=", "?id=x", "?id=" + id + "&id=" + id, "?owner=" + owner]) expect((await localSetupGET(get(query))).status).toBe(400); expect(mocks.host).not.toHaveBeenCalled(); });
it("strips host secrets, paths, PID and identities from status", async () => { mocks.host.mockResolvedValue({ status: 200, body: { state: "ready", inferenceReady: true, evaluationEnabled: true, secret: "private", pid: 123, root: "private" } }); const response = await localSetupGET(get()); expect(await response.json()).toEqual({ state: "ready", inferenceReady: true, evaluationEnabled: true, researchEvaluationOnly: true }); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
it("bounds the request before buffering the rest of its stream", async () => { let cancelled = false; const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; } }); const request = new Request(get(), { method: "POST", body: stream, duplex: "half" } as RequestInit); expect((await localSetupPOST(request)).status).toBe(413); expect(cancelled).toBe(true); expect(mocks.host).not.toHaveBeenCalled(); });
it("hides private host errors", async () => { mocks.host.mockRejectedValue(Error("private diagnostic")); const response = await localSetupGET(get()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("diagnostic"); });
it("forwards pinned consent and a stable key using the authenticated owner",async()=>{
 const body={action:"install",key:id,manifest:"a".repeat(64),termsDigest:"b".repeat(64),consentToken:"1760000000000."+"c".repeat(64),purpose:"research-evaluation",accepted:true};
 const op={id,packageId:"qwen-2-1-research-delivery-v1",state:"admitted",processedBytes:0,error:null};mocks.host.mockResolvedValue({status:202,body:{operation:op}});
 expect((await localSetupPOST(post(body))).status).toBe(202);const {action,...fields}=body;expect(mocks.host).toHaveBeenCalledWith("/host/setup/install",{...fields,owner});
 for(const change of [{owner:id},{accepted:false},{purpose:"commercial"},{url:"https://example.com"}])expect((await localSetupPOST(post({...body,...change}))).status).toBe(400);
});
it("returns escaped pinned terms without paths and rejects mixed setup query modes",async()=>{
 mocks.host.mockResolvedValue({status:200,body:{terms:[{name:"License",text:"full notice",path:"private"}],secret:"private"}});
 expect(await (await localSetupGET(get("?view=terms"))).json()).toEqual({terms:[{name:"License",text:"full notice"}]});expect(mocks.host).toHaveBeenCalledWith("/host/setup/terms",{owner});
 for(const query of ["?view=terms&id="+id,"?view=model&view=model","?view=unknown"])expect((await localSetupGET(get(query))).status).toBe(400);
});
