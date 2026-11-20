import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { LocalModelInventory } from "./local-model-inventory";
import { localProfiles } from "./browser-profiles";
import { useState } from 'react';
import type { LocalProfile } from './browser-profiles';
vi.mock('./model-removal',()=>({ModelRemoval:()=>null})); // Removal has its own mutation/recovery suite.

const owner = "110fce0e-22ba-4a44-a68a-6619b477ca1b", id = "44697489-d22b-432b-818b-155f201cc52d";
const fetcher = vi.fn();
function snapshot(index: number, changes = {}) {
  return { packageId: index ? "qwen-2-1-q3-research-delivery-v1" : "qwen-2-1-research-delivery-v1", manifest: localProfiles[index].manifest, termsDigest: "b".repeat(64), consentToken: "1760000000000." + "c".repeat(64), purpose: "research-evaluation", accepted: true, available: true, supported: true, installed: true, active: !index, ready: !index, freeBytes: 100 * 1024 ** 3, downloadBytes: 10 * 1024 ** 3, workBytes: 20 * 1024 ** 3, requiredFreeBytes: 21 * 1024 ** 3, operation: null, ...changes };
}
const card = (index: number) => {
  fireEvent.click(screen.getByRole("radio", {name:index ? /Q3/ : /Q4/}));
  return within(screen.getByRole("article", { name: `${localProfiles[index].label} on this host` }));
};
const mount = () => render(<LocalModelInventory ownerId={owner} managedProfile={null} onManage={vi.fn()} />);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async (url: string) => Response.json({ ownerId: owner, setup: snapshot(url.includes("q3") ? 1 : 0) }));
});

it('shows one branded image model and one selected version, opening consent separately without mutations', async () => {
  fetcher.mockImplementation(async (url: string) => Response.json({ ownerId: owner, setup: snapshot(url.includes('q3') ? 1 : 0, { installed: false, ready: false, accepted: false }) }));
  function Hub() {
    const [managed, setManaged] = useState<LocalProfile | null>(null);
    return <LocalModelInventory ownerId={owner} managedProfile={managed} onManage={setManaged}/>;
  }
  render(<Hub/>);
  expect(screen.getByRole('img', { name: 'Qwen logo' })).toHaveAttribute('src', expect.stringContaining('qwen.svg'));
  expect(screen.getByText('Image generation')).toBeVisible();
  await screen.findByRole('button', { name: /Set up model/ });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  fireEvent.click(screen.getByRole('radio',{name:/Q3/}));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  const setup = screen.getByRole('button', { name: /Set up model/ });
  setup.focus(); fireEvent.click(setup);
  const dialog = screen.getByRole('dialog', { name: localProfiles[1].label });
  expect(dialog).toBeVisible();
  await within(dialog).findByText('10.0 GB download');
  expect(within(dialog).getByRole('button', { name: 'Accept & download' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  expect(within(dialog).getByRole('button', { name: 'Accept & download' })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close model setup' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(setup).toHaveFocus();
  expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); fetcher.mockReset(); });

it('cancels the visible download directly, prevents duplicate clicks and refreshes with GET only', async () => {
  let resolve!: (response: Response) => void;
  let cancelled = false;
  const operation = { id, packageId: 'qwen-2-1-research-delivery-v1', state: 'downloading', processedBytes: 1024, error: null };
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') return new Promise<Response>(done => { resolve = done; });
    return Response.json({ ownerId: owner, setup: snapshot(url.includes('q3') ? 1 : 0, url.includes('q3') ? {} : { installed: false, ready: false, operation: {...operation, state: cancelled ? 'cancelled' : 'downloading'} }) });
  });
  mount(); const cancel = await screen.findByRole('button', { name: 'Cancel download' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  fireEvent.click(cancel); fireEvent.click(cancel);
  expect(screen.getByRole('button', { name: 'Cancelling download…' })).toBeDisabled();
  const posts = fetcher.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(1); expect(JSON.parse(posts[0][1].body)).toEqual({ action: 'cancel-install', id });
  cancelled = true;
  await act(async () => resolve(Response.json({ operation: { ...operation, state: 'cancelled' } })));
  await screen.findByText('Download cancelled');
  expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull();
});

it('retries cancellation of the same operation after an uncertain acknowledgement', async () => {
  const operation = { id, packageId: 'qwen-2-1-research-delivery-v1', state: 'downloading', processedBytes: 1024, error: null };
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') throw Error('Cancellation acknowledgement lost');
    return Response.json({ ownerId: owner, setup: snapshot(url.includes('q3') ? 1 : 0, url.includes('q3') ? {} : { installed: false, ready: false, operation }) });
  });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Cancel download' }));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry cancel' }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(2));
  const bodies = fetcher.mock.calls.filter(([, options]) => options.method === 'POST').map(([, options]) => options.body);
  expect(bodies[0]).toBe(bodies[1]);
});

it('does not offer cancellation once model activation has started', async () => {
  fetcher.mockImplementation(async (url: string) => Response.json({ ownerId: owner, setup: snapshot(url.includes('q3') ? 1 : 0, url.includes('q3') ? {} : { installed: false, ready: false, operation: { id, packageId: 'qwen-2-1-research-delivery-v1', state: 'activating', processedBytes: 1024, error: null } }) }));
  mount(); await screen.findByText('Preparing model'); expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull();
});

it("recognizes both installed profiles without an inspection or cached browser state and only reads on remount", async () => {
  localStorage.clear(); const first = mount();
  await card(0).findByText("Active · ready to create"); await card(1).findByText("Installed");
  expect(card(0).getByRole('link', {name: `Generate with ${localProfiles[0].label}`})).toHaveAttribute('href', '/generate?source=local');
  expect(fetcher).toHaveBeenCalledTimes(2); first.unmount(); mount(); await card(1).findByText("Installed");
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(([url, options]) => url.startsWith("/api/local-generation/setup?view=model&profile=") && options.method === "GET" && options.cache === "no-store")).toBe(true);
  expect(localStorage.length).toBe(0);
});

