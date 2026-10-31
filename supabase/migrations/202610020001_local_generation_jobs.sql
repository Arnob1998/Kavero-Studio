-- Dedicated local-only internal integration. Apply through the local bootstrap;
-- do not deploy this migration to a hosted project incidentally.
begin;
create table if not exists public.local_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  intent jsonb not null,
  package_fingerprint text not null check (package_fingerprint ~ '^[a-f0-9]{64}$'),
  device_id text not null,
  worker_identity uuid not null,
  state text not null default 'pending' check (state in
    ('pending','queued','dispatching','running','cancel-requested','submission-unknown','generated-unvalidated','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, submission_key)
);
alter table public.local_generation_jobs enable row level security;
drop policy if exists local_jobs_owner_read on public.local_generation_jobs;
create policy local_jobs_owner_read on public.local_generation_jobs
  for select to authenticated using (owner_id = auth.uid());
revoke all on public.local_generation_jobs from anon, authenticated;
grant select on public.local_generation_jobs to authenticated;
grant all on public.local_generation_jobs to service_role;

create or replace function public.admit_local_generation_job(
  p_owner uuid, p_key uuid, p_hash text, p_intent jsonb, p_package text, p_device text, p_worker uuid
) returns public.local_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.local_generation_jobs;
begin
  -- One global admission lock; pending and unknown submissions consume capacity.
  perform pg_advisory_xact_lock(735210021);
  select * into existing from public.local_generation_jobs
    where owner_id = p_owner and submission_key = p_key;
  if found then
    if existing.request_hash <> p_hash then raise exception 'idempotency-conflict'; end if;
    return existing;
  end if;
  if (select count(*) from public.local_generation_jobs where state in
    ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) >= 5
    or (select count(*) from public.local_generation_jobs where owner_id = p_owner and state in
    ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) >= 2
    then raise exception 'queue-full'; end if;
  insert into public.local_generation_jobs(owner_id,submission_key,request_hash,intent,package_fingerprint,device_id,worker_identity)
    values(p_owner,p_key,p_hash,p_intent,p_package,p_device,p_worker) returning * into existing;
  return existing;
end $$;
revoke all on function public.admit_local_generation_job(uuid,uuid,text,jsonb,text,text,uuid) from public, anon, authenticated;
grant execute on function public.admit_local_generation_job(uuid,uuid,text,jsonb,text,text,uuid) to service_role;
commit;

