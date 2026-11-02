-- Local-only forward migration. No expiration/takeover of uncertain switches.
begin;
create table if not exists public.local_generation_switches (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 submission_key uuid not null, target_package_id text not null, target_fingerprint text not null check(target_fingerprint ~ '^[a-f0-9]{64}$'),
 original_identity jsonb not null, state text not null default 'pending' check(state in ('pending','installed','rolled-back')),
 host_operation uuid, created_at timestamptz not null default now(), unique(owner_id,submission_key)
);
create table if not exists public.local_generation_runtime (
 slot integer primary key check(slot=1), identity jsonb not null, switch_id uuid references public.local_generation_switches(id)
);
alter table public.local_generation_switches enable row level security;
alter table public.local_generation_runtime enable row level security;
revoke all on public.local_generation_switches, public.local_generation_runtime from public,anon,authenticated;
grant select on public.local_generation_switches, public.local_generation_runtime to service_role;
create unique index if not exists local_switch_host_identity on public.local_generation_switches(owner_id,host_operation) where host_operation is not null;
create or replace function public.read_local_runtime_switch(p_owner uuid,p_key uuid,p_host uuid)
returns public.local_generation_switches language sql security definer set search_path=public,pg_temp as $$
 select s from public.local_generation_switches s where owner_id=p_owner
 and ((p_key is not null and p_host is null and submission_key=p_key) or (p_host is not null and p_key is null and host_operation=p_host))
$$;
revoke all on function public.read_local_runtime_switch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_local_runtime_switch(uuid,uuid,uuid) to service_role;

create or replace function public.valid_local_runtime_identity(value jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(jsonb_typeof(value)='object' and value-array['packageFingerprint','deviceId','ledgerIdentity']='{}'::jsonb
  and jsonb_typeof(value->'packageFingerprint')='string' and jsonb_typeof(value->'deviceId')='string' and jsonb_typeof(value->'ledgerIdentity')='string'
  and value->>'packageFingerprint' ~ '^[a-f0-9]{64}$' and length(value->>'deviceId') between 1 and 256
  and value->>'ledgerIdentity' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$$;
revoke all on function public.valid_local_runtime_identity(jsonb) from public,anon,authenticated;

create or replace function public.fence_local_job_admission() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare runtime public.local_generation_runtime; incoming jsonb;
begin
 perform pg_advisory_xact_lock(735210021);
 incoming=jsonb_build_object('packageFingerprint',new.package_fingerprint,'deviceId',new.device_id,'ledgerIdentity',new.worker_identity);
 if not public.valid_local_runtime_identity(incoming) then raise exception 'invalid-local-runtime-identity'; end if;
 select * into runtime from public.local_generation_runtime where slot=1;
 if not found then
  if exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')
   and (package_fingerprint<>new.package_fingerprint or device_id<>new.device_id or worker_identity<>new.worker_identity)) then raise exception 'local-runtime-identity-changed'; end if;
  insert into public.local_generation_runtime(slot,identity) values(1,incoming) returning * into runtime;
 end if;
 if runtime.switch_id is not null then raise exception 'local-runtime-switching'; end if;
 if runtime.identity is distinct from incoming then raise exception 'local-runtime-identity-changed'; end if;
 return new;
end $$;
drop trigger if exists fence_local_job_admission on public.local_generation_jobs;
create trigger fence_local_job_admission before insert on public.local_generation_jobs for each row execute function public.fence_local_job_admission();
revoke all on function public.fence_local_job_admission() from public,anon,authenticated;

create or replace function public.begin_local_runtime_switch(p_owner uuid,p_key uuid,p_target_id text,p_target text,p_current jsonb)
returns public.local_generation_switches language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_generation_switches; runtime public.local_generation_runtime;
begin
 perform pg_advisory_xact_lock(735210021);
 if p_owner is null or p_key is null or p_target !~ '^[a-f0-9]{64}$' or p_target is null
  or p_target_id is null or length(p_target_id) not between 1 and 128 or not public.valid_local_runtime_identity(p_current) then raise exception 'invalid-local-runtime-switch'; end if;
 select * into operation from public.local_generation_switches where owner_id=p_owner and submission_key=p_key;
 if found then
  if operation.target_package_id<>p_target_id or operation.target_fingerprint<>p_target or operation.original_identity is distinct from p_current then raise exception 'local-switch-idempotency-conflict'; end if;
  if operation.state='installed' then return operation; end if;
 end if;
 select * into runtime from public.local_generation_runtime where slot=1;
 if found and runtime.switch_id is not null then
  if runtime.switch_id=operation.id and operation.state='pending' then return operation; end if;
  raise exception 'local-runtime-switching';
 end if;
 if exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) then raise exception 'local-jobs-outstanding'; end if;
 if runtime.slot is not null and runtime.identity is distinct from p_current then raise exception 'local-runtime-identity-changed'; end if;
 if operation.id is null then
  if (select count(*) from public.local_generation_switches)>=4096 then raise exception 'local-switch-journal-full'; end if;
  insert into public.local_generation_switches(owner_id,submission_key,target_package_id,target_fingerprint,original_identity)
   values(p_owner,p_key,p_target_id,p_target,p_current) returning * into operation;
 else update public.local_generation_switches set state='pending' where id=operation.id returning * into operation;
 end if;
 insert into public.local_generation_runtime(slot,identity,switch_id) values(1,p_current,operation.id)
 on conflict(slot) do update set switch_id=excluded.switch_id;
 return operation;