it("distinguishes downloading and installed files without owner permission", async () => {
  fetcher.mockImplementation(async (url: string) => {
    const index = url.includes("q3") ? 1 : 0;
    return Response.json({ ownerId: owner, setup: snapshot(index, index ? { accepted: false } : { installed: false, ready: false, operation: { id, packageId: "qwen-2-1-research-delivery-v1", state: "downloading", processedBytes: 1024 ** 3, error: null } }) });
  });
  mount(); await card(0).findByText("Downloading");
  expect(card(0).getByRole("progressbar")).toHaveAttribute("value", String(1024 ** 3));
  await card(1).findByText(/Review terms/);
  expect(card(1).getByText("Installed")).toBeVisible(); expect(screen.queryByRole("button", { name: /Cancel download/ })).toBeNull();
});

it("retains clearly marked last-known state while offline then reconnects using GET only", async () => {
  mount(); await card(1).findByText("Installed");
  fetcher.mockRejectedValue(Error("offline")); fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  await card(1).findByText("Computer unavailable"); expect(card(1).getByText(/Last confirmed: Installed/)).toBeVisible();
  expect(card(1).getByRole("button", { name: /Use model/ })).toBeDisabled();
  fetcher.mockImplementation(async (url: string) => Response.json({ ownerId: owner, setup: snapshot(url.includes("q3") ? 1 : 0) }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" })); await card(1).findByText("Installed");
  expect(fetcher.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});

it("rejects another owner or changed recipe and never retains those as installed", async () => {
  fetcher.mockImplementation(async (url: string) => Response.json(url.includes("q3") ? { ownerId: owner, setup: snapshot(1, { manifest: "a".repeat(64) }) } : { ownerId: id, setup: snapshot(0) }));
  mount(); await card(0).findByText("Computer unavailable"); await card(1).findByText("Computer unavailable");
  expect(screen.queryByText("Installed")).toBeNull(); expect(screen.queryByText("Active · ready to create")).toBeNull();
});

it("rejects a cross-profile delivery operation even when the manifest matches", async () => {
  fetcher.mockImplementation(async (url: string) => Response.json({ ownerId: owner, setup: snapshot(url.includes("q3") ? 1 : 0, { operation: { id, packageId: url.includes("q3") ? "qwen-2-1-research-delivery-v1" : "qwen-2-1-q3-research-delivery-v1", state: "downloading", processedBytes: 1024, error: null } }) }));
  mount(); await card(0).findByText("Computer unavailable"); await card(1).findByText("Computer unavailable");
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("ignores an old response after a manual refresh", async () => {
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  mount(); await card(1).findByText("Installed");
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" })); await card(0).findByText("Active · ready to create");
  await act(async () => resolve(Response.json({ ownerId: owner, setup: snapshot(0, { installed: false, ready: false }) })));
  expect(card(0).getByText("Active · ready to create")).toBeVisible();
});

it("keeps polling progress without admitting another install and stops when unmounted", async () => {
  const first = mount(); await card(1).findByText("Installed"); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  await act(async () => { await Promise.resolve(); });
  const count = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(fetcher.mock.calls.length).toBe(count + 2);
  first.unmount(); const stopped = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); }); expect(fetcher).toHaveBeenCalledTimes(stopped);
  expect(fetcher.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});

it("offers an explicit original setup review for interrupted work", async () => {
  fetcher.mockImplementation(async (url: string) => {
    const index = url.includes("q3") ? 1 : 0;
    return Response.json({ ownerId: owner, setup: snapshot(index, { installed: false, ready: false, operation: { id, packageId: index ? "qwen-2-1-q3-research-delivery-v1" : "qwen-2-1-research-delivery-v1", state: "interrupted", processedBytes: 1024, error: null } }) });
  });
  const onManage = vi.fn(); render(<LocalModelInventory ownerId={owner} managedProfile={null} onManage={onManage} />);
  await card(0).findByText("Interrupted · retry required"); fireEvent.click(card(0).getByRole("button", { name: /Retry setup/ }));
  expect(onManage).toHaveBeenCalledWith(localProfiles[0].profile); expect(fetcher.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});

it('keeps version changes readable, keyboard accessible and read-only, with one visible status',async()=>{
  mount();await screen.findByRole('link',{name:/Generate with/});
  expect(screen.getAllByText('Active \u00b7 ready to create')).toHaveLength(1);
  const q4=screen.getByRole('radio',{name:/Q4/});expect(q4).toHaveAttribute('aria-checked','true');
  fireEvent.keyDown(q4,{key:'ArrowRight'});
  const q3=screen.getByRole('radio',{name:/Q3/});expect(q3).toHaveAttribute('aria-checked','true');expect(q3).toHaveFocus();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
});
it('keeps another version download discoverable and exposes its cancel action without a mutation',async()=>{
  fetcher.mockImplementation(async(url:string)=>Response.json({ownerId:owner,setup:snapshot(url.includes('q3')?1:0,url.includes('q3')?{installed:false,ready:false,operation:{id,packageId:'qwen-2-1-q3-research-delivery-v1',state:'downloading',processedBytes:1024,error:null}}:{})}));
  mount();fireEvent.click(await screen.findByRole('button',{name:`View ${localProfiles[1].label} download`}));
  expect(screen.getByRole('radio',{name:/Q3/})).toHaveFocus();
  expect(screen.getByRole('button',{name:'Cancel download'})).toBeVisible();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
});
