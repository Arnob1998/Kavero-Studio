import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { ModelHub,projectRepositoryLink } from "./model-hub";
import { publisherLink } from "./model-license-dialog";
import type { HubModel, HubSnapshot } from "./model-hub-contract";
import { localProfiles } from "./browser-profiles";

const owner = "110fce0e-22ba-4a44-a68a-6619b477ca1b", id = "44697489-d22b-432b-818b-155f201cc52d";
const seed = { id: "qwen-image-2-1", source: "https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF", preferredFile: "qwen_image_2.1_Q4_K_M.gguf" };
const license = { identifier: "qwen-research", sourceUrl: "https://huggingface.co/Qwen/license", status: "cached", text: { content: "Publisher terms <script>inert text</script>", bytes: 45, sha256: "a".repeat(64) } };
function model(changes: Partial<HubModel> = {}): HubModel { return { id, key: id, createdAt: 1, state: "inspected", source: seed, requestedRevision: "main", revision: "a".repeat(40), sourceValidity: "valid", recipeSupport: "known-recipe", license: "qwen-research", ready: false, installable: false, ...changes }; }
function snapshot(changes: Partial<HubSnapshot> = {}): HubSnapshot { return { schemaVersion: 1, source: seed, requestedRevision: "main", revision: "a".repeat(40), sourceValidity: "valid", recipeSupport: "known-recipe", declared: null, readme: null, selectedFile: { name: seed.preferredFile, bytes: 1234, sha256: "a".repeat(64) }, variants: [], license, components: [{ role: "vae", status: "verified-metadata", bytes: 100, sha256: "b".repeat(64), revision: "a".repeat(40), license: { ...license, identifier: "other-license" } }], recipeId: "qwen-image-2-1", recipeManifest: "a".repeat(64), hardware: "not-checked", installation: "not-checked", smoke: "not-run", ready: false, installable: false, issues: [], ...changes }; }
const fetcher = vi.fn();
let rows: HubModel[], detail: HubSnapshot | null;
function mount(localEnabled = true, ownerId = owner) { const view=render(<ModelHub localEnabled={localEnabled} ownerId={ownerId} cloudPanel={<p>Existing cloud controls</p>} />); if(localEnabled){fireEvent.click(screen.getByRole("button",{name:"Add from Hugging Face"}));const custom=screen.queryByRole("button",{name:/Use a Hugging Face link/});if(custom)fireEvent.click(custom);}return view; }
beforeEach(() => {
  window.history.replaceState({}, "", "/settings/models");
  localStorage.clear(); rows = []; detail = snapshot();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => url.includes("?discover=") ? {models:[{id:"Abiray/Qwen-Image-2.1-GGUF",author:"Abiray",name:"Qwen-Image-2.1-GGUF",downloads:1200,likes:30,task:"text-to-image",format:"GGUF",license:"apache-2.0",gated:false}],nextCursor:null} : init?.method === "POST" ? { model: model() } : url.includes("?id=") ? { model: rows[0] ?? model(), snapshot: detail } : { models: rows, seeds: [{ source: seed, ready: false, installable: false }], seedCount: 1, nextOffset: null } }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetcher.mockReset(); });

