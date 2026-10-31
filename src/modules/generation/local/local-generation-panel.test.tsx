import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalGenerationPanel } from "./local-generation-panel";
import { localPromptError } from "./capabilities";
vi.mock("./local-model-setup", () => ({ LocalModelSetup: ({ onAccess }: { onAccess: (ready: boolean) => void }) => <input aria-label="Fixture consent" type="checkbox" onChange={e => onAccess(e.target.checked)} /> }));
const key = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const ready = { ownerId: "owner-a", ready: true, saveAvailable: true, saveDestination: "This machine · Gallery" };
let requests: { url: string; body?: string; method: string }[];
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
function mount(prompt = "A vase") { return render(<LocalGenerationPanel prompt={prompt} onPromptChange={vi.fn()} />); }
async function enable() { await screen.findByText("Verified setup"); fireEvent.click(screen.getByRole("checkbox")); }
beforeEach(() => { requests = []; sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Internal local generation journey", () => {
  it("keeps the full overlong prompt and makes no admission request", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(ready))); mount("x".repeat(1001)); await enable();
    expect(screen.getByRole("button", { name: "Create image" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("x".repeat(1001));
    expect(screen.getByRole("alert")).toHaveTextContent("has not been shortened");
    expect(localPromptError(" ")).toBeTruthy();
  });
  it("persists before admission and retries a lost acknowledgement with the same key and intent", async () => {
    let submissions = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      requests.push({ url, body: options.body as string, method: options.method! });
      if (url.endsWith("readiness")) return response(ready);
      if (url.endsWith("/jobs")) {
        expect(sessionStorage.getItem("kavero-local-job:owner-a")).toBeTruthy();
        if (++submissions === 1) return Promise.reject(new Error("lost acknowledgement"));
        return response({ job: { id, state: "queued", createdAt: "now" } }, 202);
      }
      return response({ save: { state: "unsaved" } });
    }));
    mount(); await enable(); fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await screen.findByText("lost acknowledgement"); fireEvent.click(screen.getByRole("button", { name: "Check submission" }));
    await screen.findByText(/Queued ·/);
    const submits = requests.filter(r => r.url.endsWith("/jobs"));
    expect(submits).toHaveLength(2); expect(submits[0].body).toBe(submits[1].body);
    expect(Object.keys(JSON.parse(submits[0].body!))).toEqual(["idempotencyKey", "intent"]);
    expect(JSON.parse(submits[0].body!).intent).toEqual({ prompt: "A vase", profile: "qwen-image-2.1-q4-evaluation", width: 512, height: 512, count: 1 });
  });
  it("refreshes an owner-bound job, preserves download on save failure, then retries only saving", async () => {
    sessionStorage.setItem("kavero-local-job:owner-a", JSON.stringify({ submission: { idempotencyKey: key, intent: { prompt: "A vase", profile: "qwen-image-2.1-q4-evaluation", width: 512, height: 512, count: 1 } }, jobId: id }));
    let saves = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      requests.push({ url, method: options.method!, body: options.body as string });
      if (url.endsWith("readiness")) return response(ready);
      if (url.endsWith("/save")) {
        if (options.method === "POST") return ++saves === 1 ? response({ error: "Storage disconnected", save: { state: "save-failed" } }, 503) : response({ save: { state: "saved", imageId: id } });
        return response({ save: { state: "unsaved" } });
      }
      return response({ job: { id, state: "generated-unvalidated", output: { state: "generated", expiresAt: "2099-01-01T00:00:00Z" } } });
    }));
    mount(); await screen.findByRole("button", { name: "Save to Gallery" });
    fireEvent.click(screen.getByRole("button", { name: "Save to Gallery" }));
    await screen.findByText("Storage disconnected"); expect(screen.getByRole("link", { name: "Download image" })).toHaveAttribute("href", `/api/local-generation/jobs/${id}/output`);
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByText("Saved to Gallery."); expect(screen.getByRole("link", { name: "Download image" })).toHaveAttribute("href", `/api/gallery/images/${id}/content`);
    expect(requests.filter(r => r.url.endsWith("/jobs"))).toHaveLength(0);
    expect(requests.filter(r => r.method === "POST").map(r => r.body)).toEqual(["{}", "{}"]);
  });
  it("does not resume another owner's cached submission", async () => {
    sessionStorage.setItem("kavero-local-job:owner-b", JSON.stringify({ submission: { idempotencyKey: key, intent: { prompt: "Private prompt", profile: "qwen-image-2.1-q4-evaluation" } }, jobId: id }));
    vi.stubGlobal("fetch", vi.fn((url: string) => { requests.push({ url, method: "GET" }); return response({ ...ready, saveAvailable: false, saveDestination: "Google Drive · local saving not verified yet" }); }));
    mount(); await screen.findByText("Verified setup");
    expect(screen.getByRole("textbox")).toHaveValue("A vase"); expect(requests).toHaveLength(1);
  });
  it("reports an offline runtime without paid-provider or planner requests", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ ...ready, ready: false }))); mount(); await screen.findByText("Offline");
    expect(screen.getByRole("button", { name: "Create image" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check connection" })).toBeEnabled();
  });
});
