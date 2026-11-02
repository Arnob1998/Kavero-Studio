-- MH-3B local-only forward migration. Legacy identities and published history are retained.
begin;
alter table public.local_generation_jobs add column if not exists recipe_snapshot jsonb;
create or replace function public.local_qwen_recipe_snapshot() returns jsonb
language sql immutable set search_path=public,pg_temp as $snapshot$ select '{"schemaVersion":1,"recipeId":"qwen-image-2-1","recipeVersion":1,"profile":"qwen-image-2.1-q4-evaluation","label":"Qwen Image 2.1 Q4 (local evaluation)","source":{"repo":"https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF","revision":"c9dd12108f53974cd1e0abd708df042d6df0ca8d","file":"qwen_image_2.1_Q4_K_M.gguf"},"runtime":{"adapter":"stable-diffusion-cpp","revision":"3f8527a46c54ecf4cb4ed6003da8e8982283c73c","backend":"vulkan"},"manifestHash":"35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822","packageFingerprint":"d9cd1dc7cc93a20c2ffc8cc780393a04cfc6043a5560ddf12f2924c3ea575f07","settings":{"width":512,"height":512,"count":1,"steps":20,"cfg":6,"seed":42,"sampler":"euler"}}'::jsonb $snapshot$;
revoke all on function public.local_qwen_recipe_snapshot() from public,anon,authenticated;
grant execute on function public.local_qwen_recipe_snapshot() to service_role;

create or replace function public.protect_local_job_recipe() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
  or new.submission_key is distinct from old.submission_key or new.request_hash is distinct from old.request_hash
  or new.intent is distinct from old.intent or new.package_fingerprint is distinct from old.package_fingerprint
  or new.device_id is distinct from old.device_id or new.worker_identity is distinct from old.worker_identity
  or new.created_at is distinct from old.created_at or new.recipe_snapshot is distinct from old.recipe_snapshot)
 then raise exception 'immutable-local-job-identity'; end if;
 if new.recipe_snapshot is not null and (
  new.recipe_snapshot is distinct from public.local_qwen_recipe_snapshot()
  or new.recipe_snapshot->>'profile' is distinct from new.intent->>'profile'
  or new.recipe_snapshot->>'packageFingerprint' is distinct from new.package_fingerprint
  or new.recipe_snapshot->'settings'->'width' is distinct from new.intent->'width'
  or new.recipe_snapshot->'settings'->'height' is distinct from new.intent->'height'
  or new.recipe_snapshot->'settings'->'count' is distinct from new.intent->'count')
 then raise exception 'local-job-recipe-mismatch'; end if;
 return new;
end $$;
drop trigger if exists immutable_local_job_recipe on public.local_generation_jobs;
create trigger immutable_local_job_recipe before insert or update on public.local_generation_jobs for each row execute function public.protect_local_job_recipe();
revoke all on function public.protect_local_job_recipe() from public,anon,authenticated;

create or replace function public.protect_local_output_descriptor() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' and old.output_descriptor is not null and new.output_descriptor is distinct from old.output_descriptor then raise exception 'immutable-local-output'; end if;
 if new.output_descriptor is not null and (
  new.output_descriptor->>'jobId' is distinct from new.id::text or new.output_descriptor->>'ownerId' is distinct from new.owner_id::text
  or new.output_descriptor->>'ledgerIdentity' is distinct from new.worker_identity::text
  or new.output_descriptor->>'requestHash' is distinct from new.request_hash
  or new.output_descriptor->>'packageFingerprint' is distinct from new.package_fingerprint
  or new.output_descriptor->>'deviceId' is distinct from new.device_id
  or new.output_descriptor->>'sha256' is null or new.output_descriptor->>'sha256' !~ '^[a-f0-9]{64}$'
  or new.output_descriptor->'recipeSnapshot' is distinct from new.recipe_snapshot
  or new.output_descriptor->'width' is distinct from coalesce(new.recipe_snapshot->'settings'->'width','512'::jsonb)
  or new.output_descriptor->'height' is distinct from coalesce(new.recipe_snapshot->'settings'->'height','512'::jsonb)
  or new.output_descriptor->>'mimeType' is distinct from 'image/png')
 then raise exception 'local-output-identity-mismatch'; end if;
 return new;
end $$;
drop trigger if exists immutable_local_output on public.local_generation_jobs;
create trigger immutable_local_output before insert or update on public.local_generation_jobs for each row execute function public.protect_local_output_descriptor();

create or replace function public.admit_local_generation_job_v2(
  p_owner uuid, p_key uuid, p_hash text, p_intent jsonb, p_package text, p_device text, p_worker uuid, p_snapshot jsonb
) returns public.local_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.local_generation_jobs;
begin
  if p_snapshot is distinct from public.local_qwen_recipe_snapshot() then raise exception 'unsupported-local-recipe'; end if;
  -- One global admission lock; pending and unknown submissions consume capacity.
  perform pg_advisory_xact_lock(735210021);
  select * into existing from public.local_generation_jobs
    where owner_id = p_owner and submission_key = p_key;
  if found then
    if existing.request_hash <> p_hash or existing.recipe_snapshot is distinct from p_snapshot then raise exception 'idempotency-conflict'; end if;
    return existing;
  end if;
  if (select count(*) from public.local_generation_jobs where state in
    ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) >= 5
    or (select count(*) from public.local_generation_jobs where owner_id = p_owner and state in
    ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) >= 2
    then raise exception 'queue-full'; end if;
  insert into public.local_generation_jobs(owner_id,submission_key,request_hash,intent,package_fingerprint,device_id,worker_identity,recipe_snapshot)
    values(p_owner,p_key,p_hash,p_intent,p_package,p_device,p_worker,p_snapshot) returning * into existing;
  return existing;
end $$;

revoke all on function public.admit_local_generation_job_v2(uuid,uuid,text,jsonb,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admit_local_generation_job_v2(uuid,uuid,text,jsonb,text,text,uuid,jsonb) to service_role;

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
      values(saved.generation_id,p_owner,job.intent->>'prompt',coalesce(job.recipe_snapshot->>'recipeId',job.intent->>'profile'),coalesce(job.recipe_snapshot->>'label','Qwen Image 2.1 Q4 (local evaluation)'),
        case when job.recipe_snapshot is null then jsonb_build_object('localJobId',p_job,'width',512,'height',512,'count',1,'steps',20,'cfg',6,'seed',42,'packageFingerprint',job.package_fingerprint) else (job.recipe_snapshot->'settings') || jsonb_build_object('localJobId',p_job,'packageFingerprint',job.package_fingerprint,'recipeSnapshot',job.recipe_snapshot) end,
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

revoke all on function public.checkpoint_local_generation_save(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_local_generation_save(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
