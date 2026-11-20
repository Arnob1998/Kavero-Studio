-- Private Connect output staging. No Gallery/local-generation table changes.
begin;
create table public.connect_results (
 job_id uuid primary key, owner_id uuid not null, device_id uuid not null, origin text not null,
 attempt integer not null check(attempt>0), descriptor jsonb not null,
 object_key text not null unique, state text not null default 'pending' check(state in ('pending','uploading','available','deleting','expired')),
 token uuid not null default gen_random_uuid(), lease_until timestamptz not null default now()+interval '120 seconds',
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 validated_at timestamptz, cleanup_token uuid, cleanup_until timestamptz
);
alter table public.connect_results enable row level security;
revoke all on public.connect_results from public,anon,authenticated;
grant all on public.connect_results to service_role;
create function public.connect_result_frozen() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.job_id,new.owner_id,new.device_id,new.origin,new.attempt,new.descriptor,new.object_key,new.created_at,new.expires_at)
 is distinct from (old.job_id,old.owner_id,old.device_id,old.origin,old.attempt,old.descriptor,old.object_key,old.created_at,old.expires_at)
 or (old.state='expired' and new.state<>'expired') or (old.state='deleting' and new.state not in ('deleting','expired'))
 or (old.validated_at is not null and new.validated_at is distinct from old.validated_at) then raise exception 'immutable-connect-result'; end if;
 return new;
end $$;
create trigger connect_result_immutable before update on public.connect_results for each row execute function public.connect_result_frozen();