describe("Model Hub library", () => {
  it('always exposes Local models, Remote and Cloud providers without enabling private remote operations',()=>{
    render(<ModelHub localEnabled={false} ownerId={owner} cloudPanel={<p>Cloud controls</p>}/>);
    expect(screen.getAllByRole('tab').map(tab=>tab.textContent)).toEqual(['Local models','Remote','Cloud providers']);
    fireEvent.click(screen.getByRole('tab',{name:'Remote'}));
    expect(screen.getByText(/Remote access isn’t available/)).toBeVisible();
    expect(screen.queryByRole('button',{name:'Connect computer'})).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('tab',{name:'Remote'}),{key:'ArrowRight'});
    expect(screen.getByText('Cloud controls')).toBeVisible();
  });
  it('supports direct Remote entry and requires an owner before looking up computers',()=>{
    render(<ModelHub initialSource="remote" connectEnabled localEnabled cloudPanel={<p>Cloud controls</p>}/>);
    expect(screen.getByRole('tab',{name:'Remote'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/auth/login');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('opens parsed repository files and uses only a verified recipe for setup',async()=>{
    detail=snapshot({recipeId:localProfiles[1].recipeId,recipeManifest:localProfiles[1].manifest,selectedFile:{name:localProfiles[1].file,bytes:1234,sha256:'a'.repeat(64)}});
    const normal=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
      if(!url.includes('/setup?'))return normal(url,init);
      const index=url.includes('q3')?1:0;
      return Response.json({ownerId:owner,setup:{packageId:index?'qwen-2-1-q3-research-delivery-v1':'qwen-2-1-research-delivery-v1',manifest:localProfiles[index].manifest,termsDigest:'b'.repeat(64),consentToken:'1760000000000.'+'c'.repeat(64),purpose:'research-evaluation',accepted:!index,available:true,supported:true,installed:!index,ready:!index,freeBytes:100*1024**3,downloadBytes:10*1024**3,workBytes:20*1024**3,requiredFreeBytes:21*1024**3,operation:null}});
    });
    render(<ModelHub localEnabled ownerId={owner} cloudPanel={<p>Cloud</p>}/>);
    expect(screen.queryByRole('radiogroup',{name:'Model version'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'View Qwen Image'}));
    fireEvent.click(screen.getByRole('button',{name:'Inspect Abiray/Qwen-Image-2.1-GGUF'}));
    fireEvent.click(await screen.findByRole('button',{name:'Continue'}));
    const setup=await screen.findByRole('dialog',{name:localProfiles[1].label});
    await within(setup).findByText('10.0 GB download');
    expect(within(setup).getByRole('button',{name:'Accept & download'})).toBeDisabled();
    expect(fetcher.mock.calls.some(([url,options])=>url.includes('/setup')&&options.method==='POST')).toBe(false);
  });
  it('keeps a custom model link when closing and reopening its dialog',()=>{
    mount();fireEvent.change(screen.getByRole('textbox',{name:'Hugging Face model link'}),{target:{value:seed.source}});
    fireEvent.click(screen.getByRole('button',{name:'Close add model'}));
    fireEvent.click(screen.getByRole('button',{name:'Add from Hugging Face'}));
    expect(screen.getByRole('textbox',{name:'Hugging Face model link'})).toHaveValue(seed.source);
    expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
  });
  it('shows Hugging Face models on the page and makes custom links a direct action',async()=>{
    render(<ModelHub localEnabled ownerId={owner} cloudPanel={<p>Existing cloud controls</p>}/>);
    expect(screen.getByRole('button',{name:'View Qwen Image'})).toBeVisible();
    expect(screen.getByRole('region',{name:'On this computer'})).toBeVisible();
    expect(screen.queryByRole('textbox',{name:'Hugging Face model link'})).toBeNull();
    expect(screen.queryByText('Higher precision')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Add from Hugging Face'}));
    expect(screen.getByRole('dialog',{name:'Add a model'})).toBeVisible();
    expect(screen.getByRole('textbox',{name:'Hugging Face model link'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Close add model'}));expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link',{name:'Star on GitHub'})).toHaveAttribute('href','https://github.com/Arnob1998/Kavero-Studio');
    expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
    for(const value of [null,'','http://github.com/x/y','https://example.com/x/y','https://user@github.com/x/y','https://github.com/x/y?star=true'])expect(projectRepositoryLink(value)).toBeNull();
  });
  it('starts on Remote for hosted Connect and supports keyboard navigation across the three sources',async()=>{
    const normal=fetcher.getMockImplementation()!;fetcher.mockImplementation(async(url:string,init?:RequestInit)=>url.startsWith('/api/connect/')?Response.json({version:1,serverTime:new Date().toISOString(),computers:[],ownerOutstanding:0}):normal(url,init));
    render(<ModelHub connectEnabled localEnabled={false} ownerId={owner} cloudPanel={<p>Existing cloud controls</p>}/>);
    await screen.findByText('No computers connected');expect(screen.getByRole('tab',{name:'Remote'})).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(screen.getByRole('tab',{name:'Remote'}),{key:'ArrowRight'});expect(screen.getByText('Existing cloud controls')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('tab',{name:'Cloud providers'}),{key:'Home'});expect(screen.getByRole('tab',{name:'Local models'})).toHaveFocus();
    expect(fetcher.mock.calls.every(([url])=>!url.startsWith('/api/local-generation/'))).toBe(true);
  });
  it("keeps host download progress outside selected details and recovers it after changing tabs without POSTs", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.includes("/setup?view=model")) return normal(url, init);
      const profile = localProfiles[url.includes("q3") ? 1 : 0];
      return Response.json({ ownerId: owner, setup: { packageId: url.includes("q3") ? "qwen-2-1-q3-research-delivery-v1" : "qwen-2-1-research-delivery-v1", manifest: profile.manifest, termsDigest: "b".repeat(64), consentToken: "1760000000000." + "c".repeat(64), purpose: "research-evaluation", accepted: true, available: true, supported: true, installed: false, ready: false, freeBytes: 100*1024**3, downloadBytes: 10*1024**3, workBytes: 20*1024**3, requiredFreeBytes: 21*1024**3, operation: { id, packageId: url.includes("q3") ? "qwen-2-1-q3-research-delivery-v1" : "qwen-2-1-research-delivery-v1", state: "downloading", processedBytes: 1024**3, error: null } } });
    });
    rows = [model()]; mount();
    const inventory = () => within(screen.getByRole("region", { name: "On this computer" }));
    await inventory().findAllByText("Downloading");
    fireEvent.click(screen.getByRole("button", { name: /Qwen-Image-2.1-GGUF.*Compatible recipe/ }));
    await screen.findByRole("button", { name: "View VAE license" }); expect(inventory().getAllByRole("progressbar")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Cloud providers" }));
    fireEvent.click(screen.getByRole("tab", { name: "Local models" })); await inventory().findAllByText("Downloading");
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });
  it("prefills the selected CLI local model using supplied metadata and GETs only", async () => {
    window.history.replaceState({}, "", "/settings/models?source=local&starterProfile=qwen-image-2.1-q4-evaluation");
    mount();await waitFor(()=>expect(screen.getByLabelText("Hugging Face model link")).toHaveValue(seed.source));
    expect(screen.getByLabelText("Filename (optional)")).toHaveValue(seed.preferredFile);
    expect(screen.getByText(/Starting model: Qwen Image 2.1/)).toBeVisible();
    expect(fetcher.mock.calls.every(([,init])=>init.method==="GET")).toBe(true);
  });
  it("keeps an existing retry intent ahead of a CLI starter suggestion", async () => {
    window.history.replaceState({}, "", "/settings/models?starterProfile=qwen-image-2.1-q4-evaluation");
    const prior={key:crypto.randomUUID(),model:{...seed,source:"https://huggingface.co/example/recovery",preferredFile:"recover.gguf"}};
    localStorage.setItem(`kavero-model-inspection:${owner}`,JSON.stringify(prior));mount();await screen.findByText(/Starting model/);
    await screen.findByRole("textbox", {name:"Hugging Face model link"});expect(screen.getByLabelText("Hugging Face model link")).toHaveValue(prior.model.source);
    expect(screen.getByLabelText("Filename (optional)")).toHaveValue("recover.gguf");expect(fetcher.mock.calls.every(([,init])=>init.method==="GET")).toBe(true);
  });
  it("shows a provider starter suggestion without activating it or probing Local", () => {
    window.history.replaceState({}, "", "/settings/models?source=cloud&starterModel=kavero-image-openai-gpt-image-2");
    render(<ModelHub localEnabled ownerId={owner} initialSource="cloud" cloudPanel={<p>Existing cloud controls</p>}/>);
    expect(screen.getByText(/Starting model: GPT Image 2/)).toBeVisible();expect(screen.getByText("Existing cloud controls")).toBeVisible();expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores unknown CLI model suggestions", async () => {
    window.history.replaceState({}, "", "/settings/models?starterProfile=unverified&starterModel=unverified");mount();await screen.findByRole("textbox", {name:"Hugging Face model link"});expect(screen.queryByText(/Starting model:/)).not.toBeInTheDocument();expect(screen.getByLabelText("Hugging Face model link")).toHaveValue("");
  });
  it("loads internal metadata and inventory GETs and shares one policy notice across tabs", async () => {
    mount(); await screen.findByRole("textbox", {name:"Hugging Face model link"});
    expect(fetcher.mock.calls.every(([url, init]) => (String(url).startsWith("/api/local-generation/models") || String(url).startsWith("/api/local-generation/setup?view=model")) && init.method === "GET")).toBe(true);
    expect(screen.queryByText(/Before using a model/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Cloud providers" }));
    expect(screen.getByText("Existing cloud controls")).toBeVisible(); expect(screen.queryByText(/Before using a model/)).toBeNull();
    expect(fetcher.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
  });
  it("keeps cloud-only deployments usable without probing a local runtime", () => {
    mount(false); expect(screen.getByText("Existing cloud controls")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Cloud providers" }), { key: "Home" });
    expect(screen.getByText("Local models need a managed Kavero host.")).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Local models" })).toHaveFocus();
  });
  it("honors a direct cloud-provider entry even when local models are enabled", () => {
    render(<ModelHub localEnabled ownerId={owner} initialSource="cloud" cloudPanel={<p>Existing cloud controls</p>} />);
    expect(screen.getByText("Existing cloud controls")).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses bounded pagination without submitting another inspection", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("?offset=0")) return { ok: true, json: async () => ({ models: [], seeds: [], seedCount: 6, nextOffset: 5 }) };
      return normal(url, init);
    });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/local-generation/models?offset=5", expect.objectContaining({ method: "GET" })));
    expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  });
  it("checks an explicit custom link without sending an owner or starting a download",async()=>{
    mount();fireEvent.change(screen.getByRole('textbox',{name:'Hugging Face model link'}),{target:{value:seed.source}});fireEvent.click(screen.getByRole('button',{name:'Check model'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([,init])=>init.method==='POST')).toBe(true));
    const [url,options]=fetcher.mock.calls.find(([,init])=>init.method==='POST')!;const body=JSON.parse(options.body);
    expect(url).toBe('/api/local-generation/models');expect(body.key).toEqual(expect.any(String));expect(body.model.source).toBe(seed.source);expect(body).not.toHaveProperty('owner');expect(body.model).not.toHaveProperty('preferredFile');
    expect(fetcher.mock.calls.some(([url,init])=>String(url).includes('setup')&&init.method==='POST')).toBe(false);
  });
  it("reuses the exact retry request after acknowledgement loss and across refresh", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (init?.method === "POST") throw Error("Connection lost"); return normal(url, init); });
    const view = mount();fireEvent.change(screen.getByRole('textbox',{name:'Hugging Face model link'}),{target:{value:seed.source}});fireEvent.click(screen.getByRole('button',{name:'Check model'}));
    await screen.findByText("Connection lost"); expect(screen.getByRole("button", { name: "Retry check" })).toBeEnabled();
    expect(screen.getByLabelText("Hugging Face model link")).toHaveValue(seed.source);
    const original = fetcher.mock.calls.find(([, init]) => init.method === "POST")![1].body;
    view.unmount(); const count = fetcher.mock.calls.filter(([, init]) => init.method === "POST").length; mount();
    await screen.findByRole("button", { name: "Retry check" }); expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(count);
    fireEvent.click(screen.getByRole("button", { name: "Retry check" }));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(count + 1));
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST").at(-1)![1].body).toBe(original);
  });
  it("opens exact component license text as inert text in a labelled modal", async () => {
    rows = [model()]; mount(); fireEvent.click(await screen.findByRole("button", { name: /Qwen-Image-2.1-GGUF.*Compatible recipe/ }));
    fireEvent.click(await screen.findByRole("button", { name: "View VAE license" }));
    expect(screen.getByRole("dialog", { name: "VAE license" })).toBeVisible();
    expect(screen.getByText("Publisher terms <script>inert text</script>")).toBeVisible(); expect(document.querySelector("dialog script")).toBeNull();
    expect(screen.getByRole("link", { name: /Read at source/ })).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Close license" })); await waitFor(() => expect(screen.queryByRole("dialog",{name:"VAE license"})).toBeNull());expect(screen.getByRole("dialog",{name:"Model details"})).toBeVisible();
  });
  it("keeps unknown license and unsupported models explicit without install/use controls", async () => {
    rows = [model({ recipeSupport: "unsupported-runtime", license: null })]; detail = snapshot({ recipeSupport: "unsupported-runtime", license: null, components: [] });
    mount(); fireEvent.click(await screen.findByRole("button", { name: /Unsupported runtime/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unknown" })); expect(screen.getByText("Unknown license")).toBeVisible();
    expect(screen.getByText(/License text is unavailable/)).toBeVisible(); expect(screen.queryByRole("button", { name: /Install|Use model/ })).toBeNull();
  });
  it("chooses an explicit variant as a new inspection and leaves the original snapshot unchanged", async () => {
    rows = [model({ recipeSupport: "needs-variant" })]; detail = snapshot({ recipeSupport: "needs-variant", selectedFile: null, variants: [{ name: "smaller.gguf", bytes: 123, sha256: "a".repeat(64) }] });
    mount(); fireEvent.click(await screen.findByRole("button", { name: /Choose a variant/ }));
    fireEvent.click(await screen.findByRole("button",{name:"Check smaller.gguf"}));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init.method === "POST")![1].body).model.preferredFile).toBe("smaller.gguf"); expect(detail.selectedFile).toBeNull();
  });
  it("retries interrupted host records with their original submission key", async () => {
    rows = [model({ state: "retry-required" })]; detail = null; mount();
    fireEvent.click(await screen.findByRole("button", { name: /Inspection interrupted/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry interrupted inspection" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init.method === "POST")![1].body).key).toBe(id);
  });
  it("rejects non-publisher URLs before submitting", async () => {
    mount(); await screen.findByRole("textbox", {name:"Hugging Face model link"});
    fireEvent.change(screen.getByLabelText("Hugging Face model link"), { target: { value: "https://example.com/model" } }); fireEvent.click(screen.getByRole("button", { name: "Check model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a public Hugging Face"); expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
    expect(publisherLink("javascript:alert(1)")).toBeNull(); expect(publisherLink("https://user:pass@example.com")).toBeNull();
  });
  it("does not recover another owner's browser retry cache", async () => {
    localStorage.setItem(`kavero-model-inspection:${owner}`, JSON.stringify({ key: id, model: seed })); mount(true, "another-owner");
    await screen.findByRole("textbox", {name:"Hugging Face model link"}); expect(screen.queryByRole("button", { name: "Retry check" })).toBeNull();
    expect(screen.getByLabelText("Hugging Face model link")).toHaveValue("");
  });
});
