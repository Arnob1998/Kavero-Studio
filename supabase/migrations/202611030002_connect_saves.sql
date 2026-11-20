-- Connect save receipts intentionally do not reference Gallery rows: deletion is final.
begin;
create table public.connect_saves (
 job_id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade, origin text not null,
 generation_id uuid not null unique default gen_random_uuid(), image_id uuid not null unique default gen_random_uuid(),
 sha256 text not null, descriptor jsonb not null, payload jsonb not null, destination jsonb not null, object_mapping jsonb,
 state text not null default 'saving' check(state in ('saving','save-failed','saved')),
 attempt_token uuid not null, lease_until timestamptz not null default now()+interval '120 seconds',
 created_at timestamptz not null default now()
);
alter table public.connect_saves enable row level security;
revoke all on public.connect_saves from public,anon,authenticated;
grant all on public.connect_saves to service_role;
create function public.connect_save_frozen() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.job_id,new.owner_id,new.origin,new.generation_id,new.image_id,new.sha256,new.descriptor,new.payload,new.destination,new.created_at)
 is distinct from (old.job_id,old.owner_id,old.origin,old.generation_id,old.image_id,old.sha256,old.descriptor,old.payload,old.destination,old.created_at)
 or (old.object_mapping is not null and new.object_mapping is distinct from old.object_mapping)
 or (old.state='saved' and new is distinct from old) then raise exception 'immutable-connect-save'; end if;
 return new;
end $$;
create trigger connect_save_immutable before update on public.connect_saves for each row execute function public.connect_save_frozen();

