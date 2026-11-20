import { createAdminClient } from "@/lib/supabase/admin";
import { enabled } from "./result-service";
import { owner,RequestError } from "./service";
import { projectComputer } from "./computer-projection";
import { computerList } from "./computer-contract";
export function connectWebsiteEnabled(){try{enabled(new Request((process.env.KAVERO_CONNECT_ORIGIN??"")+"/api/connect/computers"));return true;}catch{return false;}}
export async function computersGET(request:Request){try{
 const origin=enabled(request),user=await owner(request,origin),{data,error}=await createAdminClient().rpc("connect_computers_owner",{p_owner:user,p_origin:origin});
 if(error||!data)throw Error("computer-snapshot-unavailable");if(data.error)throw new RequestError(data.error==="unauthorized"?401:503,"Computer status is unavailable.");
 if(!Array.isArray(data.computers)||data.computers.length>50)throw Error("computer-snapshot-invalid");
 const now=Date.now(),result=computerList.parse({version:1,serverTime:new Date(now).toISOString(),computers:data.computers.map((r:unknown)=>projectComputer(r,now)),ownerOutstanding:data.ownerOutstanding});
 const body=JSON.stringify(result);if(Buffer.byteLength(body)>65536)throw Error("computer-snapshot-limit");
 return new Response(body,{headers:{"Content-Type":"application/json","Cache-Control":"private, no-store"}});
 }catch(e){return Response.json({error:e instanceof RequestError?e.message:"Computer status is unavailable. Try again."},{status:e instanceof RequestError?e.status:503,headers:{"Cache-Control":"private, no-store"}});}}
