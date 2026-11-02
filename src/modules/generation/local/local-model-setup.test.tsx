import { render,screen,fireEvent,cleanup,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,it,expect,vi } from "vitest";
import { LocalModelSetup } from "./local-model-setup";
import { localProfiles } from '@/modules/model-providers/local/browser-profiles';
const owner="110fce0e-22ba-4a44-a68a-6619b477ca1b",id="44697489-d22b-432b-818b-155f201cc52d";
const snapshot={packageId:"qwen-2-1-research-delivery-v1",manifest:localProfiles[0].manifest,termsDigest:"b".repeat(64),consentToken:"1760000000000."+"c".repeat(64),purpose:"research-evaluation",accepted:false,available:true,supported:true,ready:false,installed:false,freeBytes:100*1024**3,downloadBytes:10*1024**3,workBytes:20*1024**3,requiredFreeBytes:21*1024**3,operation:null};
const response=(body:unknown)=>Promise.resolve(Response.json(body));
beforeEach(()=>localStorage.clear());afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("does not download on mount or refresh and persists a stable key before consent submission",async()=>{
  const posts:string[]=[];vi.stubGlobal("fetch",vi.fn((url:string,options:RequestInit)=>{
    if(options.method==="POST"){expect(localStorage.getItem(`kavero-local-setup:${owner}`)).toBeTruthy();posts.push(options.body as string);return Promise.reject(Error("Lost acknowledgement"));}
    return response({ownerId:owner,setup:snapshot});
  }));
  const props={ownerId:owner,onAccess:vi.fn(),onReady:vi.fn()};const first=render(<LocalModelSetup {...props}/>);
  await screen.findByText("10.0 GB download");expect(posts).toHaveLength(0);expect(screen.getByRole("button",{name:"Accept & download"})).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Accept & download"}));await screen.findByText("Lost acknowledgement");
  first.unmount();render(<LocalModelSetup {...props}/>);await screen.findByText("10.0 GB download");expect(posts).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Accept & download"}));await screen.findByText("Lost acknowledgement");
  expect(posts).toHaveLength(2);expect(posts[0]).toBe(posts[1]);expect(JSON.parse(posts[0])).toMatchObject({accepted:true,purpose:"research-evaluation",manifest:snapshot.manifest});expect(JSON.parse(posts[0])).not.toHaveProperty("owner");
});
it("shows real installation progress and owner-only cancellation without enabling Create",async()=>{
  const onAccess=vi.fn(),requests:unknown[]=[];const operation={id,packageId:snapshot.packageId,state:"downloading",processedBytes:1024**3,error:null};
  vi.stubGlobal("fetch",vi.fn((url:string,options:RequestInit)=>{if(options.method==="POST"){requests.push(JSON.parse(options.body as string));return response({operation:{...operation,state:"cancelled"}});}return response({ownerId:owner,setup:{...snapshot,accepted:true,operation}});}));
  render(<LocalModelSetup ownerId={owner} onAccess={onAccess} onReady={vi.fn()}/>);await screen.findByRole("progressbar");expect(onAccess).not.toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button",{name:"Cancel download"}));await screen.findByRole("button",{name:"Start new download"});expect(requests).toEqual([{action:"cancel-install",id}]);
});
it("enables only owner-consented readiness and lazily loads escaped license text",async()=>{
  const onAccess=vi.fn(),onReady=vi.fn();vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("terms")?response({terms:[{name:"License",text:"<script>untrusted()</script>"}]}):response({ownerId:owner,setup:{...snapshot,ready:true,accepted:true,installed:true}})));
  render(<LocalModelSetup ownerId={owner} onAccess={onAccess} onReady={onReady}/>);await waitFor(()=>expect(onAccess).toHaveBeenCalledWith(true));expect(onReady).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Model licenses & notices"));await screen.findByText("License");expect(screen.getByText("<script>untrusted()</script>")).toBeInTheDocument();expect(document.querySelector("script")).toBeNull();
});
it("never imports another owner's cached consent and rejects a session change",async()=>{
  localStorage.setItem("kavero-local-setup:other",JSON.stringify({key:id,manifest:snapshot.manifest,termsDigest:snapshot.termsDigest}));
  const onAccess=vi.fn();vi.stubGlobal("fetch",vi.fn(()=>response({ownerId:"other",setup:{...snapshot,ready:true}})));
  render(<LocalModelSetup ownerId={owner} onAccess={onAccess} onReady={vi.fn()}/>);await screen.findByText("Your account changed. Check the connection again.");expect(onAccess).not.toHaveBeenCalledWith(true);expect(screen.getByRole("button",{name:"Accept & download"})).toBeDisabled();
});
it("keeps cancellation pending until the host confirms its tombstone",async()=>{
 const operation={id,packageId:snapshot.packageId,state:"cancelling",processedBytes:1024**3,error:null};vi.stubGlobal("fetch",vi.fn(()=>response({ownerId:owner,setup:{...snapshot,accepted:true,operation}})));
 render(<LocalModelSetup ownerId={owner} onAccess={vi.fn()} onReady={vi.fn()}/>);await screen.findByRole("button",{name:"Cancelling…"});expect(screen.getByRole("button",{name:"Cancelling…"})).toBeDisabled();expect(screen.queryByRole("button",{name:"Cancel download"})).toBeNull();
});
it("shows the detected GPU without assigning baseline speed to an unbenchmarked machine",async()=>{
 vi.stubGlobal("fetch",vi.fn(()=>response({ownerId:owner,setup:{...snapshot,compatibility:"eligible",hardware:{gpuName:"NVIDIA GeForce RTX 4070",totalVramMiB:12288,totalRamBytes:32*1024**3,freeVramMiB:10000,freeRamBytes:12*1024**3,confidence:"unbenchmarked"}}})));
 render(<LocalModelSetup ownerId={owner} onAccess={vi.fn()} onReady={vi.fn()}/>);await screen.findByText("NVIDIA GeForce RTX 4070 · 12.0 GB VRAM");expect(screen.getByText(/Generation speed has not been benchmarked/)).toBeInTheDocument();expect(screen.queryByText(/55 seconds/)).toBeNull();
});
it("blocks downloading on unsupported hardware and explains the actual requirement",async()=>{
 vi.stubGlobal("fetch",vi.fn(()=>response({ownerId:owner,setup:{...snapshot,supported:false,available:false,compatibility:"gpu-too-small"}})));
 render(<LocalModelSetup ownerId={owner} onAccess={vi.fn()} onReady={vi.fn()}/>);await screen.findByText(/needs at least 8 GB GPU memory/);fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:"Accept & download"})).toBeDisabled();expect(fetch).toHaveBeenCalledTimes(1);
});

