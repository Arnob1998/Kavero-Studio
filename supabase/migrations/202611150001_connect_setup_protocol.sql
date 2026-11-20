-- MH-6B.4A: gated protocol/storage only. No native installation is dispatched here.
begin;
create table if not exists public.connect_setup_devices (
 device_id uuid primary key references public.connect_devices(id) on delete cascade,
 installation_id uuid not null, key_version integer not null,
 session uuid not null, seen_at timestamptz not null, profiles jsonb not null,
 check(jsonb_typeof(profiles)='array' and jsonb_array_length(profiles) between 1 and 2)
);
create table if not exists public.connect_setup_requests (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null references public.connect_devices(id) on delete cascade,
 origin text not null, submission_key uuid not null, kind text not null check(kind in ('assess','install')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 state text not null default 'requested' check(state in ('requested','delivered','awaiting-approval','approved','admitted','downloading','verifying','activation-needed','ready','assessed','cancelling','cancelled','failed','rejected','interrupted','expired')),
 cancel_requested boolean not null default false, processed_bytes bigint not null default 0 check(processed_bytes between 0 and 1125899906842624),
 operation_id uuid, evidence jsonb, reason text check(length(reason)<=80),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes',
 session uuid, token uuid, attempt integer not null default 0 check(attempt>=0), sequence integer not null default 0 check(sequence>=0),
 phase integer not null default 0 check(phase between 0 and 7), lease_until timestamptz,
 last_checkpoint jsonb, version bigint not null default 1,
 unique(owner_id,origin,submission_key)
);
create index if not exists connect_setup_request_device on public.connect_setup_requests(device_id,created_at,id);
alter table public.connect_setup_devices enable row level security;
alter table public.connect_setup_requests enable row level security;
revoke all on public.connect_setup_devices,public.connect_setup_requests from public,anon,authenticated;
grant all on public.connect_setup_devices,public.connect_setup_requests to service_role;

create or replace function public.connect_setup_frozen() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.id is distinct from new.id or old.owner_id is distinct from new.owner_id or old.device_id is distinct from new.device_id
 or old.origin is distinct from new.origin or old.submission_key is distinct from new.submission_key or old.kind is distinct from new.kind
 or old.payload is distinct from new.payload or old.created_at is distinct from new.created_at or old.expires_at is distinct from new.expires_at
 or (old.operation_id is not null and old.operation_id is distinct from new.operation_id) then raise exception 'connect-setup-immutable'; end if;
 return new;
end $$;
drop trigger if exists connect_setup_immutable on public.connect_setup_requests;
create trigger connect_setup_immutable before update on public.connect_setup_requests for each row execute function public.connect_setup_frozen();

create or replace function public.connect_setup_view(r public.connect_setup_requests,p_device boolean default false) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'deviceId',r.device_id,'key',r.submission_key,'kind',r.kind,'intent',r.payload->'intent','intentHash',r.payload->>'intentHash',
 'state',r.state,'cancelRequested',r.cancel_requested,'processedBytes',r.processed_bytes,'operationId',r.operation_id,'evidence',r.evidence,'reason',r.reason,
 'createdAt',r.created_at,'expiresAt',r.expires_at,'version',r.version)
 || case when p_device then jsonb_build_object('ownerId',r.owner_id,'session',r.session,'token',r.token,'attempt',r.attempt,'sequence',r.sequence,'leaseUntil',r.lease_until,'reconcile',true) else '{}'::jsonb end
$$;

