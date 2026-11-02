-- Local internal output acceptance only; no hosted migration or Gallery writes.
begin;
alter table public.local_generation_jobs add column if not exists output_descriptor jsonb;
create or replace function public.protect_local_output_descriptor() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.output_descriptor is not null and new.output_descriptor is distinct from old.output_descriptor then
    raise exception 'immutable-local-output';
  end if;
  if new.output_descriptor is not null and (
    new.output_descriptor->>'jobId' is distinct from new.id::text or
    new.output_descriptor->>'ownerId' is distinct from new.owner_id::text or
    new.output_descriptor->>'ledgerIdentity' is distinct from new.worker_identity::text or
    new.output_descriptor->>'requestHash' is distinct from new.request_hash or
    new.output_descriptor->>'packageFingerprint' is distinct from new.package_fingerprint or
    new.output_descriptor->>'deviceId' is distinct from new.device_id or
    new.output_descriptor->>'sha256' is null or
    new.output_descriptor->>'sha256' !~ '^[a-f0-9]{64}$' or
    new.output_descriptor->>'width' is distinct from '512' or
    new.output_descriptor->>'height' is distinct from '512' or
    new.output_descriptor->>'mimeType' is distinct from 'image/png'
  ) then raise exception 'local-output-identity-mismatch'; end if;
  return new;
end $$;
drop trigger if exists immutable_local_output on public.local_generation_jobs;
create trigger immutable_local_output before update on public.local_generation_jobs
  for each row execute function public.protect_local_output_descriptor();
revoke all on function public.protect_local_output_descriptor() from public,anon,authenticated;
commit;
