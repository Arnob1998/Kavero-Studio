// @vitest-environment node
import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import {projectComputer} from "./computer-projection";
import {canonicalSnapshot,existingJobSnapshot} from "../job-snapshot";
import {digest} from "./protocol";
const now=Date.now(),stamp=new Date(now).toISOString();
function fixture(){const binding={profile:"qwen-image-2.1-q4-evaluation",workerEpoch:randomUUID(),ledgerIdentity:randomUUID(),executionDevice:"a".repeat(64),permission:true,maintenance:false,execute:true,recipeSnapshot:existingJobSnapshot()};return {id:randomUUID(),name:"My PC",expires_at:new Date(now+86400000).toISOString(),revoked_at:null as string|null,last_seen_at:stamp,report:{platform:"win32",arch:"x64",node:"24.11.1",ramMiB:32768,gpus:[{label:"Reported GPU",vramMiB:16384}]},binding,binding_hash:digest(canonicalSnapshot(binding)),binding_at:stamp,seen_at:stamp,outstanding:0};}
describe("website computer readiness",()=>{
 it("exposes only accepted capabilities and no proof/worker identities",()=>{const r=fixture(),c=projectComputer(r,now);expect(c.status).toBe("ready");expect(c.capability).toMatchObject({width:512,height:512,count:1,promptLimit:1000});const text=JSON.stringify(c);for(const secret of [r.binding.workerEpoch,r.binding.ledgerIdentity,r.binding.executionDevice])expect(text).not.toContain(secret);expect(c.hardware?.gpus[0].vramMiB).toBe(16384);});
 it.each(["last_seen_at","binding_at","seen_at"])("stale %s cannot enable generation",field=>{const r=fixture();Object.assign(r,{[field]:new Date(now-151000).toISOString()});expect(projectComputer(r,now).capability).toBeNull();});
 it("does not confuse online identity with verified execution",()=>{const r=fixture();Object.assign(r,{binding:null});expect(projectComputer(r,now).status).toBe("not-ready");});
 it("rejects changed recipe and hash rather than granting generic hardware readiness",()=>{const r=fixture();r.binding.recipeSnapshot.settings.width=1024;r.binding_hash=digest(canonicalSnapshot(r.binding));expect(projectComputer(r,now).capability).toBeNull();const original=fixture();original.binding_hash="f".repeat(64);expect(projectComputer(original,now).status).toBe("not-ready");});
 it.each(["permission","maintenance"])("keeps %s separate from connectivity",field=>{const r=fixture();Object.assign(r.binding,{[field]:field==="maintenance"});r.binding_hash=digest(canonicalSnapshot(r.binding));const c=projectComputer(r,now);expect(c.status).toBe(field==="permission"?"permission-needed":"maintenance");expect(c.capability).toBeNull();});
 it("displays busy independently of exact queueable capability",()=>{const r=fixture();r.outstanding=2;expect(projectComputer(r,now)).toMatchObject({status:"busy",outstanding:2,capability:{count:1}});});
 it("revoked and expired credentials cannot expose a current ready capability",()=>{const r=fixture();r.revoked_at=stamp;expect(projectComputer(r,now)).toMatchObject({status:"revoked",capability:null,hardware:null});r.revoked_at=null;r.expires_at=stamp;expect(projectComputer(r,now).status).toBe("expired");});
 it("rejects protocol-only execute mode",()=>{const r=fixture();Object.assign(r.binding,{execute:false});r.binding_hash=digest(canonicalSnapshot(r.binding));expect(projectComputer(r,now).capability).toBeNull();});
});
