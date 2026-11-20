-- KC-2B: opt-in execution transport remains isolated from protocol fixtures.
begin;
alter table public.connect_jobs add column failure_code text;
create or replace function public.connect_job_view(j public.connect_jobs, p_device boolean default false) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',j.id,'deviceId',j.device_id,'key',j.submission_key,'payload',j.payload,'binding',j.binding,
 'state',j.state,'cancelRequested',j.cancel_requested,'createdAt',j.created_at,'expiresAt',j.expires_at,'version',j.version,'failureCode',j.failure_code)
 || case when p_device then jsonb_build_object('owner',j.owner_id,'attempt',j.attempt,'token',j.token,'sequence',j.sequence,'leaseUntil',j.lease_until,'reconcile',true) else '{}'::jsonb end
$$;

create or replace function public.connect_job_owner(p_owner uuid,p_origin text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; r connect_delivery_devices; j connect_jobs; frozen jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,97212));
 if not exists(select 1 from auth.users where id=p_owner) then return jsonb_build_object('error','unauthorized'); end if;
 if p_action='create' then
  frozen=p_input-'id';
  select * into j from connect_jobs where owner_id=p_owner and origin=p_origin and submission_key=(p_input->>'key')::uuid for update;
  if found then
   if j.payload<>frozen then return jsonb_build_object('error','idempotency-conflict'); end if;
   return jsonb_build_object('job',connect_job_view(j),'protocolOnly',true,'generationEnabled',false);
  end if;
  if not connect_rate('jobs:'||p_owner,10,60) then return jsonb_build_object('error','rate-limited'); end if;
  select * into d from connect_devices where id=(p_input->>'deviceId')::uuid and owner_id=p_owner and origin=p_origin for update;
  if not found or d.revoked_at is not null or d.expires_at<=now() then return jsonb_build_object('error','not-found'); end if;
  select * into r from connect_delivery_devices where device_id=d.id;
  if not found or r.binding_at<=now()-interval '150 seconds' or r.binding_hash is distinct from p_input->>'bindingHash'
   or r.binding->>'profile' is distinct from p_input->>'profile' or r.binding->>'permission' is distinct from 'true'
   or coalesce(r.binding->>'execute','false')<>coalesce(p_input->>'execute','false') or r.binding->>'maintenance' is distinct from 'false' then return jsonb_build_object('error','binding-unavailable'); end if;
  update connect_jobs set state='expired',version=version+1 where device_id=d.id and state='waiting' and expires_at<=now();
  if (select count(*) from connect_jobs where owner_id=p_owner)>=1000 then return jsonb_build_object('error','receipt-capacity'); end if;
  if (select count(*) from connect_jobs where device_id=d.id and state in ('waiting','delivered','accepted','running','submission-unknown'))>=5
   or (select count(*) from connect_jobs where owner_id=p_owner and state in ('waiting','delivered','accepted','running','submission-unknown'))>=2 then return jsonb_build_object('error','queue-full'); end if;
  insert into connect_jobs(id,owner_id,device_id,origin,submission_key,payload,binding)
   values((p_input->>'id')::uuid,p_owner,d.id,p_origin,(p_input->>'key')::uuid,frozen,r.binding) returning * into j;
 elsif p_action in ('inspect','cancel') then
  select * into j from connect_jobs where id=(p_input->>'id')::uuid and owner_id=p_owner and origin=p_origin for update;
  if not found then return jsonb_build_object('error','not-found'); end if;
  if j.state='waiting' and j.expires_at<=now() then update connect_jobs set state='expired',version=version+1 where id=j.id returning * into j; end if;
  if p_action='cancel' and j.state in ('waiting','delivered','accepted','running','submission-unknown') and not j.cancel_requested then
   update connect_jobs set cancel_requested=true,state=case when state='waiting' then 'cancelled' else state end,version=version+1 where id=j.id returning * into j;
  end if;
 else return jsonb_build_object('error','invalid-action'); end if;
 return jsonb_build_object('job',connect_job_view(j),'protocolOnly',true,'generationEnabled',false);
end $$;

