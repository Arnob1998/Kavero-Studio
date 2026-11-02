import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { ModelHub } from "./model-hub";
import { publisherLink } from "./model-license-dialog";
import type { HubModel, HubSnapshot } from "./model-hub-contract";

const owner = "110fce0e-22ba-4a44-a68a-6619b477ca1b", id = "44697489-d22b-432b-818b-155f201cc52d";
const seed = { id: "qwen-image-2-1", source: "https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF", preferredFile: "qwen_image_2.1_Q4_K_M.gguf" };
const license = { identifier: "qwen-research", sourceUrl: "https://huggingface.co/Qwen/license", status: "cached", text: { content: "Publisher terms <script>inert text</script>", bytes: 45, sha256: "a".repeat(64) } };
function model(changes: Partial<HubModel> = {}): HubModel { return { id, key: id, createdAt: 1, state: "inspected", source: seed, requestedRevision: "main", revision: "a".repeat(40), sourceValidity: "valid", recipeSupport: "known-recipe", license: "qwen-research", ready: false, installable: false, ...changes }; }
function snapshot(changes: Partial<HubSnapshot> = {}): HubSnapshot { return { schemaVersion: 1, source: seed, requestedRevision: "main", revision: "a".repeat(40), sourceValidity: "valid", recipeSupport: "known-recipe", declared: null, readme: null, selectedFile: { name: seed.preferredFile, bytes: 1234, sha256: "a".repeat(64) }, variants: [], license, components: [{ role: "vae", status: "verified-metadata", bytes: 100, sha256: "b".repeat(64), revision: "a".repeat(40), license: { ...license, identifier: "other-license" } }], recipeId: "qwen-image-2-1", recipeManifest: "a".repeat(64), hardware: "not-checked", installation: "not-checked", smoke: "not-run", ready: false, installable: false, issues: [], ...changes }; }
const fetcher = vi.fn();
let rows: HubModel[], detail: HubSnapshot | null;
function mount(localEnabled = true, ownerId = owner) { return render(<ModelHub localEnabled={localEnabled} ownerId={ownerId} cloudPanel={<p>Existing cloud controls</p>} />); }
beforeEach(() => {
  localStorage.clear(); rows = []; detail = snapshot();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "POST" ? { model: model() } : url.includes("?id=") ? { model: rows[0] ?? model(), snapshot: detail } : { models: rows, seeds: [{ source: seed, ready: false, installable: false }], seedCount: 1, nextOffset: null } }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetcher.mockReset(); });

describe("Model Hub library", () => {
  it("loads only internal metadata GETs and shares one policy notice across tabs", async () => {
    mount(); await screen.findByText("Qwen Image 2.1 · Q4");
    expect(fetcher.mock.calls.every(([url, init]) => String(url).startsWith("/api/local-generation/models") && init.method === "GET")).toBe(true);
    expect(screen.getAllByText(/Before using a model/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Cloud providers" }));
    expect(screen.getByText("Existing cloud controls")).toBeVisible(); expect(screen.getAllByText(/Before using a model/)).toHaveLength(1);
    expect(fetcher.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
  });
  it("keeps cloud-only deployments usable without probing a local runtime", () => {
    mount(false); expect(screen.getByText("Existing cloud controls")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Cloud providers" }), { key: "ArrowLeft" });
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
  it("inspects a supplied entry only on explicit action, never sends an owner or starts setup", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: `Inspect ${seed.preferredFile}` }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
    const [url, options] = fetcher.mock.calls.find(([, init]) => init.method === "POST")!;
    expect(url).toBe("/api/local-generation/models"); expect(JSON.parse(options.body)).toEqual({ key: expect.any(String), model: seed });
    expect(JSON.parse(options.body)).not.toHaveProperty("owner"); expect(fetcher.mock.calls.some(([url]) => String(url).includes("setup"))).toBe(false);
  });
  it("reuses the exact retry request after acknowledgement loss and across refresh", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (init?.method === "POST") throw Error("Connection lost"); return normal(url, init); });
    const view = mount(); fireEvent.click(await screen.findByRole("button", { name: `Inspect ${seed.preferredFile}` }));
    await screen.findByText("Connection lost"); expect(screen.getByRole("button", { name: "Retry inspection" })).toBeEnabled();
    expect(screen.getByLabelText("Add from Hugging Face")).toHaveValue(seed.source);
    const original = fetcher.mock.calls.find(([, init]) => init.method === "POST")![1].body;
    view.unmount(); const count = fetcher.mock.calls.filter(([, init]) => init.method === "POST").length; mount();
    await screen.findByRole("button", { name: "Retry inspection" }); expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(count);
    fireEvent.click(screen.getByRole("button", { name: "Retry inspection" }));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(count + 1));
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST").at(-1)![1].body).toBe(original);
  });
  it("opens exact component license text as inert text in a labelled modal", async () => {
    rows = [model()]; mount(); fireEvent.click(await screen.findByRole("button", { name: /Qwen-Image-2.1-GGUF.*Compatible recipe/ }));
    fireEvent.click(await screen.findByRole("button", { name: "View VAE license" }));
    expect(screen.getByRole("dialog", { name: "VAE license" })).toBeVisible();
    expect(screen.getByText("Publisher terms <script>inert text</script>")).toBeVisible(); expect(document.querySelector("dialog script")).toBeNull();
    expect(screen.getByRole("link", { name: /Read at source/ })).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Close license" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    fireEvent.change(await screen.findByLabelText("Choose a model file to inspect"), { target: { value: "smaller.gguf" } });
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
    mount(); await screen.findByText("Qwen Image 2.1 · Q4");
    fireEvent.change(screen.getByLabelText("Add from Hugging Face"), { target: { value: "https://example.com/model" } }); fireEvent.click(screen.getByRole("button", { name: "Inspect model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a public Hugging Face"); expect(fetcher.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
    expect(publisherLink("javascript:alert(1)")).toBeNull(); expect(publisherLink("https://user:pass@example.com")).toBeNull();
  });
  it("does not recover another owner's browser retry cache", async () => {
    localStorage.setItem(`kavero-model-inspection:${owner}`, JSON.stringify({ key: id, model: seed })); mount(true, "another-owner");
    await screen.findByText("Qwen Image 2.1 · Q4"); expect(screen.queryByRole("button", { name: "Retry inspection" })).toBeNull();
    expect(screen.getByLabelText("Add from Hugging Face")).toHaveValue("");
  });
});
