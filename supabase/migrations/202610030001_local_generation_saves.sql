-- Local-only save ledger. Existing cloud persistence/schema behavior is unchanged.
begin;
create table if not exists public.local_generation_saves (
  job_id uuid primary key references public.local_generation_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid not null unique default gen_random_uuid(),
  image_id uuid not null unique default gen_random_uuid(),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  destination jsonb not null check (jsonb_typeof(destination)='object'),
  object_mapping jsonb check (object_mapping is null or jsonb_typeof(object_mapping)='object'),
  state text not null check (state in ('saving','save-failed','saved')),
  attempt_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.local_generation_saves enable row level security;
drop policy if exists local_saves_owner_read on public.local_generation_saves;
create policy local_saves_owner_read on public.local_generation_saves for select to authenticated using(owner_id=auth.uid());
revoke all on public.local_generation_saves from anon,authenticated;
grant select on public.local_generation_saves to authenticated;
grant all on public.local_generation_saves to service_role;

create or replace function public.protect_local_save_identity() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.job_id is distinct from old.job_id or new.owner_id is distinct from old.owner_id
    or new.generation_id is distinct from old.generation_id or new.image_id is distinct from old.image_id
    or new.sha256 is distinct from old.sha256 or new.destination is distinct from old.destination
    or new.created_at is distinct from old.created_at
    or (old.object_mapping is not null and new.object_mapping is distinct from old.object_mapping)
    or (old.state='saved' and new.state<>'saved') then raise exception 'immutable-local-save-identity'; end if;
  return new;
end $$;
drop trigger if exists immutable_local_save on public.local_generation_saves;
create trigger immutable_local_save before update on public.local_generation_saves for each row execute function public.protect_local_save_identity();
revoke all on function public.protect_local_save_identity() from public,anon,authenticated;

create or replace function public.claim_local_generation_save(p_owner uuid,p_job uuid,p_token uuid,p_destination jsonb)
returns public.local_generation_saves language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.local_generation_jobs; saved public.local_generation_saves;
begin
  select * into job from public.local_generation_jobs where id=p_job and owner_id=p_owner for update;
  if not found then raise exception 'local-save-not-found'; end if;
  select * into saved from public.local_generation_saves where job_id=p_job and owner_id=p_owner for update;
  if found then
    if saved.state='saved' then return saved; end if;
    if saved.destination is distinct from p_destination then raise exception 'local-save-destination-changed'; end if;
    if saved.state='saving' and saved.lease_until>clock_timestamp() then return saved; end if;
    update public.local_generation_saves set state='saving',attempt_token=p_token,
      lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
      where job_id=p_job returning * into saved;
    return saved;
  end if;
  if job.output_descriptor is null then raise exception 'local-output-not-ready'; end if;
  if p_destination->>'provider' not in ('kavero-managed','google-drive') then raise exception 'local-save-destination-invalid'; end if;
  insert into public.local_generation_saves(job_id,owner_id,sha256,destination,state,attempt_token,lease_until)
    values(p_job,p_owner,job.output_descriptor->>'sha256',p_destination,'saving',p_token,clock_timestamp()+interval '120 seconds') returning * into saved;
  return saved;
end $$;

create or replace function public.checkpoint_local_generation_save(p_owner uuid,p_job uuid,p_token uuid,p_action text,p_mapping jsonb default null)
returns public.local_generation_saves language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.local_generation_saves; job public.local_generation_jobs; image_ref jsonb; meta_ref jsonb; provider text; is_drive boolean;
begin
  -- Same job-first lock ordering as claim and final publication.
  select * into job from public.local_generation_jobs where id=p_job and owner_id=p_owner for update;
  if not found then raise exception 'local-save-not-found'; end if;
  select * into saved from public.local_generation_saves where job_id=p_job and owner_id=p_owner for update;
  if not found then raise exception 'local-save-not-found'; end if;
  if saved.state='saved' then return saved; end if;
  if saved.state<>'saving' or saved.attempt_token<>p_token or saved.lease_until<=clock_timestamp() then raise exception 'local-save-attempt-expired'; end if;
  if p_action='mapping' then
    if saved.object_mapping is not null and saved.object_mapping is distinct from p_mapping then raise exception 'immutable-local-save-mapping'; end if;
    if p_mapping is null or jsonb_typeof(p_mapping)<>'object' or p_mapping->'imageRef'->>'providerId' is distinct from saved.destination->>'provider'
      or p_mapping->'metadataRef'->>'providerId' is distinct from saved.destination->>'provider'
      or p_mapping->'imageRef'->>'purpose' is distinct from 'generated-image'
      or p_mapping->'metadataRef'->>'purpose' is distinct from 'generated-metadata'
      or p_mapping->>'metadataBody' is null or octet_length(p_mapping->>'metadataBody')>16384 then raise exception 'local-save-mapping-invalid'; end if;
    update public.local_generation_saves set object_mapping=p_mapping,updated_at=clock_timestamp() where job_id=p_job returning * into saved;
  elsif p_action='renew' then
    update public.local_generation_saves set lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
      where job_id=p_job returning * into saved;
  elsif p_action='fail' then
    update public.local_generation_saves set state='save-failed',updated_at=clock_timestamp() where job_id=p_job returning * into saved;
  elsif p_action='finish' then
    if saved.object_mapping is null or job.output_descriptor->>'sha256' is distinct from saved.sha256 then raise exception 'local-save-mapping-invalid'; end if;
    image_ref=saved.object_mapping->'imageRef'; meta_ref=saved.object_mapping->'metadataRef'; provider=saved.destination->>'provider'; is_drive=provider='google-drive';
    -- Publish both Gallery rows and the saved receipt atomically. No conflict
    -- overwrite: a failed transaction cannot expose partial history.
    insert into public.generation_runs(id,user_id,prompt,model_id,model_label,settings,generated_text,reference_images,storage_provider,created_at)
      values(saved.generation_id,p_owner,job.intent->>'prompt',job.intent->>'profile','Qwen Image 2.1 Q4 (local evaluation)',
        jsonb_build_object('localJobId',p_job,'width',512,'height',512,'count',1,'steps',20,'cfg',6,'seed',42,'packageFingerprint',job.package_fingerprint),
        null,'[]'::jsonb,provider,saved.created_at);
    insert into public.generated_images(id,user_id,generation_id,variant,mime_type,drive_file_id,drive_file_name,drive_web_view_link,
      drive_metadata_file_id,drive_status,storage_provider,storage_kind,storage_status,storage_ref,metadata_storage_ref,storage_metadata,
      storage_external_id,storage_external_url,created_at)
      values(saved.image_id,p_owner,saved.generation_id,1,'image/png',
        case when is_drive then image_ref->>'externalId' end,
        case when is_drive then image_ref->'metadata'->>'name' end,
        case when is_drive then image_ref->>'externalUrl' end,
        case when is_drive then meta_ref->>'externalId' end,'available',provider,
        case when is_drive then 'connected' else 'managed' end,'available',image_ref,meta_ref,
        jsonb_build_object('providerId',provider,'backendProviderId',saved.destination->>'backendId','imageObjectName',image_ref->'metadata'->>'name','metadataObjectName',meta_ref->'metadata'->>'name','localJobId',p_job,'sha256',saved.sha256),
        case when is_drive then image_ref->>'externalId' end,
        case when is_drive then image_ref->>'externalUrl' end,saved.created_at);
    update public.local_generation_saves set state='saved',updated_at=clock_timestamp() where job_id=p_job returning * into saved;
  else raise exception 'local-save-action-invalid'; end if;
  return saved;
end $$;
revoke all on function public.claim_local_generation_save(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.checkpoint_local_generation_save(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_local_generation_save(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.checkpoint_local_generation_save(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