create or replace function public.connect_delivery_action(p_id uuid,p_origin text,p_public_key text,p_nonce uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; r connect_delivery_devices; j connect_jobs; next_state text; seq integer; same_session boolean;
begin
 -- Same device row lock as identity rotation/revocation: authorization and nonce
 -- consumption cannot race a key change or account/device revocation.
 select * into d from connect_devices where id=p_id and origin=p_origin for update;
 if not found or d.revoked_at is not null or d.expires_at<=now() or d.public_key<>p_public_key then return jsonb_build_object('error','unauthorized'); end if;
 if not connect_rate('device:'||p_id,30,60) then return jsonb_build_object('error','rate-limited'); end if;
 delete from connect_nonces where device_id=p_id and expires_at<=now();
 if exists(select 1 from connect_nonces where device_id=p_id and nonce=p_nonce) then return jsonb_build_object('error','replayed-request'); end if;
 if (select count(*) from connect_nonces where device_id=p_id)>=128 then return jsonb_build_object('error','rate-limited'); end if;
 insert into connect_nonces(device_id,nonce) values(p_id,p_nonce);
 select * into r from connect_delivery_devices where device_id=p_id;
 same_session=found and r.session=(p_input->>'session')::uuid;
 if p_action='delivery-poll' then
  if not same_session and r.seen_at>now()-interval '45 seconds' then return jsonb_build_object('error','session-busy'); end if;
  insert into connect_delivery_devices(device_id,session,seen_at,binding,binding_hash,binding_at)
   values(p_id,(p_input->>'session')::uuid,now(),nullif(p_input->'binding','null'::jsonb),p_input->>'bindingHash',case when nullif(p_input->'binding','null'::jsonb) is not null then now() end)
   on conflict(device_id) do update set session=excluded.session,seen_at=excluded.seen_at,binding=excluded.binding,binding_hash=excluded.binding_hash,binding_at=excluded.binding_at returning * into r;
  update connect_devices set last_seen_at=now() where id=p_id;
  update connect_jobs set state='expired',version=version+1 where device_id=p_id and state='waiting' and expires_at<=now();
  select * into j from connect_jobs where device_id=p_id and owner_id=d.owner_id and origin=p_origin
   and coalesce(payload->>'execute','false')=coalesce(p_input->>'execute','false') and state in ('delivered','accepted','running','submission-unknown') order by created_at,id limit 1 for update;
  if not found then
   -- Candidate metadata is not an execution grant, but stale/change bindings
   -- must still prevent first delivery. Already delivered jobs always reconcile.
   select * into j from connect_jobs where device_id=p_id and owner_id=d.owner_id and origin=p_origin and state='waiting' and coalesce(payload->>'execute','false')=coalesce(p_input->>'execute','false')
    and binding=r.binding and r.binding->>'permission'='true' and r.binding->>'maintenance'='false' order by created_at,id limit 1 for update;
  end if;
  if found then
   if j.token is null or j.lease_until<=now() or j.session<>r.session then
    update connect_jobs set state=case when state='waiting' then 'delivered' else state end,attempt=attempt+1,token=gen_random_uuid(),session=r.session,
     lease_until=now()+interval '45 seconds',sequence=0,version=version+1 where id=j.id returning * into j;
   else update connect_jobs set lease_until=now()+interval '45 seconds' where id=j.id returning * into j; end if;
  end if;
 elsif p_action='delivery-checkpoint' then
  if not same_session or r.seen_at<=now()-interval '45 seconds' then return jsonb_build_object('error','stale-session'); end if;
  select * into j from connect_jobs where id=(p_input->>'id')::uuid and device_id=p_id and owner_id=d.owner_id and origin=p_origin and coalesce(payload->>'execute','false')=coalesce(p_input->>'execute','false') for update;
  if not found then return jsonb_build_object('error','not-found'); end if;
  if j.session<>r.session or j.token is distinct from (p_input->>'token')::uuid or j.attempt<>(p_input->>'attempt')::integer then return jsonb_build_object('error','stale-claim'); end if;
  seq=(p_input->>'sequence')::integer; next_state=p_input->>'state';
  if seq=j.sequence and next_state=j.state and j.failure_code is not distinct from p_input->>'reason' then
   return jsonb_build_object('deviceId',d.id,'origin',d.origin,'protocolOnly',not coalesce((p_input->>'execute')::boolean,false),'generationEnabled',coalesce((p_input->>'execute')::boolean,false),'ownerId',d.owner_id,'job',connect_job_view(j,true));
  end if;
  if j.lease_until<=now() or seq<>j.sequence+1 then return jsonb_build_object('error','stale-checkpoint'); end if;
  if j.state not in ('delivered','accepted','running','submission-unknown') or next_state not in ('accepted','running','submission-unknown','generated-unvalidated','failed','cancelled','rejected')
   or (j.progress>=2 and next_state='accepted') or (j.progress>=1 and next_state='rejected') then return jsonb_build_object('error','invalid-transition'); end if;
  update connect_jobs set state=next_state,sequence=seq,failure_code=p_input->>'reason',progress=greatest(progress,case next_state when 'accepted' then 1 when 'running' then 2 else 0 end),version=version+1 where id=j.id returning * into j;
 else return jsonb_build_object('error','invalid-action'); end if;
 return jsonb_build_object('deviceId',d.id,'origin',d.origin,'protocolOnly',not coalesce((p_input->>'execute')::boolean,false),'generationEnabled',coalesce((p_input->>'execute')::boolean,false),'ownerId',d.owner_id,'executionVerified',false,
  'bindingHash',r.binding_hash,'pollAfterSeconds',case when j.id is null then 60 else 5 end,'job',case when j.id is null then null else connect_job_view(j,true) end);
end $$;


commit;
