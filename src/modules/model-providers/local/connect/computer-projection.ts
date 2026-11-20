import { z } from "zod";
import { canonicalSnapshot,jobSnapshotForProfile } from "../job-snapshot";
import { deliveryBinding,deviceCommand } from "./contracts";
import { digest } from "./protocol";
import type {Computer} from "./computer-contract";
const row=z.object({id:z.string().uuid(),name:z.string().min(1).max(60),expires_at:z.string(),revoked_at:z.string().nullable(),last_seen_at:z.string().nullable(),report:z.unknown(),binding:z.unknown(),binding_hash:z.string().nullable(),binding_at:z.string().nullable(),seen_at:z.string().nullable(),outstanding:z.number().int().min(0).max(1000)});
const bound=deliveryBinding.extend({execute:z.literal(true),recipeSnapshot:z.unknown()}).strict();
const report=deviceCommand.options[0].shape.report;
export function projectComputer(value:unknown,now=Date.now()):Computer{
 const r=row.parse(value),recent=(v:string|null)=>!!v&&Date.parse(v)<=now+60000&&Date.parse(v)>now-150000;
 let status:Computer["status"]="not-ready",model:Computer["model"]=null,capability:Computer["capability"]=null;
 const hardware=report.safeParse(r.report);
 if(r.revoked_at)status="revoked";
 else if(!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=now)status="expired";
 else if(!recent(r.last_seen_at))status="offline";
 else if(recent(r.seen_at)&&recent(r.binding_at)){
  const parsed=bound.safeParse(r.binding);
  if(parsed.success){const b=parsed.data,expected=jobSnapshotForProfile(b.profile);
   if(canonicalSnapshot(b.recipeSnapshot)===canonicalSnapshot(expected)&&r.binding_hash===digest(canonicalSnapshot(b))){
    model={profile:expected.profile,label:expected.label};
    if(b.maintenance)status="maintenance";else if(!b.permission)status="permission-needed";
    else{status=r.outstanding>0?"busy":"ready";capability={bindingHash:r.binding_hash,width:512,height:512,count:1,promptLimit:1000};}
   }
  }
 }
 return {id:r.id,name:r.name,status,lastSeenAt:r.last_seen_at,model,capability,outstanding:r.outstanding,
  hardware:hardware.success&&!r.revoked_at&&status!=="expired"?{ramMiB:hardware.data.ramMiB,gpus:hardware.data.gpus}:null};
}