it('uses Q3 setup identity, preserves a lost switch acknowledgement across refresh and never switches automatically',async()=>{
 const profile=localProfiles[1],posts:string[]=[],gets:string[]=[];
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
   if(options.method==='POST'){posts.push(options.body as string);expect(localStorage.getItem(`kavero-local-setup:${owner}:q3:switch`)).toBeTruthy();return Promise.reject(Error('Lost switch acknowledgement'));}
   gets.push(url);return response({ownerId:owner,setup:{...snapshot,manifest:profile.manifest,accepted:true,installed:true,switchRequired:true,hardware:{gpuName:'NVIDIA GeForce RTX 3060',totalVramMiB:12288,totalRamBytes:32*1024**3,freeVramMiB:10000,freeRamBytes:12*1024**3,confidence:'measured'}}});
 }));
 const props={ownerId:owner,profile:profile.profile,onAccess:vi.fn(),onReady:vi.fn(),hideNotices:true};
 const first=render(<LocalModelSetup {...props}/>);await screen.findByRole('button',{name:'Use model'});expect(posts).toHaveLength(0);
 expect(screen.queryByText(/55 seconds/)).toBeNull();expect(screen.queryByText('Model licenses & notices')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Use model'}));await screen.findByText('Lost switch acknowledgement');first.unmount();
 render(<LocalModelSetup {...props}/>);await screen.findByRole('button',{name:'Use model'});expect(posts).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Use model'}));await screen.findByText('Lost switch acknowledgement');
 expect(posts[1]).toBe(posts[0]);expect(JSON.parse(posts[0])).toEqual({action:'switch',key:expect.any(String),packageId:profile.packageId});
 expect(gets.every(url=>url.endsWith(`view=model&profile=${profile.profile}`))).toBe(true);
});

it('reconciles an acknowledged switch after refresh using GET only',async()=>{
 const profile=localProfiles[1],onReady=vi.fn(),urls:string[]=[];
 localStorage.setItem(`kavero-local-setup:${owner}:q3:switch`,JSON.stringify({key:owner,id}));
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
   expect(options.method).toBe('GET');urls.push(url);
   return url.includes('?id=')?response({operation:{id,packageId:profile.packageId,state:'installed',error:null}}):response({ownerId:owner,setup:{...snapshot,manifest:profile.manifest,accepted:true,installed:true,ready:true,switchRequired:false}});
 }));
 render(<LocalModelSetup ownerId={owner} profile={profile.profile} onAccess={vi.fn()} onReady={onReady}/>);
 await screen.findByText('Active model · ready to create');expect(urls[0]).toBe(`/api/local-generation/setup?id=${id}`);expect(onReady).toHaveBeenCalledTimes(1);
 expect(localStorage.getItem(`kavero-local-setup:${owner}:q3:switch`)).toBeNull();
});

it('rejects changed recipe identity before displaying usable setup',async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>response({ownerId:owner,setup:{...snapshot,manifest:'a'.repeat(64),ready:true,accepted:true,installed:true}})));
 const onAccess=vi.fn();render(<LocalModelSetup ownerId={owner} onAccess={onAccess} onReady={vi.fn()}/>);
 await screen.findByText('Model setup identity changed.');expect(onAccess).not.toHaveBeenCalledWith(true);expect(screen.queryByText('Active model · ready to create')).toBeNull();
});

it('retains an unacknowledged switch key even when native readiness already matches',async()=>{
 const profile=localProfiles[1],cache=`kavero-local-setup:${owner}:q3:switch`,posts:unknown[]=[];
 localStorage.setItem(cache,JSON.stringify({key:id}));const onAccess=vi.fn();
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
  if(options.method==='POST'){posts.push(JSON.parse(options.body as string));return response({operation:{id,packageId:profile.packageId,state:'installed',error:null}});}
  return response({ownerId:owner,setup:{...snapshot,manifest:profile.manifest,accepted:true,installed:true,ready:true,switchRequired:false}});
 }));
 render(<LocalModelSetup ownerId={owner} profile={profile.profile} onAccess={onAccess} onReady={vi.fn()}/>);
 await screen.findByRole('button',{name:'Use model'});expect(localStorage.getItem(cache)).toBeTruthy();expect(onAccess).not.toHaveBeenCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'Use model'}));await screen.findByText('Active model · ready to create');
 expect(posts).toEqual([{action:'switch',key:id,packageId:profile.packageId}]);expect(localStorage.getItem(cache)).toBeNull();
});