create function public.connect_save_owner(p_owner uuid,p_origin text,p_job uuid,p_action text,
 p_token uuid default null,p_destination jsonb default null,p_mapping jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s connect_saves; r connect_results; j connect_jobs; image_ref jsonb; meta_ref jsonb; base text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,97212));
 perform 1 from auth.users where id=p_owner for key share;
 if not found then return jsonb_build_object('error','not-found'); end if;
 select * into j from connect_jobs where id=p_job and owner_id=p_owner and origin=p_origin for update;
 select * into r from connect_results where job_id=p_job and owner_id=p_owner and origin=p_origin for update;
 select * into s from connect_saves where job_id=p_job and owner_id=p_owner and origin=p_origin for update;
 if s.state='saved' then return jsonb_build_object('save',to_jsonb(s),'historyRemoved',not exists(select 1 from generated_images where id=s.image_id and user_id=p_owner)); end if;
 if j.id is null or r.job_id is null then return jsonb_build_object('error','not-found'); end if;
 if j.payload->>'execute' is distinct from 'true' or j.state<>'generated-unvalidated' or j.cancel_requested
 or r.validated_at is null or r.descriptor->>'requestHash' is distinct from j.payload->>'hash'
 then return jsonb_build_object('error','result-unavailable'); end if;
 if p_action='inspect' then return jsonb_build_object('save',case when s.job_id is null then null else to_jsonb(s) end); end if;
 if p_action='claim' then
  if p_token is null or p_destination->>'provider' is distinct from 'kavero-managed'
   or p_destination->>'backendId' is distinct from 'supabase-storage' or coalesce(p_destination->>'location','')='' then return jsonb_build_object('error','destination-invalid'); end if;
  if s.job_id is null then
   if r.state<>'available' or r.expires_at<=clock_timestamp() then return jsonb_build_object('error','expired'); end if;
   insert into connect_saves(job_id,owner_id,origin,sha256,descriptor,payload,destination,attempt_token)
    values(p_job,p_owner,p_origin,r.descriptor->>'sha256',r.descriptor,j.payload,p_destination,p_token) returning * into s;
  else
   if s.destination is distinct from p_destination then return jsonb_build_object('error','destination-changed'); end if;
   if s.descriptor is distinct from r.descriptor or s.payload is distinct from j.payload then return jsonb_build_object('error','identity-conflict'); end if;
   if s.state<>'saving' or s.lease_until<=clock_timestamp() then
    update connect_saves set state='saving',attempt_token=p_token,lease_until=clock_timestamp()+interval '120 seconds' where job_id=p_job returning * into s;
   end if;
  end if;
 else
  if s.job_id is null or s.state<>'saving' or s.attempt_token is distinct from p_token or s.lease_until<=clock_timestamp() then return jsonb_build_object('error','lease-expired'); end if;
  if s.descriptor is distinct from r.descriptor or s.payload is distinct from j.payload then return jsonb_build_object('error','identity-conflict'); end if;
  if p_action='source' then
   if r.state<>'available' or r.expires_at<=clock_timestamp() then return jsonb_build_object('error','expired'); end if;
   return jsonb_build_object('save',to_jsonb(s),'result',to_jsonb(r));
  elsif p_action='renew' then
   update connect_saves set lease_until=clock_timestamp()+interval '120 seconds' where job_id=p_job returning * into s;
  elsif p_action='fail' then
   update connect_saves set state='save-failed' where job_id=p_job returning * into s;
  elsif p_action='mapping' then
   base='users/'||p_owner||'/connect-generated/'||s.generation_id||'/'||s.image_id;
   image_ref=p_mapping->'imageRef'; meta_ref=p_mapping->'metadataRef';
   if s.object_mapping is not null and s.object_mapping is distinct from p_mapping then return jsonb_build_object('error','immutable-mapping'); end if;
   if image_ref->>'providerId' is distinct from 'kavero-managed' or meta_ref->>'providerId' is distinct from 'kavero-managed'
    or image_ref->>'kind' is distinct from 'managed' or meta_ref->>'kind' is distinct from 'managed'
    or image_ref->>'purpose' is distinct from 'generated-image' or meta_ref->>'purpose' is distinct from 'generated-metadata'
    or image_ref->>'bucket' is distinct from 'kavero-generated-images' or meta_ref->>'bucket' is distinct from 'kavero-generated-metadata'
    or image_ref->>'objectKey' is distinct from base||'.png' or image_ref->>'path' is distinct from base||'.png'
    or meta_ref->>'objectKey' is distinct from base||'.json' or meta_ref->>'path' is distinct from base||'.json'
    or image_ref->'metadata'->>'backendProviderId' is distinct from 'supabase-storage' or meta_ref->'metadata'->>'backendProviderId' is distinct from 'supabase-storage'
    or p_mapping->>'metadataBody' is null or octet_length(p_mapping->>'metadataBody')>16384 then return jsonb_build_object('error','mapping-invalid'); end if;
   update connect_saves set object_mapping=p_mapping where job_id=p_job returning * into s;
  elsif p_action='finish' then
   if s.object_mapping is null or s.destination is distinct from p_destination then return jsonb_build_object('error','destination-changed'); end if;
   image_ref=s.object_mapping->'imageRef'; meta_ref=s.object_mapping->'metadataRef';
   insert into generation_runs(id,user_id,prompt,model_id,model_label,settings,generated_text,reference_images,storage_provider,created_at)
    values(s.generation_id,p_owner,s.payload->'intent'->>'prompt',s.payload->'recipeSnapshot'->>'recipeId',s.payload->'recipeSnapshot'->>'label',
     (s.payload->'recipeSnapshot'->'settings')||jsonb_build_object('connectJobId',p_job,'packageFingerprint',s.descriptor->>'packageFingerprint','recipeSnapshot',s.payload->'recipeSnapshot'),null,'[]','kavero-managed',s.created_at);
   insert into generated_images(id,user_id,generation_id,variant,mime_type,drive_status,storage_provider,storage_kind,storage_status,storage_ref,metadata_storage_ref,storage_metadata,created_at)
    values(s.image_id,p_owner,s.generation_id,1,'image/png','available','kavero-managed','managed','available',image_ref,meta_ref,
     jsonb_build_object('providerId','kavero-managed','backendProviderId','supabase-storage','imageObjectName',image_ref->'metadata'->>'name','metadataObjectName',meta_ref->'metadata'->>'name','connectJobId',p_job,'sha256',s.sha256),s.created_at);
   update connect_saves set state='saved' where job_id=p_job returning * into s;
  else return jsonb_build_object('error','invalid-action'); end if;
 end if;
 return jsonb_build_object('save',to_jsonb(s));