end $$;

create or replace function public.bind_local_runtime_switch(p_owner uuid,p_switch uuid,p_host uuid)
returns public.local_generation_switches language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_generation_switches;
begin
 perform pg_advisory_xact_lock(735210021);
 select * into operation from public.local_generation_switches where owner_id=p_owner and id=p_switch;
 if not found or p_host is null then raise exception 'local-switch-not-found'; end if;
 if operation.host_operation is not null and operation.host_operation<>p_host then raise exception 'local-switch-host-conflict'; end if;
 update public.local_generation_switches set host_operation=p_host where id=p_switch returning * into operation;
 return operation;
end $$;

create or replace function public.finish_local_runtime_switch(p_owner uuid,p_switch uuid,p_outcome text,p_observed jsonb)
returns public.local_generation_switches language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_generation_switches; expected jsonb;
begin
 perform pg_advisory_xact_lock(735210021);
 select * into operation from public.local_generation_switches where owner_id=p_owner and id=p_switch;
 if not found then raise exception 'local-switch-not-found'; end if;
 if p_outcome is null or p_outcome not in ('installed','rolled-back') then raise exception 'invalid-local-switch-outcome'; end if;
 expected=case when p_outcome='installed' then jsonb_set(operation.original_identity,'{packageFingerprint}',to_jsonb(operation.target_fingerprint)) else operation.original_identity end;
 if p_observed is distinct from expected then raise exception 'local-switch-runtime-mismatch'; end if;
 if operation.state<>'pending' then
  if operation.state<>p_outcome then raise exception 'local-switch-outcome-conflict'; end if;
  return operation;
 end if;
 if not exists(select 1 from public.local_generation_runtime where slot=1 and switch_id=p_switch) then raise exception 'local-switch-fence-changed'; end if;
 if exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) then raise exception 'local-jobs-outstanding'; end if;
 update public.local_generation_runtime set identity=p_observed,switch_id=null where slot=1;
 update public.local_generation_switches set state=p_outcome where id=p_switch returning * into operation;
 return operation;
end $$;
revoke all on function public.begin_local_runtime_switch(uuid,uuid,text,text,jsonb),public.bind_local_runtime_switch(uuid,uuid,uuid),public.finish_local_runtime_switch(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_local_runtime_switch(uuid,uuid,text,text,jsonb),public.bind_local_runtime_switch(uuid,uuid,uuid),public.finish_local_runtime_switch(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
