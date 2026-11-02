import {z} from "zod";
import {createClient} from "@/lib/supabase/server";
import {localGenerationUIEnabled} from "./enabled";
import {localHostRequest} from "./host-bridge";
import {hubSource as source,hubModel as model,hubLicense as license,hubSnapshot as snapshot,hubList} from "./model-hub-contract";
const submission=z.object({key:z.string().uuid(),model:source.strict()}).strict();
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
async function ownerContext(){
 if(!localGenerationUIEnabled())return {response:reply({error:"Local models are not enabled."},404)};
 const client=await createClient(),{data:{user},error}=await client.auth.getUser();
 if(error||!user)return {response:reply({error:"Sign in to manage local models."},401)};
 return {owner:user.id};
}
async function forward(path:string,body:unknown){
 try{
  const result=await localHostRequest(path,body);
  if([400,404,409,429].includes(result.status))return reply({error:result.status===429?"Model inspection is busy or the import limit was reached.":result.status===409?"The submission changed or the host is stopping. Retry the original submission.":result.status===404?"Model import not found.":"Invalid model import."},result.status);
  if(![200,202].includes(result.status))throw Error("host-unavailable");
  const schema=path.endsWith('/list')?hubList:
   path.endsWith('/detail')?z.object({model,snapshot}):path.endsWith('/license')?z.object({license}):z.object({model});
  return reply(schema.parse(result.body),result.status);
 }catch{return reply({error:"Local model management is unavailable. Check the managed host and retry."},503);}
}
export async function modelImportsPOST(request:Request){
 const ctx=await ownerContext();if(ctx.response)return ctx.response;
 let input:z.infer<typeof submission>;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error('missing-body');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply({error:"Model request too large."},413);}chunks.push(value);}}finally{reader.releaseLock();}
  input=submission.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
 }catch{return reply({error:"Invalid model import."},400);}
 return forward('/host/models/import',{...input,owner:ctx.owner});
}
export async function modelImportsGET(request:Request){
 const ctx=await ownerContext();if(ctx.response)return ctx.response;
 const query=new URL(request.url).searchParams;
 if([...query.keys()].some(k=>!['id','component','offset'].includes(k))||[...query.keys()].some(k=>query.getAll(k).length!==1))return reply({error:"Invalid model query."},400);
 const id=query.get('id'),component=query.get('component');
 if(id!==null){
  if(!z.string().uuid().safeParse(id).success||query.has('offset')||(component!==null&&!['model','engine','image-weights','text-encoder','vae'].includes(component)))return reply({error:"Invalid model query."},400);
  return forward(component===null?'/host/models/detail':'/host/models/license',{owner:ctx.owner,id,...(component!==null?{component}:{})});
 }
 if(component!==null||!/^\d{1,3}$/.test(query.get('offset')??'0')||Number(query.get('offset')??0)>100)return reply({error:"Invalid model query."},400);
 return forward('/host/models/list',{owner:ctx.owner,offset:Number(query.get('offset')??0)});
}
