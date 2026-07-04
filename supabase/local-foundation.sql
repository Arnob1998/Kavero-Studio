-- Kavero local Supabase foundation.
-- Apply after supabase/schema.sql to make local bootstrap prerequisites explicit.

create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault" with schema "vault";

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'canvas-assets',
    'canvas-assets',
    false,
    1048576,
    array['image/png', 'image/jpeg', 'image/webp']
  ),
  (
    'kavero-generated-images',
    'kavero-generated-images',
    false,
    52428800,
    array['image/png', 'image/jpeg', 'image/webp']
  ),
  (
    'kavero-generated-metadata',
    'kavero-generated-metadata',
    false,
    1048576,
    array['application/json']
  ),
  (
    'kavero-canvas-assets',
    'kavero-canvas-assets',
    false,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
