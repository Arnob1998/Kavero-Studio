-- MH-5B.2: local app admission exclusion survives an absent native runtime.
begin;
create table if not exists public.local_model_removals (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, submission_key uuid not null,
 instance_id uuid not null, package_id text not null, manifest text not null check(manifest ~ '^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','removed','refused')),
 host_operation uuid, created_at timestamptz not null default now(), unique(owner_id,submission_key)
);
alter table public.local_model_removals enable row level security;
revoke all on public.local_model_removals from public,anon,authenticated;
grant select on public.local_model_removals to service_role;
create unique index if not exists one_local_model_removal on public.local_model_removals((state)) where state='pending';
create or replace function public.protect_local_removal_identity() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.submission_key is distinct from old.submission_key
  or new.instance_id is distinct from old.instance_id or new.package_id is distinct from old.package_id or new.manifest is distinct from old.manifest
  or new.created_at is distinct from old.created_at or (old.host_operation is not null and new.host_operation is distinct from old.host_operation)
  or (old.state='removed' and new.state<>'removed') then raise exception 'immutable-local-removal-identity'; end if;
 return new;
end $$;
drop trigger if exists protect_local_removal_identity on public.local_model_removals;
create trigger protect_local_removal_identity before update on public.local_model_removals for each row execute function public.protect_local_removal_identity();

create or replace function public.fence_local_model_removal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(735210021);
 if exists(select 1 from public.local_model_removals where state='pending') then raise exception 'local-runtime-removing'; end if;
 return new;
end $$;
drop trigger if exists fence_local_removal_job on public.local_generation_jobs;
create trigger fence_local_removal_job before insert on public.local_generation_jobs for each row execute function public.fence_local_model_removal();
drop trigger if exists fence_local_removal_switch on public.local_generation_switches;
create trigger fence_local_removal_switch before insert or update on public.local_generation_switches for each row when (new.state='pending') execute function public.fence_local_model_removal();

create or replace function public.read_local_model_removal(p_owner uuid,p_key uuid,p_instance uuid,p_package text)
returns public.local_model_removals language sql security definer set search_path=public,pg_temp as $$
 select r from public.local_model_removals r where owner_id=p_owner and
 ((p_key is not null and submission_key=p_key) or (p_key is null and instance_id=p_instance and package_id=p_package))
 order by created_at desc,id desc limit 1
$$;
create or replace function public.begin_local_model_removal(p_owner uuid,p_key uuid,p_instance uuid,p_package text,p_manifest text)
returns public.local_model_removals language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_model_removals;
begin
 perform pg_advisory_xact_lock(735210021);
 if p_owner is null or p_key is null or p_instance is null or p_package not in ('qwen-2-1-internal-evaluation','qwen-2-1-q3-internal-evaluation')
  or p_package is null or p_manifest is null or p_manifest !~ '^[a-f0-9]{64}$' then raise exception 'invalid-local-removal'; end if;
 select * into operation from public.local_model_removals where owner_id=p_owner and submission_key=p_key;
 if found then
  if operation.instance_id<>p_instance or operation.package_id<>p_package or operation.manifest<>p_manifest then raise exception 'local-removal-idempotency-conflict'; end if;
  if operation.state<>'refused' then return operation; end if;
 end if;
 if exists(select 1 from public.local_model_removals where state='pending') or exists(select 1 from public.local_generation_runtime where switch_id is not null)
  then raise exception 'local-runtime-removing'; end if;
 if exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) then raise exception 'local-jobs-outstanding'; end if;
 if (select count(*) from public.local_model_removals)>=4096 then raise exception 'local-removal-journal-full'; end if;
 if operation.id is null then
  insert into public.local_model_removals(owner_id,submission_key,instance_id,package_id,manifest) values(p_owner,p_key,p_instance,p_package,p_manifest) returning * into operation;
 else update public.local_model_removals set state='pending' where id=operation.id returning * into operation;
 end if;
 return operation;
end $$;
create or replace function public.refuse_local_model_removal(p_owner uuid,p_id uuid)
returns public.local_model_removals language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_model_removals;
begin
 perform pg_advisory_xact_lock(735210021);
 select * into operation from public.local_model_removals where owner_id=p_owner and id=p_id;
 if not found or operation.host_operation is not null or operation.state='removed' then raise exception 'local-removal-already-admitted'; end if;
 -- Server calls only for an authenticated native refusal proving no admission.
 update public.local_model_removals set state='refused' where id=p_id returning * into operation;
 return operation;
end $$;
create or replace function public.settle_local_model_removal(p_owner uuid,p_id uuid,p_host uuid,p_removed boolean)
returns public.local_model_removals language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_model_removals;
begin
 perform pg_advisory_xact_lock(735210021);
 select * into operation from public.local_model_removals where id=p_id and owner_id=p_owner;
 if not found or p_host is null or p_removed is null then raise exception 'local-removal-not-found'; end if;
 if operation.host_operation is not null and operation.host_operation<>p_host then raise exception 'local-removal-host-conflict'; end if;
 if operation.state='removed' then return operation; end if;
 if p_removed then
  if exists(select 1 from public.local_generation_runtime where switch_id is not null)
   or exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) then raise exception 'local-jobs-outstanding'; end if;
  -- Signed native completion is verified by the server before this RPC. The
  -- worker may no longer exist; the next verified job/switch can seed identity.
  delete from public.local_generation_runtime where slot=1;
 end if;
 update public.local_model_removals set host_operation=p_host,state=case when p_removed then 'removed' else 'pending' end where id=p_id returning * into operation;
 return operation;
end $$;
revoke all on function public.protect_local_removal_identity(),public.fence_local_model_removal(),public.read_local_model_removal(uuid,uuid,uuid,text),public.begin_local_model_removal(uuid,uuid,uuid,text,text),public.settle_local_model_removal(uuid,uuid,uuid,boolean),public.refuse_local_model_removal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_local_model_removal(uuid,uuid,uuid,text),public.begin_local_model_removal(uuid,uuid,uuid,text,text),public.settle_local_model_removal(uuid,uuid,uuid,boolean),public.refuse_local_model_removal(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
