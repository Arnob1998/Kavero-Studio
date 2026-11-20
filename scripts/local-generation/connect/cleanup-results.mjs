// Server/operator only. Never ship service credentials in the PC companion.
import {createClient} from '@supabase/supabase-js';
const max=Number(process.argv[2]??10);if(!Number.isInteger(max)||max<1||max>10)throw Error('connect-cleanup-limit-invalid');
const url=(process.env.SUPABASE_INTERNAL_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw Error('connect-cleanup-server-configuration-required');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),headers={authorization:`Bearer ${key}`,apikey:key};let cleaned=0;
for(let i=0;i<max;i++){
 const {data,error}=await admin.rpc('connect_result_cleanup',{});if(error||data?.error)throw Error('connect-cleanup-claim-failed');const row=data.result;if(!row)break;
 if(!/^connect-results\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/final\.png$/.test(row.object_key))throw Error('connect-cleanup-key-invalid');
 const endpoint=url+'/storage/v1/object/kavero-connect-results';
 const removed=await fetch(endpoint,{method:'DELETE',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({prefixes:[row.object_key]}),redirect:'error',signal:AbortSignal.timeout(15000)});await removed.body?.cancel();if(!removed.ok)throw Error('connect-cleanup-delete-failed');
 const check=await fetch(endpoint+'/'+row.object_key,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});const text=check.ok?'':await check.text();if(check.ok)await check.body?.cancel();
 if(check.status!==404&&!(check.status===400&&text.length<4096&&/"(?:statusCode|status)"\s*:\s*"?404/.test(text)))throw Error('connect-cleanup-delete-unconfirmed');
 const done=await admin.rpc('connect_result_cleanup',{p_job:row.job_id,p_token:row.cleanup_token});if(done.error||done.data?.error)throw Error('connect-cleanup-checkpoint-failed');cleaned++;
}
console.log(JSON.stringify({cleaned}));