create function public.connect_result_device(p_id uuid,p_origin text,p_key text,p_nonce uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; j connect_jobs; r connect_results; own uuid; desc_value jsonb; deadline timestamptz;
begin
 select owner_id into own from connect_devices where id=p_id;
 if own is null then return jsonb_build_object('error','unauthorized'); end if;
 perform pg_advisory_xact_lock(hashtextextended(own::text,97212));
 select * into d from connect_devices where id=p_id and origin=p_origin for update;
 if not found or d.public_key<>p_key or d.revoked_at is not null or d.expires_at<=clock_timestamp()
 or not exists(select 1 from auth.users where id=own) then return jsonb_build_object('error','unauthorized'); end if;
 if p_action not in ('finish','abort') then
  if not connect_rate('device:'||p_id,30,60) then return jsonb_build_object('error','rate-limited'); end if;
  delete from connect_nonces where device_id=p_id and expires_at<now();
  if p_nonce is null or exists(select 1 from connect_nonces where device_id=p_id and nonce=p_nonce) then return jsonb_build_object('error','replay'); end if;
  insert into connect_nonces(device_id,nonce) values(p_id,p_nonce);
 end if;
 select * into j from connect_jobs where id=(p_input->>'jobId')::uuid and device_id=p_id and owner_id=own and origin=p_origin for update;
 if not found or j.payload->>'execute' is distinct from 'true' or j.state<>'generated-unvalidated' or j.cancel_requested
 or j.attempt is distinct from (p_input->>'attempt')::integer then return jsonb_build_object('error','result-unavailable'); end if;
 select * into r from connect_results where job_id=j.id for update;
 if p_action='offer' then
  desc_value=p_input->'descriptor';
  if desc_value->>'ledgerIdentity' is distinct from j.binding->>'ledgerIdentity'
   or desc_value->>'executionDevice' is distinct from j.binding->>'executionDevice'
   or desc_value->>'requestHash' is distinct from j.payload->>'hash'
   or desc_value->>'packageFingerprint' is distinct from j.payload->'recipeSnapshot'->>'packageFingerprint'
   or desc_value->>'role' is distinct from 'final' then return jsonb_build_object('error','identity-conflict'); end if;
  if r.job_id is not null then
   if r.descriptor<>desc_value or r.attempt<>j.attempt then return jsonb_build_object('error','identity-conflict'); end if;
   if r.expires_at<=clock_timestamp() or r.state in ('deleting','expired') then return jsonb_build_object('error','expired'); end if;
   if r.state='uploading' and r.lease_until>clock_timestamp() then return jsonb_build_object('error','transfer-busy'); end if;
   if r.state<>'available' and r.lease_until<=clock_timestamp() then
    update connect_results set state='pending',token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds' where job_id=j.id returning * into r;
   end if;
  else
   deadline=least(clock_timestamp()+interval '24 hours',(desc_value->>'localExpiresAt')::timestamptz);
   if deadline<=clock_timestamp() then return jsonb_build_object('error','expired'); end if;
   if (select count(*) from connect_results where owner_id=own and state<>'expired')>=5
    or (select coalesce(sum((descriptor->>'sizeBytes')::bigint),0) from connect_results where owner_id=own and state<>'expired')+(desc_value->>'sizeBytes')::bigint>167772160
    then return jsonb_build_object('error','result-capacity'); end if;
   insert into connect_results(job_id,owner_id,device_id,origin,attempt,descriptor,object_key,expires_at)
    values(j.id,own,p_id,p_origin,j.attempt,desc_value,'connect-results/'||own||'/'||j.id||'/final.png',deadline) returning * into r;
  end if;
 elsif p_action in ('begin','finish','abort') then
  if r.job_id is null or r.expires_at<=clock_timestamp() or r.state in ('deleting','expired') then return jsonb_build_object('error','expired'); end if;
  if r.descriptor->>'sha256' is distinct from p_input->>'sha256' or (r.descriptor->>'sizeBytes')::bigint is distinct from (p_input->>'sizeBytes')::bigint then return jsonb_build_object('error','identity-conflict'); end if;
  if r.state='available' then return jsonb_build_object('result',to_jsonb(r)); end if;
  if r.token is distinct from (p_input->>'token')::uuid or r.lease_until<=clock_timestamp() then return jsonb_build_object('error','lease-expired'); end if;
  if p_action='abort' then
   if r.state<>'uploading' then return jsonb_build_object('error','lease-expired'); end if;
   update connect_results set state='pending',lease_until=clock_timestamp() where job_id=j.id returning * into r;
  elsif p_action='begin' then
   if r.state<>'pending' or exists(select 1 from connect_results where device_id=p_id and state='uploading' and lease_until>clock_timestamp()) then return jsonb_build_object('error','transfer-busy'); end if;
   update connect_results set state='uploading' where job_id=j.id returning * into r;
  else
   if r.state<>'uploading' then return jsonb_build_object('error','lease-expired'); end if;
   update connect_results set state='available',validated_at=clock_timestamp() where job_id=j.id returning * into r;
  end if;
 else return jsonb_build_object('error','invalid-action'); end if;
 return jsonb_build_object('result',to_jsonb(r));
end $$;

create function public.connect_result_owner(p_owner uuid,p_origin text,p_job uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r connect_results;
begin
 select * into r from connect_results where job_id=p_job and owner_id=p_owner and origin=p_origin;
 if not found or not exists(select 1 from auth.users where id=p_owner) or not exists(select 1 from connect_jobs where id=p_job and owner_id=p_owner) then return jsonb_build_object('error','not-found'); end if;
 if r.expires_at<=clock_timestamp() or r.state in ('expired','deleting') then return jsonb_build_object('error','expired'); end if;
 return jsonb_build_object('result',to_jsonb(r));
end $$;

create function public.connect_result_cancel(p_owner uuid,p_origin text,p_job uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j connect_jobs; r connect_results;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,97212));
 select * into j from connect_jobs where id=p_job and owner_id=p_owner and origin=p_origin for update;
 if not found or not exists(select 1 from auth.users where id=p_owner) then return jsonb_build_object('error','not-found'); end if;
 select * into r from connect_results where job_id=p_job for update;
 if r.state='available' then return jsonb_build_object('error','already-available'); end if;
 if j.state<>'generated-unvalidated' or j.payload->>'execute' is distinct from 'true' then return jsonb_build_object('error','result-unavailable'); end if;
 update connect_jobs set cancel_requested=true,version=version+1 where id=p_job and not cancel_requested;
 return jsonb_build_object('result',jsonb_build_object('job_id',p_job));
end $$;

create function public.connect_result_cleanup(p_job uuid default null,p_token uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r connect_results;
begin
 if p_job is not null then
  select * into r from connect_results where job_id=p_job for update;
  if not found or r.state not in ('deleting','expired') or r.cleanup_token is distinct from p_token then return jsonb_build_object('error','lease-expired'); end if;
  update connect_results set state='expired',cleanup_until=clock_timestamp()+interval '24 hours' where job_id=p_job returning * into r;
 else
  select * into r from connect_results where (state<>'uploading' or lease_until<=clock_timestamp())
   and (cleanup_until is null or cleanup_until<=clock_timestamp())
   and (expires_at<=clock_timestamp() or not exists(select 1 from auth.users where id=owner_id) or not exists(select 1 from connect_jobs where id=job_id)
    or (state<>'available' and (exists(select 1 from connect_devices where id=device_id and (revoked_at is not null or expires_at<=clock_timestamp()))
     or exists(select 1 from connect_jobs where id=job_id and cancel_requested))))
   order by created_at limit 1 for update skip locked;
  if not found then return jsonb_build_object('result',null); end if;
  update connect_results set state=case when state='expired' then 'expired' else 'deleting' end,cleanup_token=gen_random_uuid(),cleanup_until=clock_timestamp()+interval '120 seconds' where job_id=r.job_id returning * into r;
 end if;
 return jsonb_build_object('result',to_jsonb(r));
end $$;
revoke all on function public.connect_result_frozen(),public.connect_result_device(uuid,text,text,uuid,text,jsonb),public.connect_result_owner(uuid,text,uuid),public.connect_result_cancel(uuid,text,uuid),public.connect_result_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.connect_result_device(uuid,text,text,uuid,text,jsonb),public.connect_result_owner(uuid,text,uuid),public.connect_result_cancel(uuid,text,uuid),public.connect_result_cleanup(uuid,uuid) to service_role;
-- Dedicated bucket: no owner-folder policy. Device/owner access goes through APIs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('kavero-connect-results','kavero-connect-results',false,33554432,array['image/png']);
create policy connect_results_private on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'kavero-connect-results') with check(bucket_id<>'kavero-connect-results');
commit;