end $$;

-- Signed companion queries use the same device nonce/rate budget as transfer.
create function public.connect_save_device(p_id uuid,p_origin text,p_key text,p_nonce uuid,p_job uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; r connect_results; s connect_saves; own uuid;
begin
 select owner_id into own from connect_devices where id=p_id;
 if own is null then return jsonb_build_object('error','unauthorized'); end if;
 perform pg_advisory_xact_lock(hashtextextended(own::text,97212));
 select * into d from connect_devices where id=p_id and origin=p_origin for update;
 if not found or d.public_key<>p_key or d.revoked_at is not null or d.expires_at<=clock_timestamp() or not exists(select 1 from auth.users where id=own) then return jsonb_build_object('error','unauthorized'); end if;
 if not connect_rate('device:'||p_id,30,60) then return jsonb_build_object('error','rate-limited'); end if;
 delete from connect_nonces where device_id=p_id and expires_at<now();
 if p_nonce is null or exists(select 1 from connect_nonces where device_id=p_id and nonce=p_nonce) then return jsonb_build_object('error','replay'); end if;
 insert into connect_nonces(device_id,nonce) values(p_id,p_nonce);
 select * into r from connect_results where job_id=p_job and owner_id=own and device_id=p_id and origin=p_origin;
 if not found or r.descriptor->>'sha256' is distinct from p_hash then return jsonb_build_object('error','not-found'); end if;
 select * into s from connect_saves where job_id=p_job and owner_id=own and origin=p_origin and state='saved';
 return jsonb_build_object('result',jsonb_build_object('jobId',p_job,'sha256',p_hash,'saved',s.job_id is not null));
end $$;
revoke all on function public.connect_save_frozen(),public.connect_save_owner(uuid,text,uuid,text,uuid,jsonb,jsonb),public.connect_save_device(uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.connect_save_owner(uuid,text,uuid,text,uuid,jsonb,jsonb),public.connect_save_device(uuid,text,text,uuid,uuid,text) to service_role;

-- A current save source lease pins staging; cleanup only owns staging keys.
create or replace function public.connect_result_cleanup(p_job uuid default null,p_token uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r connect_results;
begin
 if p_job is not null then
  select * into r from connect_results where job_id=p_job for update;
  if not found or r.state not in ('deleting','expired') or r.cleanup_token is distinct from p_token then return jsonb_build_object('error','lease-expired'); end if;
  update connect_results set state='expired',cleanup_until=clock_timestamp()+interval '24 hours' where job_id=p_job returning * into r;
 else
  select * into r from connect_results where not exists(select 1 from connect_saves s where s.job_id=connect_results.job_id and s.state='saving' and s.lease_until>clock_timestamp())
   and (state<>'uploading' or lease_until<=clock_timestamp())
   and (cleanup_until is null or cleanup_until<=clock_timestamp())
   and (expires_at<=clock_timestamp() or not exists(select 1 from auth.users where id=owner_id) or not exists(select 1 from connect_jobs where id=job_id)
    or (state<>'available' and (exists(select 1 from connect_devices where id=device_id and (revoked_at is not null or expires_at<=clock_timestamp()))
     or exists(select 1 from connect_jobs where id=job_id and cancel_requested))))
   order by created_at limit 1 for update skip locked;
  if not found then return jsonb_build_object('result',null); end if;
  -- New statement snapshot after taking the result lock. A claim/renew may have
  -- committed between the selection snapshot and lock acquisition.
  if exists(select 1 from connect_saves s where s.job_id=r.job_id and s.state='saving' and s.lease_until>clock_timestamp()) then
   return jsonb_build_object('result',null);
  end if;
  update connect_results set state=case when state='expired' then 'expired' else 'deleting' end,cleanup_token=gen_random_uuid(),cleanup_until=clock_timestamp()+interval '120 seconds' where job_id=r.job_id returning * into r;
 end if;
 return jsonb_build_object('result',to_jsonb(r));
end $$;

commit;
