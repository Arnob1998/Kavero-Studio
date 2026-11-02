import { z } from "zod";
import { localHostRequest } from "@/modules/model-providers/local/host-bridge";
import { context } from "./service";
import { localUIEnabled } from "./readiness-service";
import { setupOperationSchema,setupSnapshotSchema } from "./setup-contract";
import {LocalSwitchError,switchManagedLocalPackage,reconcileLocalSwitch} from "@/modules/model-providers/local/runtime-switch";
const packageIds=z.enum(['qwen-2-1-internal-evaluation','qwen-2-1-q3-internal-evaluation']);
const profiles=z.enum(['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation']);
const operation = z.object({ id: z.string().uuid(), packageId: packageIds, state: z.enum(["admitted", "verifying", "starting", "installed", "cancelled", "failed", "interrupted"]), error: z.string().nullable() });
const mutation = z.discriminatedUnion("action", [
  z.object({action:z.literal("switch"),key:z.string().uuid().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i),packageId:packageIds}).strict(),
  z.object({ action: z.literal("activate"), key: z.string().uuid(), packageId: z.literal("qwen-2-1-internal-evaluation") }).strict(),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict(),
  z.object({action:z.literal("install"),key:z.string().uuid(),manifest:z.string().regex(/^[a-f0-9]{64}$/),termsDigest:z.string().regex(/^[a-f0-9]{64}$/),consentToken:z.string().regex(/^\d{13}\.[a-f0-9]{64}$/),purpose:z.literal("research-evaluation"),accepted:z.literal(true)}).strict(),
  z.object({action:z.literal("cancel-install"),id:z.string().uuid()}).strict(),
]);
function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
export async function localSetupGET(request: Request) {
  if (!localUIEnabled()) return reply({ error: "Local generation is not enabled." }, 404);
  const ctx = await context(); if (ctx.response) return ctx.response;
  const query = new URL(request.url).searchParams;
  if(query.has("view")){
    const selected=query.get('profile');
    if([...query.keys()].some(key=>!['view','profile'].includes(key))||query.getAll("view").length!==1||query.getAll('profile').length>1||(selected!==null&&!profiles.safeParse(selected).success)||!["model","terms"].includes(query.get("view")!))return reply({error:"Invalid setup request."},400);
    try{const terms=query.get("view")==="terms",result=await localHostRequest(terms?"/host/setup/terms":"/host/setup",{owner:ctx.owner,...(selected?{profile:selected}:{})});
      if(result.status!==200)return reply({error:"Local setup is unavailable."},503);
      const data=result.body as {setup:unknown;terms:unknown};
      return terms?reply({terms:z.array(z.object({name:z.string().max(100),text:z.string().max(256*1024)})).max(64).parse(data.terms)}):reply({ownerId:ctx.owner,setup:setupSnapshotSchema.parse(data.setup)});
    }catch{return reply({error:"Local setup is unavailable."},503);}
  }
  if ([...query.keys()].some(key => key !== "id") || query.getAll("id").length > 1) return reply({ error: "Invalid setup request." }, 400);
  const id = query.get("id"); if (id !== null && !z.string().uuid().safeParse(id).success) return reply({ error: "Invalid setup request." }, 400);
  try {
    const result = await localHostRequest(id ? "/host/activation" : "/host/status", id ? { id, owner: ctx.owner } : {});
    if (result.status === 404) return reply({ error: "Setup operation not found." }, 404);
    if (result.status !== 200) return reply({ error: "Local setup is unavailable." }, 503);
    if (id) return reply({ operation: await reconcileLocalSwitch(ctx.owner,operation.parse((result.body as { operation: unknown }).operation)) });
    const parsed = z.object({ state: z.string(), inferenceReady: z.boolean(), evaluationEnabled: z.boolean() }).parse(result.body);
    return reply({ ...parsed, researchEvaluationOnly: true }); // Never return secret, PID, config or filesystem paths.
  } catch { return reply({ error: "Local setup is unavailable." }, 503); }
}
export async function localSetupPOST(request: Request) {
  if (!localUIEnabled()) return reply({ error: "Local generation is not enabled." }, 404);
  const ctx = await context(); if (ctx.response) return ctx.response;
  let body: z.infer<typeof mutation>;
  try {
    const reader = request.body?.getReader();
    let bytes = Buffer.alloc(0);
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          if (bytes.length + chunk.value.byteLength > 1024) {
            await reader.cancel(); return reply({ error: "Setup request too large." }, 413);
          }
          bytes = Buffer.concat([bytes, chunk.value]);
        }
      } finally { reader.releaseLock(); }
    }
    body = mutation.parse(JSON.parse(bytes.toString("utf8")));
  }
  catch { return reply({ error: "Invalid setup request." }, 400); }
  try {
    if(body.action==="switch"){const result=await switchManagedLocalPackage(ctx.owner,body.key,body.packageId);return reply(result.body,result.status);}
    if(body.action==="install"||body.action==="cancel-install"){
      const {action,...fields}=body;
      const result=await localHostRequest(action==="install"?"/host/setup/install":"/host/setup/cancel",{...fields,owner:ctx.owner});
      if([403,404,409,429].includes(result.status))return reply({error:result.status===409?"Setup changed or is busy. Refresh and retry the same operation.":result.status===403?"This research setup is unavailable on this host.":"Setup operation is unavailable."},result.status);
      if(![200,202].includes(result.status))return reply({error:"Local setup is unavailable."},503);
      return reply({operation:setupOperationSchema.parse((result.body as {operation:unknown}).operation)},result.status);
    }
    const result = await localHostRequest(body.action === "activate" ? "/host/activate" : "/host/activation/cancel", body.action === "activate"
      ? { owner: ctx.owner, key: body.key, packageId: body.packageId } : { owner: ctx.owner, id: body.id });
    if ([403, 404, 409].includes(result.status)) return reply({ error: result.status === 404 ? "Setup operation not found." : result.status === 403 ? "This package is unavailable for managed activation." : "Local setup is busy or requires recovery." }, result.status);
    if (![200, 202].includes(result.status)) return reply({ error: "Local setup is unavailable." }, 503);
    return reply({ operation: operation.parse((result.body as { operation: unknown }).operation) }, result.status);
  } catch(error) { if(error instanceof LocalSwitchError)return reply({error:error.message},error.status);return reply({ error: "Local setup is unavailable." }, 503); }
}
