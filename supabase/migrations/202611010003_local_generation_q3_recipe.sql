-- MH-3C local-only trusted Q3 recipe. Existing Q4 snapshots/hashes are unchanged.
begin;
create or replace function public.local_q3_recipe_snapshot() returns jsonb
language sql immutable set search_path=public,pg_temp as $snapshot$ select '{"schemaVersion":1,"recipeId":"qwen-image-2-1-q3","recipeVersion":1,"profile":"qwen-image-2.1-q3-evaluation","label":"Qwen Image 2.1 Q3 (local evaluation)","source":{"repo":"https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF","revision":"c9dd12108f53974cd1e0abd708df042d6df0ca8d","file":"qwen_image_2.1_Q3_K_M.gguf"},"runtime":{"adapter":"stable-diffusion-cpp","revision":"3f8527a46c54ecf4cb4ed6003da8e8982283c73c","backend":"vulkan"},"manifestHash":"d730d6d53b7c7fb0c39d5fce0a60c93ae1b00113db3ec4009854463e0c5c29bb","packageFingerprint":"c058d31ce26726e7a1a746b05a1f446594e96f68ca564ee34735ec3e07db48ee","settings":{"width":512,"height":512,"count":1,"steps":20,"cfg":6,"seed":42,"sampler":"euler"}}'::jsonb $snapshot$;
create or replace function public.local_recipe_snapshot_supported(value jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$ select coalesce(value=public.local_qwen_recipe_snapshot() or value=public.local_q3_recipe_snapshot(),false) $$;
revoke all on function public.local_q3_recipe_snapshot(),public.local_recipe_snapshot_supported(jsonb) from public,anon,authenticated;
grant execute on function public.local_q3_recipe_snapshot(),public.local_recipe_snapshot_supported(jsonb) to service_role;
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
  not public.local_recipe_snapshot_supported(new.recipe_snapshot)
  or new.recipe_snapshot->>'profile' is distinct from new.intent->>'profile'
  or new.recipe_snapshot->>'packageFingerprint' is distinct from new.package_fingerprint
  or new.recipe_snapshot->'settings'->'width' is distinct from new.intent->'width'
  or new.recipe_snapshot->'settings'->'height' is distinct from new.intent->'height'
  or new.recipe_snapshot->'settings'->'count' is distinct from new.intent->'count')
 then raise exception 'local-job-recipe-mismatch'; end if;
 return new;
end $$;

create or replace function public.admit_local_generation_job_v2(
  p_owner uuid, p_key uuid, p_hash text, p_intent jsonb, p_package text, p_device text, p_worker uuid, p_snapshot jsonb
) returns public.local_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.local_generation_jobs;
begin
  if not public.local_recipe_snapshot_supported(p_snapshot) then raise exception 'unsupported-local-recipe'; end if;
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


notify pgrst,'reload schema';
commit;
