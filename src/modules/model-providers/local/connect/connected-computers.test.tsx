import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup,within} from "@testing-library/react";
import {ConnectedComputers} from "./connected-computers";
import {computerLabels,type Computer} from './computer-contract';
const owner="110fce0e-22ba-4a44-a68a-6619b477ca1b",id="44697489-d22b-432b-818b-155f201cc52d",device="55697489-d22b-432b-818b-155f201cc52d",installation="66697489-d22b-432b-818b-155f201cc52d";
const code="0123456789abcdef01234567",hash="a".repeat(64),fetcher=vi.fn();
let p:Record<string,unknown>,computers:unknown[];
beforeEach(()=>{sessionStorage.clear();computers=[];p={id,name:"My PC",origin:"https://kavero.test",state:"pending",expiresAt:new Date(Date.now()+300000).toISOString(),installationId:null,fingerprint:null,deviceId:null};vi.stubGlobal("fetch",fetcher);fetcher.mockImplementation(async(url:string,options:RequestInit)=>{
 const body=options?.body?JSON.parse(String(options.body)):null;
 if(body?.action==="confirm")p={...p,state:"confirmed"};if(body?.action==="cancel")p={...p,state:"cancelled"};
 return {ok:true,json:async()=>url.endsWith("computers")?{version:1,serverTime:new Date().toISOString(),computers,ownerOutstanding:0}:url.includes("pairings")?{version:1,pairing:p,...(body?.action==="create"?{code}:{})}:{ok:true}};
});});afterEach(()=>{cleanup();vi.unstubAllGlobals();fetcher.mockReset();});
it("shows empty state with no automatic pairing or fake installer",async()=>{render(<ConnectedComputers ownerId={owner}/>);await screen.findByText("No computers connected");fireEvent.click(screen.getByText("Get or open Kavero Connect"));expect(screen.getByText(/public installer is not available/)).toBeVisible();expect(fetcher.mock.calls.every(c=>c[1].method==="GET")).toBe(true);expect(screen.queryByRole("link",{name:/download/i})).not.toBeInTheDocument();});
it('explains pairing before any mutation and shows remote hardware/model state without granting compatibility',async()=>{
 render(<ConnectedComputers ownerId={owner}/>);
 await screen.findByText('Get a connection code');
 expect(screen.getByText('Open Kavero Connect')).toBeVisible();
 expect(screen.getByText('Confirm your computer')).toBeVisible();
 expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
});
it('filters multiple computers locally while preserving their reported readiness and hardware',async()=>{
 computers=[{id:device,name:'Studio PC',status:'ready',lastSeenAt:null,model:{profile:'qwen',label:'Qwen Image'},capability:null,outstanding:0,hardware:{ramMiB:32768,gpus:[{label:'RTX 4090',vramMiB:24576}]}},{id:installation,name:'Laptop',status:'offline',lastSeenAt:null,model:null,capability:null,outstanding:0,hardware:null}];
 render(<ConnectedComputers ownerId={owner}/>);
 await screen.findByRole('combobox',{name:'Remote computer'});
 const studio=screen.getByRole('article',{name:'Studio PC'});
 expect(within(studio).getByText('Qwen Image')).toBeVisible();
 expect(within(studio).getByText('RTX 4090 · 24 GB VRAM · 32 GB RAM')).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'Remote computer'}),{target:{value:installation}});
 expect(screen.queryByRole('article',{name:'Studio PC'})).toBeNull();
 expect(within(screen.getByRole('article',{name:'Laptop'})).getByRole('status')).toHaveTextContent('Offline');
 fireEvent.change(screen.getByRole('combobox',{name:'Remote computer'}),{target:{value:''}});
 expect(screen.getByRole('article',{name:'Studio PC'})).toBeVisible();
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
});
it.each(Object.keys(computerLabels) as Computer['status'][])('keeps %s distinct and offers adding another computer only while a pairing is retained',async status=>{
 computers=[{id:device,name:'Desk PC',status,lastSeenAt:null,model:null,capability:null,outstanding:0,hardware:null}];render(<ConnectedComputers ownerId={owner}/>);
 await screen.findByText(computerLabels[status]);const ended=['revoked','expired'].includes(status);
 expect(screen.getByRole('button',{name:ended?'Connect computer':'Add another computer'})).toBeEnabled();
 if(!ended){expect(screen.queryByRole('button',{name:'Connect computer'})).toBeNull();expect(screen.getByRole('button',{name:'Disconnect Desk PC'})).toBeVisible();}
 expect(fetcher.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});
it("stores only pending ID and keeps the connection code out of recovery storage",async()=>{render(<ConnectedComputers ownerId={owner}/>);await screen.findByText("No computers connected");fireEvent.click(screen.getByRole("button",{name:"Connect computer"}));fireEvent.click(screen.getByRole("button",{name:"Get connection code"}));await screen.findByText("Enter this code in Kavero Connect");expect(sessionStorage.getItem(`kavero-connect-pending:${owner}`)).toBe(id);expect(JSON.stringify({...sessionStorage})).not.toContain(code);expect(screen.getByText("0123-4567-89ab-cdef-0123-4567")).toBeVisible();});
it("recovers claimed pairing and requires explicit matching fingerprint",async()=>{sessionStorage.setItem(`kavero-connect-pending:${owner}`,id);p={...p,state:"claimed",installationId:installation,fingerprint:hash,deviceId:device};render(<ConnectedComputers ownerId={owner}/>);await screen.findByText("Confirm your computer");const confirm=screen.getByRole("button",{name:"Confirm computer"});expect(confirm).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(confirm);await screen.findByText("My PC connected");const command=fetcher.mock.calls.find(c=>c[1]?.body&&JSON.parse(c[1].body).action==="confirm");expect(JSON.parse(command![1].body)).toEqual({action:"confirm",id,installationId:installation,fingerprint:hash});expect(sessionStorage.getItem(`kavero-connect-pending:${owner}`)).toBeNull();});
it("refresh recovery hides code and can cancel the same pending pairing",async()=>{sessionStorage.setItem(`kavero-connect-pending:${owner}`,id);render(<ConnectedComputers ownerId={owner}/>);await screen.findByText(/code is hidden after refresh/);fireEvent.click(screen.getByRole("button",{name:"Cancel connection"}));await waitFor(()=>expect(sessionStorage.getItem(`kavero-connect-pending:${owner}`)).toBeNull());expect(fetcher.mock.calls.some(c=>c[1]?.body&&JSON.parse(c[1].body).action==="create")).toBe(false);});
it("shows distinct offline state and makes rename/revoke explicit",async()=>{computers=[{id:device,name:"Studio PC",status:"offline",lastSeenAt:null,model:null,capability:null,outstanding:0,hardware:null}];render(<ConnectedComputers ownerId={owner}/>);await screen.findByText("Offline");fireEvent.click(screen.getByRole("button",{name:"Settings for Studio PC"}));fireEvent.click(screen.getByRole("button",{name:"Rename Studio PC"}));fireEvent.change(screen.getByRole("textbox",{name:"New computer name"}),{target:{value:"Desk PC"}});fireEvent.click(screen.getByRole("button",{name:"Save name"}));await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.body&&JSON.parse(c[1].body).name==="Desk PC")).toBe(true));await waitFor(()=>expect(screen.getByRole("button",{name:"Disconnect Studio PC"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"Disconnect Studio PC"}));expect(screen.getByText(/may finish work already accepted/)).toBeVisible();expect(fetcher.mock.calls.some(c=>c[1]?.body&&JSON.parse(c[1].body).action==="revoke")).toBe(false);fireEvent.click(screen.getByRole("button",{name:"Confirm disconnect"}));await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.body&&JSON.parse(c[1].body).action==="revoke")).toBe(true));});
it("owner change does not reuse another owner's pending pairing",async()=>{sessionStorage.setItem(`kavero-connect-pending:${owner}`,id);const view=render(<ConnectedComputers ownerId={owner}/>);await screen.findByText(/code is hidden after refresh/);view.rerender(<ConnectedComputers ownerId={device}/>);await screen.findByText("No computers connected");expect(screen.queryByText(/code is hidden after refresh/)).not.toBeInTheDocument();});
it("fails unavailable snapshots closed instead of showing stale ready controls",async()=>{fetcher.mockRejectedValue(Error("offline"));render(<ConnectedComputers ownerId={owner}/>);await screen.findByRole("alert");expect(screen.getByRole("button",{name:"Connect computer"})).toBeDisabled();});
it("a changed claimed identity invalidates a previously checked fingerprint",async()=>{sessionStorage.setItem(`kavero-connect-pending:${owner}`,id);p={...p,state:"claimed",installationId:installation,fingerprint:hash,deviceId:device};render(<ConnectedComputers ownerId={owner}/>);await screen.findByText("Confirm your computer");fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:"Confirm computer"})).toBeEnabled();p={...p,fingerprint:"b".repeat(64)};fireEvent(document,new Event("visibilitychange"));await screen.findByText("b".repeat(64));expect(screen.getByRole("button",{name:"Confirm computer"})).toBeDisabled();expect(screen.getByRole("checkbox")).not.toBeChecked();});
