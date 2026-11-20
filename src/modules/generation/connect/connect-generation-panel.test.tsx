import {render,screen,fireEvent,waitFor,cleanup,within,act} from "@testing-library/react";
import {StrictMode} from "react";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {ConnectGenerationPanel} from "./connect-generation-panel";
const mocks=vi.hoisted(()=>({listener:vi.fn(),unsubscribe:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:(callback:unknown)=>{mocks.listener(callback);return {data:{subscription:{unsubscribe:mocks.unsubscribe}}};}}})}));
const owner="11111111-1111-4111-8111-111111111111",device="22222222-2222-4222-8222-222222222222",key="33333333-3333-4333-8333-333333333333",id="44444444-4444-4444-8444-444444444444";
const profile="qwen-image-2.1-q4-evaluation",storageKey=()=>`kavero-connect-job:${location.origin}:${owner}`;
const pc={id:device,name:"Desk PC",status:"ready",model:{profile,label:"Q4"},capability:{bindingHash:"a".repeat(64),width:512,height:512,count:1,promptLimit:1000},lastSeenAt:null,outstanding:0,hardware:null};
const snapshot={version:1,serverTime:new Date().toISOString(),computers:[pc],ownerOutstanding:0};
const pending=()=>({version:1,owner,origin:location.origin,computerName:"Desk PC",modelLabel:"Q4",submission:{action:"create",deviceId:device,key,bindingHash:"a".repeat(64),profile,execute:true,prompt:"A vase"}});
const job=(state="running")=>({id,deviceId:device,key,state,cancelRequested:false,version:1,payload:{execute:true,intent:{profile,prompt:"A vase"}}});
const reply=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status}));
let creates:unknown[];
beforeEach(()=>{localStorage.clear();creates=[];vi.clearAllMocks();Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(_key:string,fn:()=>Promise<void>)=>fn()}});vi.stubGlobal("fetch",vi.fn((url:string,options:RequestInit)=>{
 if(url.endsWith("computers"))return reply(snapshot);
 if(url.endsWith("jobs")){const body=JSON.parse(options.body as string);if(body.action==="create")creates.push(body);return reply({job:{...job(),key:body.key??key}});}
 return reply({save:{state:"available"}},404);
}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const mount=(prompt="A vase")=>render(<ConnectGenerationPanel ownerId={owner} prompt={prompt} onPromptChange={vi.fn()}/>);
async function select(){await screen.findByRole("option",{name:"Desk PC · Ready"});fireEvent.change(screen.getByRole("combobox"),{target:{value:device}});}
it("loads computers after Strict Mode aborts the first mount request",async()=>{
 let requests=0,aborted=false,rejectFirst:(error:Error)=>void=()=>{};
 vi.stubGlobal("fetch",vi.fn((_url:string,options:RequestInit)=>{
  requests++;
  if(requests===1)return new Promise((_resolve,reject)=>{rejectFirst=reject;options.signal?.addEventListener("abort",()=>{aborted=true;},{once:true});});
  return reply(snapshot);
 }));
 render(<StrictMode><ConnectGenerationPanel ownerId={owner} prompt="A vase" onPromptChange={vi.fn()}/></StrictMode>);
 await screen.findByRole("option",{name:"Desk PC · Ready"});
 expect(aborted).toBe(true);
 await act(async()=>rejectFirst(new DOMException("signal is aborted without reason","AbortError")));
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(creates).toHaveLength(0);
});
it("ignores late snapshots and auth callbacks from the cleaned-up mount",async()=>{
 let requests=0,resolveFirst:(response:Response)=>void=()=>{};
 vi.stubGlobal("fetch",vi.fn(()=>++requests===1?new Promise(resolve=>{resolveFirst=resolve;}):reply(snapshot)));
 render(<StrictMode><ConnectGenerationPanel ownerId={owner} prompt="A vase" onPromptChange={vi.fn()}/></StrictMode>);
 await screen.findByRole("option",{name:"Desk PC · Ready"});
 await act(async()=>{resolveFirst(new Response(JSON.stringify({...snapshot,computers:[{...pc,name:"Old snapshot",status:"offline"}]})));});
 expect(screen.queryByRole("option",{name:"Old snapshot · Offline"})).not.toBeInTheDocument();
 act(()=>mocks.listener.mock.calls[0][0]("SIGNED_OUT",null));
 fireEvent.change(screen.getByRole("combobox"),{target:{value:device}});
 expect(screen.getByRole("button",{name:"Create image"})).toBeEnabled();
 expect(creates).toHaveLength(0);
});
it("requires an explicit ready computer and preserves overlong prompts",async()=>{mount("x".repeat(1001));await select();expect(screen.getByRole("button",{name:"Create image"})).toBeDisabled();expect(screen.getByRole("textbox")).toHaveValue("x".repeat(1001));expect(creates).toHaveLength(0);});
it("persists before admission and reuses a lost acknowledgement",async()=>{let first=true;vi.stubGlobal("fetch",vi.fn((url:string,options:RequestInit)=>{if(url.endsWith("computers"))return reply(snapshot);const body=JSON.parse(options.body as string);if(body.action==="create"){expect(localStorage.getItem(storageKey())).toContain(body.key);creates.push(body);if(first){first=false;return Promise.reject(Error("lost acknowledgement"));}return reply({job:{...job(),key:body.key}});}return reply({job:job()});}));mount();await select();fireEvent.click(screen.getByRole("button",{name:"Create image"}));await screen.findByText("lost acknowledgement");fireEvent.click(screen.getByRole("button",{name:"Reconnect to job"}));await waitFor(()=>expect(creates).toHaveLength(2));expect(creates[0]).toEqual(creates[1]);expect(screen.getByRole("textbox")).toBeDisabled();});
it("restores the original request and another tab cannot retarget it",async()=>{localStorage.setItem(storageKey(),JSON.stringify(pending()));mount("Changed prompt");await waitFor(()=>expect(creates).toHaveLength(1));expect(creates[0]).toMatchObject({key,deviceId:device,prompt:"A vase"});expect(screen.getByRole("textbox")).toHaveValue("A vase");expect(screen.queryByRole("combobox")).not.toBeInTheDocument();});
it("rejects changed server identity",async()=>{localStorage.setItem(storageKey(),JSON.stringify(pending()));vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("computers")?reply(snapshot):reply({job:{...job(),deviceId:owner}})));mount();await screen.findByText(/job identity changed/);expect(screen.queryByRole("button",{name:"New image"})).not.toBeInTheDocument();});
it("blocks requests after an account change and clears old browser state",async()=>{localStorage.setItem(storageKey(),JSON.stringify({...pending(),jobId:id}));mount();await screen.findByText(/Creating on your computer/);const callback=mocks.listener.mock.calls[0][0];callback("SIGNED_OUT",null);await waitFor(()=>expect(localStorage.getItem(storageKey())).toBeNull());expect(screen.getByRole("button",{name:"Create image"})).toBeDisabled();});
it("keeps generated distinct from transferred and saved",async()=>{localStorage.setItem(storageKey(),JSON.stringify({...pending(),jobId:id}));vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("computers")?reply(snapshot):url.endsWith("jobs")?reply({job:job("generated-unvalidated")}):url.endsWith("/save")?reply({save:{state:"saved",historyRemoved:true,generationId:key,imageId:id}}):reply({error:"not-yet"},409)));mount();await screen.findByText(/removed from Gallery/);expect(screen.queryByText("Download PNG")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Save to Gallery"})).not.toBeInTheDocument();});
it("allows clearing only definitively unadmitted requests",async()=>{localStorage.setItem(storageKey(),JSON.stringify(pending()));vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("computers")?reply(snapshot):reply({error:"binding-unavailable"},409)));mount();await screen.findByRole("button",{name:"New image"});expect(JSON.parse(localStorage.getItem(storageKey())!).notAdmitted).toBe(true);fireEvent.click(screen.getByRole("button",{name:"New image"}));await waitFor(()=>expect(localStorage.getItem(storageKey())).toBeNull());});
it("serializes simultaneous tab intent creation into one immutable key",async()=>{
 let queue=Promise.resolve();Object.defineProperty(navigator,"locks",{configurable:true,value:{request:(_key:string,fn:()=>Promise<void>)=>{const next=queue.then(fn);queue=next;return next;}}});
 mount();mount();const panels=screen.getAllByRole("region",{name:"My computer generation"});
 await waitFor(()=>expect(within(panels[0]).getByRole("option",{name:"Desk PC · Ready"})).toBeInTheDocument());
 for(const panel of panels){fireEvent.change(within(panel).getByRole("combobox"),{target:{value:device}});fireEvent.click(within(panel).getByRole("button",{name:"Create image"}));}
 await waitFor(()=>expect(creates.length).toBeGreaterThan(0));await waitFor(()=>expect(screen.getAllByRole("textbox").every(e=>e.hasAttribute("disabled"))).toBe(true));
 expect(new Set(creates.map(value=>(value as {key:string}).key)).size).toBe(1);
});
it("cancels only the original job and keeps its receipt until terminal",async()=>{localStorage.setItem(storageKey(),JSON.stringify({...pending(),jobId:id}));mount();await screen.findByText(/Creating on your computer/);fireEvent.click(screen.getByRole("button",{name:"Cancel original job"}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([,options])=>options?.body&&JSON.parse(options.body as string).action==="cancel")).toBe(true));expect(JSON.parse(localStorage.getItem(storageKey())!).jobId).toBe(id);expect(screen.queryByRole("button",{name:"New image"})).not.toBeInTheDocument();});
it("retries saving independently while retaining download and original attribution",async()=>{
 localStorage.setItem(storageKey(),JSON.stringify({...pending(),jobId:id}));let saves=0;
 vi.stubGlobal("fetch",vi.fn((url:string,options:RequestInit)=>{
  if(url.endsWith("computers"))return reply(snapshot);
  if(url.endsWith("jobs"))return reply({job:job("generated-unvalidated")});
  if(url.endsWith("/status"))return reply({result:{jobId:id,state:"available",expiresAt:new Date(Date.now()+60000).toISOString(),sha256:"f".repeat(64),sizeBytes:128,width:512,height:512,mimeType:"image/png"}});
  if(url.endsWith("/save")){if(options?.method==="POST"){saves++;return saves===1?reply({error:"disk temporary failure"},503):reply({save:{state:"saved",generationId:key,imageId:id}});}return reply({save:{state:"available"}});}
  return reply({error:"preview unavailable"},503);
 }));mount();await screen.findByRole("link",{name:"Download PNG"});fireEvent.click(screen.getByRole("button",{name:"Save to Gallery"}));await screen.findByRole("button",{name:"Retry saving"});expect(screen.getByRole("link",{name:"Download PNG"})).toHaveAttribute("href",`/api/connect/results/${id}`);fireEvent.click(screen.getByRole("button",{name:"Retry saving"}));await screen.findByText("Saved to Gallery.");expect(saves).toBe(2);expect(creates).toHaveLength(0);
});