create or replace function public.connect_setup_owner(p_owner uuid,p_origin text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; c connect_setup_devices; r connect_setup_requests; frozen jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,97224));
 if not exists(select 1 from auth.users where id=p_owner) then return jsonb_build_object('error','unauthorized'); end if;
 if p_action='create' then
  select * into d from connect_devices where id=(p_input->>'deviceId')::uuid and owner_id=p_owner and origin=p_origin for update;
  if not found or d.revoked_at is not null or d.expires_at<=now() then return jsonb_build_object('error','not-found'); end if;
  frozen=p_input-'id';
  select * into r from connect_setup_requests where owner_id=p_owner and origin=p_origin and submission_key=(p_input->>'key')::uuid for update;
  if found then
   if r.payload<>frozen then return jsonb_build_object('error','idempotency-conflict'); end if;
   return jsonb_build_object('request',connect_setup_view(r));
  end if;
  if not connect_rate('setup-owner:'||p_owner,10,60) then return jsonb_build_object('error','rate-limited'); end if;
  if p_input->>'kind' not in ('assess','install') or p_input->>'intentHash' !~ '^[a-f0-9]{64}$'
   or p_input#>>'{intent,ownerId}' is distinct from p_owner::text or p_input#>>'{intent,origin}' is distinct from p_origin
   or p_input#>>'{intent,deviceId}' is distinct from d.id::text or p_input#>>'{intent,installationId}' is distinct from d.installation_id::text
   or p_input#>>'{intent,keyVersion}' is distinct from d.key_version::text or p_input#>>'{intent,setupProtocol}' is distinct from '1'
   or p_input#>>'{intent,profile}' not in ('qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation')
   or (p_input->>'kind'='install' and p_input->>'acceptedTerms' is distinct from 'true') then return jsonb_build_object('error','intent-invalid'); end if;
  select * into c from connect_setup_devices where device_id=d.id;
  if not found or c.seen_at<=now()-interval '150 seconds' or c.key_version<>d.key_version or c.installation_id<>d.installation_id
   or not c.profiles ? (p_input#>>'{intent,profile}') then return jsonb_build_object('error','setup-capability-unavailable'); end if;
  update connect_setup_requests set state='expired',version=version+1 where device_id=d.id and state='requested' and attempt=0 and expires_at<=now();
  if (select count(*) from connect_setup_requests where owner_id=p_owner)>=1000 then return jsonb_build_object('error','receipt-capacity'); end if;
  if exists(select 1 from connect_setup_requests where device_id=d.id and state not in ('ready','assessed','cancelled','failed','rejected','expired'))
   or (select count(*) from connect_setup_requests where owner_id=p_owner and state not in ('ready','assessed','cancelled','failed','rejected','expired'))>=2 then return jsonb_build_object('error','queue-full'); end if;
  insert into connect_setup_requests(id,owner_id,device_id,origin,submission_key,kind,payload)
   values((p_input->>'id')::uuid,p_owner,d.id,p_origin,(p_input->>'key')::uuid,p_input->>'kind',frozen) returning * into r;
 elsif p_action in ('inspect','cancel') then
  select * into r from connect_setup_requests where id=(p_input->>'id')::uuid and owner_id=p_owner and origin=p_origin;
  if not found then return jsonb_build_object('error','not-found'); end if;
  -- Lock order matches device checkpoints: device, then setup receipt.
  perform 1 from connect_devices where id=r.device_id for update;
  select * into r from connect_setup_requests where id=r.id for update;
  if p_action='cancel' and r.state not in ('ready','assessed','cancelled','failed','rejected','expired') and not r.cancel_requested then
   update connect_setup_requests set cancel_requested=true,state=case when attempt=0 then 'cancelled' else 'cancelling' end,version=version+1 where id=r.id returning * into r;
  end if;
 else return jsonb_build_object('error','invalid-action'); end if;
 return jsonb_build_object('request',connect_setup_view(r));
end $$;

create or replace function public.connect_setup_device(p_id uuid,p_origin text,p_public_key text,p_nonce uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; c connect_setup_devices; r connect_setup_requests; same_session boolean; next_state text; next_phase integer; seq integer; checkpoint jsonb; approval jsonb;
begin
 select * into d from connect_devices where id=p_id and origin=p_origin for update;
 if not found or d.revoked_at is not null or d.expires_at<=now() or d.public_key<>p_public_key then return jsonb_build_object('error','unauthorized'); end if;
 if p_input->>'setupProtocol' is distinct from '1' or p_action not in ('setup-poll','setup-checkpoint') then return jsonb_build_object('error','invalid-action'); end if;
 if not connect_rate('setup-device:'||p_id,60,60) then return jsonb_build_object('error','rate-limited'); end if;
 delete from connect_nonces where device_id=p_id and expires_at<=now();
 if exists(select 1 from connect_nonces where device_id=p_id and nonce=p_nonce) then return jsonb_build_object('error','replayed-request'); end if;
 if (select count(*) from connect_nonces where device_id=p_id)>=128 then return jsonb_build_object('error','rate-limited'); end if;
 insert into connect_nonces(device_id,nonce) values(p_id,p_nonce);
 select * into c from connect_setup_devices where device_id=d.id;
 same_session=found and c.session=(p_input->>'session')::uuid and c.key_version=d.key_version and c.installation_id=d.installation_id;
 if p_action='setup-poll' then
  if p_input->>'approvedOwner' is distinct from d.owner_id::text then return jsonb_build_object('error','owner-approval-required'); end if;
  if jsonb_typeof(p_input->'profiles') is distinct from 'array' or jsonb_array_length(p_input->'profiles') not between 1 and 2
   or exists(select 1 from jsonb_array_elements_text(p_input->'profiles') p where p not in ('qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation')) then return jsonb_build_object('error','unsupported-profile'); end if;
  if not same_session and c.seen_at>now()-interval '45 seconds' then return jsonb_build_object('error','session-busy'); end if;
  insert into connect_setup_devices(device_id,installation_id,key_version,session,seen_at,profiles)
   values(d.id,d.installation_id,d.key_version,(p_input->>'session')::uuid,now(),p_input->'profiles')
   on conflict(device_id) do update set installation_id=excluded.installation_id,key_version=excluded.key_version,session=excluded.session,seen_at=excluded.seen_at,profiles=excluded.profiles returning * into c;
  update connect_devices set last_seen_at=now() where id=d.id;
  update connect_setup_requests set state='expired',version=version+1 where device_id=d.id and state='requested' and attempt=0 and expires_at<=now();
  select * into r from connect_setup_requests where device_id=d.id and owner_id=d.owner_id and origin=p_origin and state not in ('requested','ready','assessed','cancelled','failed','rejected','expired') order by created_at,id limit 1 for update;
  if not found then select * into r from connect_setup_requests where device_id=d.id and owner_id=d.owner_id and origin=p_origin and state='requested' and c.profiles ? (payload#>>'{intent,profile}') order by created_at,id limit 1 for update; end if;
  if found then
   if r.payload#>>'{intent,keyVersion}' is distinct from d.key_version::text or r.payload#>>'{intent,installationId}' is distinct from d.installation_id::text then return jsonb_build_object('error','identity-changed'); end if;
   if r.token is null or r.lease_until<=now() or r.session<>c.session then
    update connect_setup_requests set state=case when state='requested' then 'delivered' else state end,session=c.session,token=gen_random_uuid(),attempt=attempt+1,sequence=0,last_checkpoint=null,lease_until=now()+interval '45 seconds',version=version+1 where id=r.id returning * into r;
   else update connect_setup_requests set lease_until=now()+interval '45 seconds' where id=r.id returning * into r; end if;
  end if;
 else
  if not same_session or c.seen_at<=now()-interval '45 seconds' then return jsonb_build_object('error','stale-session'); end if;
  select * into r from connect_setup_requests where id=(p_input->>'id')::uuid and device_id=d.id and owner_id=d.owner_id and origin=p_origin for update;
  if not found then return jsonb_build_object('error','not-found'); end if;
  if r.payload#>>'{intent,keyVersion}' is distinct from d.key_version::text or r.payload#>>'{intent,installationId}' is distinct from d.installation_id::text then return jsonb_build_object('error','identity-changed'); end if;
  if r.session is distinct from c.session or r.token is distinct from (p_input->>'token')::uuid or r.attempt<>(p_input->>'attempt')::integer
   or r.payload->>'intentHash' is distinct from p_input->>'intentHash' then return jsonb_build_object('error','stale-claim'); end if;
  seq=(p_input->>'sequence')::integer; checkpoint=p_input-'action'-'setupProtocol'-'session'-'id'-'token'-'attempt';
  if seq=r.sequence and r.last_checkpoint=checkpoint then return jsonb_build_object('request',connect_setup_view(r,true)); end if;
  if r.lease_until<=now() or seq<>r.sequence+1 then return jsonb_build_object('error','stale-checkpoint'); end if;
  if r.state in ('ready','assessed','cancelled','failed','rejected','expired') then return jsonb_build_object('error','terminal-request'); end if;
  next_state=p_input->>'state';
  if r.cancel_requested and next_state not in ('cancelling','cancelled','failed','interrupted') then return jsonb_build_object('error','cancel-pending'); end if;
  if (p_input->>'processedBytes')::bigint<r.processed_bytes then return jsonb_build_object('error','progress-regressed'); end if;
  next_phase=case next_state when 'awaiting-approval' then 1 when 'approved' then 2 when 'admitted' then 3 when 'downloading' then 4 when 'verifying' then 5 when 'activation-needed' then 6 when 'ready' then 7 else r.phase end;
  if next_state not in ('awaiting-approval','approved','admitted','downloading','verifying','activation-needed','ready','assessed','cancelling','cancelled','failed','rejected','interrupted')
   or next_phase<r.phase or (next_phase>r.phase+1 and next_state not in ('ready') )
   or (next_state='ready' and r.phase<3)
   or (r.kind='assess' and next_state not in ('assessed','cancelling','cancelled','failed','rejected','interrupted'))
   or (r.kind='install' and next_state='assessed') or (next_state='rejected' and r.phase>=3) then return jsonb_build_object('error','invalid-transition'); end if;
  if next_state='approved' then
   approval=p_input->'approval';
   if approval->>'ownerId' is distinct from d.owner_id::text or approval->>'deviceId' is distinct from d.id::text
    or approval->>'intentHash' is distinct from r.payload->>'intentHash' or approval->>'manifestHash' is distinct from r.payload#>>'{intent,manifestHash}'
    or approval->>'termsDigest' is distinct from r.payload#>>'{intent,termsDigest}' or approval->>'accepted' is distinct from 'true' then return jsonb_build_object('error','approval-mismatch'); end if;
  end if;
  if (next_phase>=3 and r.kind='install' and next_state not in ('cancelling','cancelled','failed','rejected','interrupted')) and p_input->>'operationId' is null then return jsonb_build_object('error','native-operation-required'); end if;
  if p_input->>'operationId' is not null and (r.kind='assess' or (r.operation_id is null and next_state<>'admitted')) then return jsonb_build_object('error','native-operation-unexpected'); end if;
  if r.operation_id is not null and r.operation_id::text is distinct from p_input->>'operationId' then return jsonb_build_object('error','native-operation-changed'); end if;
  if (next_state='assessed' or p_input->'evidence' is not null) and (p_input#>>'{evidence,manifestHash}' is distinct from r.payload#>>'{intent,manifestHash}' or p_input#>>'{evidence,capturedAt}' is null or (p_input#>>'{evidence,capturedAt}')::timestamptz<now()-interval '150 seconds' or (p_input#>>'{evidence,capturedAt}')::timestamptz>now()+interval '60 seconds') then return jsonb_build_object('error','measurement-mismatch'); end if;
  update connect_setup_requests set state=next_state,phase=greatest(phase,next_phase),processed_bytes=(p_input->>'processedBytes')::bigint,
   operation_id=coalesce(operation_id,(p_input->>'operationId')::uuid),evidence=coalesce(p_input->'evidence',evidence),reason=p_input->>'reason',sequence=seq,last_checkpoint=checkpoint,version=version+1 where id=r.id returning * into r;
 end if;
 return jsonb_build_object('request',case when r.id is null then null else connect_setup_view(r,true) end);
end $$;

revoke all on function public.connect_setup_frozen(),public.connect_setup_view(public.connect_setup_requests,boolean),public.connect_setup_owner(uuid,text,text,jsonb),public.connect_setup_device(uuid,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.connect_setup_owner(uuid,text,text,jsonb),public.connect_setup_device(uuid,text,text,uuid,text,jsonb) to service_role;
commit;
