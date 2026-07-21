-- Kavero Supabase schema for Auth-owned users, provider keys, and user templates.
-- Run this in the Supabase SQL editor after enabling Auth, Database, and Vault.

create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault" with schema "vault";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_metadata (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  onboarding_complete boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_metadata
  add column if not exists plan text not null default 'free' check (plan in ('free', 'premium'));

create table if not exists public.user_secret_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_name text not null,
  vault_secret_id uuid not null,
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, secret_name)
);

create table if not exists public.user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  provider_label text not null,
  key_hint text,
  vault_secret_id uuid not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);

create table if not exists public.user_drive_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google-drive',
  google_email text,
  folder_id text not null,
  folder_name text not null default 'Kavero Generated Images',
  scope text not null default 'https://www.googleapis.com/auth/drive.file',
  vault_secret_id uuid not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'reconnect_required')),
  folder_status text not null default 'available' check (folder_status in ('available', 'missing', 'unknown')),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  prompt text not null,
  thumbnail_icon jsonb,
  reference_images jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_templates_name_length check (char_length(trim(name)) between 1 and 80),
  constraint prompt_templates_prompt_length check (char_length(trim(prompt)) between 1 and 12000),
  constraint prompt_templates_thumbnail_icon_object check (thumbnail_icon is null or jsonb_typeof(thumbnail_icon) = 'object'),
  constraint prompt_templates_reference_images_array check (jsonb_typeof(reference_images) = 'array')
);

create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  model_id text not null,
  model_label text not null,
  settings jsonb not null default '{}'::jsonb,
  generated_text text,
  reference_images jsonb not null default '[]'::jsonb,
  storage_provider text not null default 'google-drive',
  created_at timestamptz not null default now(),
  constraint generation_runs_prompt_length check (char_length(trim(prompt)) between 1 and 12000),
  constraint generation_runs_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint generation_runs_reference_images_array check (jsonb_typeof(reference_images) = 'array')
);

create table if not exists public.canvas_designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled Design',
  canvas_json text not null default '{}',
  width integer not null default 1080,
  height integer not null default 1080,
  thumbnail_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_designs_name_length check (char_length(trim(name)) between 1 and 120),
  constraint canvas_designs_canvas_json_size check (octet_length(canvas_json) <= 256000),
  constraint canvas_designs_no_embedded_assets check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,'),
  constraint canvas_designs_dimensions check (width between 100 and 8000 and height between 100 and 8000),
  constraint canvas_designs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.canvas_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  design_id uuid not null references public.canvas_designs(id) on delete cascade,
  title text not null default 'Page 1',
  canvas_json text not null default '{}',
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_pages_title_length check (char_length(trim(title)) between 1 and 80),
  constraint canvas_pages_canvas_json_size check (octet_length(canvas_json) <= 256000),
  constraint canvas_pages_no_embedded_assets check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,'),
  constraint canvas_pages_sort_order check (sort_order >= 0),
  constraint canvas_pages_metadata_object check (jsonb_typeof(metadata) = 'object')
);

do $$
begin
  alter table public.canvas_designs
    drop constraint if exists canvas_designs_no_embedded_assets;

  alter table public.canvas_designs
    add constraint canvas_designs_no_embedded_assets
    check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,');

  alter table public.canvas_pages
    drop constraint if exists canvas_pages_no_embedded_assets;

  alter table public.canvas_pages
    add constraint canvas_pages_no_embedded_assets
    check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,');
end;
$$;

create table if not exists public.canvas_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_provider text not null default 'google-drive',
  bucket text not null default 'google-drive',
  storage_path text not null,
  original_name text not null,
  content_type text not null,
  size_bytes integer not null,
  public_url text not null,
  drive_file_id text,
  drive_file_name text,
  drive_web_view_link text,
  drive_status text not null default 'available',
  storage_kind text,
  storage_status text,
  storage_ref jsonb,
  storage_metadata jsonb not null default '{}'::jsonb,
  storage_external_id text,
  storage_external_url text,
  metadata jsonb not null default '{}'::jsonb,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint canvas_assets_storage_provider_check check (storage_provider in ('supabase-storage', 'google-drive', 'kavero-managed')),
  constraint canvas_assets_bucket_check check (bucket in ('canvas-assets', 'google-drive', 'kavero-canvas-assets')),
  constraint canvas_assets_content_type check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint canvas_assets_drive_status_check check (drive_status in ('available', 'missing', 'unknown')),
  constraint canvas_assets_storage_kind_check check (storage_kind is null or storage_kind in ('managed', 'connected')),
  constraint canvas_assets_storage_status_check check (storage_status is null or storage_status in ('available', 'missing', 'unknown', 'reconnect_required', 'unavailable')),
  constraint canvas_assets_storage_ref_object check (storage_ref is null or jsonb_typeof(storage_ref) = 'object'),
  constraint canvas_assets_storage_metadata_object check (jsonb_typeof(storage_metadata) = 'object'),
  constraint canvas_assets_size_check check (size_bytes > 0 and size_bytes <= 10485760),
  constraint canvas_assets_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (bucket, storage_path)
);

create table if not exists public.canvas_templates (
  id text primary key,
  name text not null,
  category text not null,
  canvas_json text not null,
  width integer not null,
  height integer not null,
  thumbnail_url text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  constraint canvas_templates_canvas_json_size check (octet_length(canvas_json) <= 256000),
  constraint canvas_templates_no_embedded_assets check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,'),
  constraint canvas_templates_dimensions check (width between 100 and 8000 and height between 100 and 8000),
  constraint canvas_templates_metadata_object check (jsonb_typeof(metadata) = 'object')
);

alter table public.canvas_designs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.prompt_templates
  add column if not exists thumbnail_icon jsonb;

alter table public.prompt_templates
  drop column if exists thumbnail_url;

alter table public.canvas_pages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.canvas_assets
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.canvas_templates
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.canvas_designs
    drop constraint if exists canvas_designs_metadata_object;
  alter table public.canvas_designs
    add constraint canvas_designs_metadata_object
    check (jsonb_typeof(metadata) = 'object');

  alter table public.prompt_templates
    drop constraint if exists prompt_templates_thumbnail_icon_object;
  alter table public.prompt_templates
    add constraint prompt_templates_thumbnail_icon_object
    check (thumbnail_icon is null or jsonb_typeof(thumbnail_icon) = 'object');

  alter table public.canvas_pages
    drop constraint if exists canvas_pages_metadata_object;
  alter table public.canvas_pages
    add constraint canvas_pages_metadata_object
    check (jsonb_typeof(metadata) = 'object');

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_metadata_object;
  alter table public.canvas_assets
    add constraint canvas_assets_metadata_object
    check (jsonb_typeof(metadata) = 'object');

  alter table public.canvas_templates
    drop constraint if exists canvas_templates_canvas_json_size;
  alter table public.canvas_templates
    add constraint canvas_templates_canvas_json_size
    check (octet_length(canvas_json) <= 256000);

  alter table public.canvas_templates
    drop constraint if exists canvas_templates_no_embedded_assets;
  alter table public.canvas_templates
    add constraint canvas_templates_no_embedded_assets
    check (canvas_json !~* 'data:(image|video|audio|application)/[^;,]+;base64,');

  alter table public.canvas_templates
    drop constraint if exists canvas_templates_dimensions;
  alter table public.canvas_templates
    add constraint canvas_templates_dimensions
    check (width between 100 and 8000 and height between 100 and 8000);

  alter table public.canvas_templates
    drop constraint if exists canvas_templates_metadata_object;
  alter table public.canvas_templates
    add constraint canvas_templates_metadata_object
    check (jsonb_typeof(metadata) = 'object');
end;
$$;

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid not null references public.generation_runs(id) on delete cascade,
  variant integer not null default 1,
  mime_type text not null default 'image/png',
  drive_file_id text,
  drive_file_name text,
  drive_web_view_link text,
  drive_metadata_file_id text,
  drive_status text not null default 'available' check (drive_status in ('available', 'missing', 'unknown')),
  storage_provider text,
  storage_kind text,
  storage_status text,
  storage_ref jsonb,
  metadata_storage_ref jsonb,
  storage_metadata jsonb not null default '{}'::jsonb,
  storage_external_id text,
  storage_external_url text,
  constraint generated_images_storage_kind_check check (storage_kind is null or storage_kind in ('managed', 'connected')),
  constraint generated_images_storage_status_check check (storage_status is null or storage_status in ('available', 'missing', 'unknown', 'reconnect_required', 'unavailable')),
  constraint generated_images_storage_ref_object check (storage_ref is null or jsonb_typeof(storage_ref) = 'object'),
  constraint generated_images_metadata_storage_ref_object check (metadata_storage_ref is null or jsonb_typeof(metadata_storage_ref) = 'object'),
  constraint generated_images_storage_metadata_object check (jsonb_typeof(storage_metadata) = 'object'),
  constraint generated_images_storage_target_check check (storage_ref is not null or drive_file_id is not null),
  created_at timestamptz not null default now()
);

alter table public.generation_runs
  add column if not exists generated_text text;

alter table public.user_drive_connections
  add column if not exists folder_status text not null default 'available' check (folder_status in ('available', 'missing', 'unknown'));

alter table public.user_drive_connections
  add column if not exists canvas_folder_id text,
  add column if not exists canvas_folder_name text not null default 'Kavero Canvas Assets',
  add column if not exists canvas_folder_status text not null default 'unknown' check (canvas_folder_status in ('available', 'missing', 'unknown'));

do $$
begin
  alter table public.user_drive_connections
    drop constraint if exists user_drive_connections_status_check;

  alter table public.user_drive_connections
    add constraint user_drive_connections_status_check
    check (status in ('active', 'revoked', 'reconnect_required'));
end;
$$;

alter table public.generated_images
  add column if not exists drive_status text not null default 'available' check (drive_status in ('available', 'missing', 'unknown'));

alter table public.generated_images
  add column if not exists storage_provider text,
  add column if not exists storage_kind text,
  add column if not exists storage_status text,
  add column if not exists storage_ref jsonb,
  add column if not exists metadata_storage_ref jsonb,
  add column if not exists storage_metadata jsonb not null default '{}'::jsonb,
  add column if not exists storage_external_id text,
  add column if not exists storage_external_url text;

alter table public.generated_images
  alter column drive_file_id drop not null,
  alter column drive_file_name drop not null;

do $$
begin
  alter table public.generated_images
    drop constraint if exists generated_images_storage_kind_check;

  alter table public.generated_images
    add constraint generated_images_storage_kind_check
    check (storage_kind is null or storage_kind in ('managed', 'connected'));

  alter table public.generated_images
    drop constraint if exists generated_images_storage_status_check;

  alter table public.generated_images
    add constraint generated_images_storage_status_check
    check (storage_status is null or storage_status in ('available', 'missing', 'unknown', 'reconnect_required', 'unavailable'));

  alter table public.generated_images
    drop constraint if exists generated_images_storage_ref_object;

  alter table public.generated_images
    add constraint generated_images_storage_ref_object
    check (storage_ref is null or jsonb_typeof(storage_ref) = 'object');

  alter table public.generated_images
    drop constraint if exists generated_images_metadata_storage_ref_object;

  alter table public.generated_images
    add constraint generated_images_metadata_storage_ref_object
    check (metadata_storage_ref is null or jsonb_typeof(metadata_storage_ref) = 'object');

  alter table public.generated_images
    drop constraint if exists generated_images_storage_metadata_object;

  alter table public.generated_images
    add constraint generated_images_storage_metadata_object
    check (jsonb_typeof(storage_metadata) = 'object');

  alter table public.generated_images
    drop constraint if exists generated_images_storage_target_check;

  alter table public.generated_images
    add constraint generated_images_storage_target_check
    check (storage_ref is not null or drive_file_id is not null);
end;
$$;

alter table public.generated_images
  add column if not exists generation_id uuid not null default gen_random_uuid();

alter table public.canvas_designs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists canvas_json text not null default '{}',
  add column if not exists width integer not null default 1080,
  add column if not exists height integer not null default 1080,
  add column if not exists thumbnail_url text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.canvas_pages
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists updated_at timestamptz not null default now();

alter table public.canvas_assets
  add column if not exists storage_provider text not null default 'google-drive',
  add column if not exists drive_file_id text,
  add column if not exists drive_file_name text,
  add column if not exists drive_web_view_link text,
  add column if not exists drive_status text not null default 'available',
  add column if not exists storage_kind text,
  add column if not exists storage_status text,
  add column if not exists storage_ref jsonb,
  add column if not exists storage_metadata jsonb not null default '{}'::jsonb,
  add column if not exists storage_external_id text,
  add column if not exists storage_external_url text;

alter table public.canvas_assets
  alter column storage_provider set default 'google-drive',
  alter column bucket set default 'google-drive';

do $$
begin
  alter table public.canvas_assets
    drop constraint if exists canvas_assets_bucket_check;

  alter table public.canvas_assets
    add constraint canvas_assets_bucket_check
    check (bucket in ('canvas-assets', 'google-drive', 'kavero-canvas-assets'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_storage_provider_check;

  alter table public.canvas_assets
    add constraint canvas_assets_storage_provider_check
    check (storage_provider in ('supabase-storage', 'google-drive', 'kavero-managed'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_drive_status_check;

  alter table public.canvas_assets
    add constraint canvas_assets_drive_status_check
    check (drive_status in ('available', 'missing', 'unknown'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_storage_kind_check;

  alter table public.canvas_assets
    add constraint canvas_assets_storage_kind_check
    check (storage_kind is null or storage_kind in ('managed', 'connected'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_storage_status_check;

  alter table public.canvas_assets
    add constraint canvas_assets_storage_status_check
    check (storage_status is null or storage_status in ('available', 'missing', 'unknown', 'reconnect_required', 'unavailable'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_storage_ref_object;

  alter table public.canvas_assets
    add constraint canvas_assets_storage_ref_object
    check (storage_ref is null or jsonb_typeof(storage_ref) = 'object');

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_storage_metadata_object;

  alter table public.canvas_assets
    add constraint canvas_assets_storage_metadata_object
    check (jsonb_typeof(storage_metadata) = 'object');

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_content_type;

  alter table public.canvas_assets
    add constraint canvas_assets_content_type
    check (content_type in ('image/png', 'image/jpeg', 'image/webp'));

  alter table public.canvas_assets
    drop constraint if exists canvas_assets_size_check;

  alter table public.canvas_assets
    add constraint canvas_assets_size_check
    check (size_bytes > 0 and size_bytes <= 10485760);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'canvas-assets',
  'canvas-assets',
  false,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.canvas_templates (id, name, category, canvas_json, width, height, sort_order) values
('quote-card', 'Quote Card', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1080,"height":1080,"fill":"#1a1a2e"},{"type":"textbox","left":80,"top":300,"width":920,"text":"Your inspiring quote goes here","fontSize":48,"fontFamily":"Playfair Display","fontWeight":"700","fill":"#ffffff","textAlign":"center"},{"type":"textbox","left":80,"top":900,"width":920,"text":"- Author Name","fontSize":24,"fontFamily":"Inter","fontWeight":"500","fill":"#a0a0b0","textAlign":"center"}]}', 1080, 1080, 1),
('stats-highlight', 'Stats Highlight', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1080,"height":1080,"fill":"#0f172a"},{"type":"textbox","left":80,"top":200,"width":920,"text":"87%","fontSize":120,"fontFamily":"Montserrat","fontWeight":"900","fill":"#3b82f6","textAlign":"center"},{"type":"textbox","left":80,"top":400,"width":920,"text":"of professionals agree that AI\nwill transform their industry","fontSize":36,"fontFamily":"Inter","fontWeight":"500","fill":"#e2e8f0","textAlign":"center"},{"type":"textbox","left":80,"top":900,"width":920,"text":"Source: Industry Report 2026","fontSize":18,"fontFamily":"Inter","fontWeight":"400","fill":"#64748b","textAlign":"center"}]}', 1080, 1080, 2),
('announcement', 'Announcement', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1200,"height":627,"fill":"#ffffff"},{"type":"rect","left":0,"top":0,"width":8,"height":627,"fill":"#2563eb"},{"type":"textbox","left":60,"top":80,"width":400,"text":"NEW","fontSize":16,"fontFamily":"Montserrat","fontWeight":"800","fill":"#2563eb","letterSpacing":4},{"type":"textbox","left":60,"top":120,"width":1080,"text":"We are excited to announce\nsomething big","fontSize":48,"fontFamily":"Montserrat","fontWeight":"700","fill":"#0f172a"},{"type":"textbox","left":60,"top":500,"width":1080,"text":"Learn more at yourcompany.com","fontSize":20,"fontFamily":"Inter","fontWeight":"500","fill":"#64748b"}]}', 1200, 627, 3),
('tips-list', 'Tips List', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1080,"height":1080,"fill":"#fafaf9"},{"type":"textbox","left":80,"top":80,"width":920,"text":"5 Tips for Better\nProductivity","fontSize":44,"fontFamily":"Montserrat","fontWeight":"800","fill":"#1c1917"},{"type":"textbox","left":80,"top":280,"width":920,"text":"1. Start with the hardest task\n\n2. Time-block your calendar\n\n3. Limit notifications\n\n4. Take regular breaks\n\n5. Review and reflect daily","fontSize":28,"fontFamily":"Inter","fontWeight":"400","fill":"#44403c","lineHeight":1.6}]}', 1080, 1080, 4),
('profile-card', 'Profile Card', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1080,"height":1080,"fill":"#18181b"},{"type":"circle","left":440,"top":180,"radius":100,"fill":"#3f3f46"},{"type":"textbox","left":80,"top":420,"width":920,"text":"Jane Smith","fontSize":40,"fontFamily":"Montserrat","fontWeight":"700","fill":"#fafafa","textAlign":"center"},{"type":"textbox","left":80,"top":490,"width":920,"text":"Product Designer @ TechCo","fontSize":22,"fontFamily":"Inter","fontWeight":"400","fill":"#a1a1aa","textAlign":"center"},{"type":"textbox","left":140,"top":600,"width":800,"text":"Passionate about creating intuitive user experiences that make complex tools feel simple.","fontSize":20,"fontFamily":"Inter","fontWeight":"400","fill":"#d4d4d8","textAlign":"center"}]}', 1080, 1080, 5),
('minimal-text', 'Minimal Text', 'linkedin', '{"version":"6.0.0","objects":[{"type":"rect","left":0,"top":0,"width":1080,"height":1080,"fill":"#f8fafc"},{"type":"textbox","left":120,"top":380,"width":840,"text":"Less is more.","fontSize":64,"fontFamily":"Playfair Display","fontWeight":"600","fill":"#0f172a","textAlign":"center"},{"type":"textbox","left":120,"top":520,"width":840,"text":"Sometimes the simplest message\nhas the biggest impact.","fontSize":22,"fontFamily":"Inter","fontWeight":"400","fill":"#64748b","textAlign":"center"}]}', 1080, 1080, 6)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  canvas_json = excluded.canvas_json,
  width = excluded.width,
  height = excluded.height,
  sort_order = excluded.sort_order;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generated_images'
      and column_name = 'prompt'
  ) then
    insert into public.generation_runs (
      id,
      user_id,
      prompt,
      model_id,
      model_label,
      settings,
      generated_text,
      reference_images,
      storage_provider,
      created_at
    )
    select
      image.generation_id,
      image.user_id,
      max(image.prompt),
      max(image.model_id),
      max(image.model_label),
      coalesce((array_agg(image.settings order by image.created_at asc))[1], '{}'::jsonb),
      nullif(string_agg(distinct image.generated_text, E'\n\n'), ''),
      coalesce((array_agg(image.reference_images order by image.created_at asc))[1], '[]'::jsonb),
      coalesce(max(image.storage_provider), 'google-drive'),
      min(image.created_at)
    from public.generated_images image
    where not exists (
      select 1
      from public.generation_runs run
      where run.id = image.generation_id
    )
    group by image.generation_id, image.user_id;

    alter table public.generated_images
      drop column if exists prompt,
      drop column if exists model_id,
      drop column if exists model_label,
      drop column if exists settings,
      drop column if exists generated_text,
      drop column if exists reference_images,
      drop column if exists storage_provider;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generated_images_generation_id_fkey'
      and conrelid = 'public.generated_images'::regclass
  ) then
    alter table public.generated_images
      add constraint generated_images_generation_id_fkey
      foreign key (generation_id)
      references public.generation_runs(id)
      on delete cascade;
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_metadata enable row level security;
alter table public.user_secret_refs enable row level security;
alter table public.user_provider_keys enable row level security;
alter table public.user_drive_connections enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.canvas_designs enable row level security;
alter table public.canvas_pages enable row level security;
alter table public.canvas_assets enable row level security;
alter table public.canvas_templates enable row level security;
alter table public.generation_runs enable row level security;
alter table public.generated_images enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on public.profiles to authenticated, service_role;
grant select, insert, update on public.user_metadata to authenticated, service_role;
grant select, insert, delete on public.user_secret_refs to authenticated, service_role;
grant select, insert, update, delete on public.user_provider_keys to service_role;
grant select on public.user_drive_connections to authenticated;
grant select, insert, update, delete on public.user_drive_connections to service_role;
grant select, insert, update, delete on public.prompt_templates to authenticated, service_role;
grant select, insert, update, delete on public.canvas_designs to authenticated, service_role;
grant select, insert, update, delete on public.canvas_pages to authenticated, service_role;
grant select, insert, update, delete on public.canvas_assets to authenticated, service_role;
grant select on public.canvas_templates to anon, authenticated, service_role;
grant select, insert, update, delete on public.generation_runs to authenticated, service_role;
grant select, insert, update, delete on public.generated_images to authenticated, service_role;
revoke all on vault.decrypted_secrets from anon;
revoke all on vault.decrypted_secrets from authenticated;
revoke all on vault.decrypted_secrets from service_role;

create index if not exists idx_user_provider_keys_user
  on public.user_provider_keys (user_id);

create index if not exists idx_user_drive_connections_user
  on public.user_drive_connections (user_id, provider, status);

create index if not exists idx_prompt_templates_user_sort
  on public.prompt_templates (user_id, sort_order, created_at desc);

create index if not exists idx_canvas_designs_user_updated
  on public.canvas_designs (user_id, updated_at desc);

create index if not exists idx_canvas_pages_design_sort
  on public.canvas_pages (user_id, design_id, sort_order);

create index if not exists idx_canvas_assets_user_created
  on public.canvas_assets (user_id, created_at desc);

create index if not exists idx_canvas_assets_user_last_used
  on public.canvas_assets (user_id, last_used_at);

create index if not exists idx_canvas_templates_sort
  on public.canvas_templates (sort_order);

create index if not exists idx_generation_runs_user_created
  on public.generation_runs (user_id, created_at desc);

create index if not exists idx_generated_images_user_created
  on public.generated_images (user_id, created_at desc);

create index if not exists idx_generated_images_user_generation
  on public.generated_images (user_id, generation_id, created_at desc);

drop policy if exists "Profiles are viewable by owner" on public.profiles;
create policy "Profiles are viewable by owner"
  on public.profiles for select
  using ((select auth.uid()) = id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Metadata is viewable by owner" on public.user_metadata;
create policy "Metadata is viewable by owner"
  on public.user_metadata for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Metadata is insertable by owner" on public.user_metadata;
create policy "Metadata is insertable by owner"
  on public.user_metadata for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Metadata is updatable by owner" on public.user_metadata;
create policy "Metadata is updatable by owner"
  on public.user_metadata for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Secret references are viewable by owner" on public.user_secret_refs;
create policy "Secret references are viewable by owner"
  on public.user_secret_refs for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Secret references are insertable by owner" on public.user_secret_refs;
create policy "Secret references are insertable by owner"
  on public.user_secret_refs for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Secret references are deletable by owner" on public.user_secret_refs;
create policy "Secret references are deletable by owner"
  on public.user_secret_refs for delete
  using ((select auth.uid()) = user_id);

drop policy if exists "Provider keys are viewable by owner" on public.user_provider_keys;
create policy "Provider keys are viewable by owner"
  on public.user_provider_keys for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Drive connections are viewable by owner" on public.user_drive_connections;
create policy "Drive connections are viewable by owner"
  on public.user_drive_connections for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Prompt templates are viewable by owner" on public.prompt_templates;
create policy "Prompt templates are viewable by owner"
  on public.prompt_templates for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Prompt templates are insertable by owner" on public.prompt_templates;
create policy "Prompt templates are insertable by owner"
  on public.prompt_templates for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Prompt templates are updatable by owner" on public.prompt_templates;
create policy "Prompt templates are updatable by owner"
  on public.prompt_templates for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Prompt templates are deletable by owner" on public.prompt_templates;
create policy "Prompt templates are deletable by owner"
  on public.prompt_templates for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas designs are viewable by owner" on public.canvas_designs;
create policy "Canvas designs are viewable by owner"
  on public.canvas_designs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas designs are insertable by owner" on public.canvas_designs;
create policy "Canvas designs are insertable by owner"
  on public.canvas_designs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas designs are updatable by owner" on public.canvas_designs;
create policy "Canvas designs are updatable by owner"
  on public.canvas_designs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas designs are deletable by owner" on public.canvas_designs;
create policy "Canvas designs are deletable by owner"
  on public.canvas_designs for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas pages are viewable by owner" on public.canvas_pages;
create policy "Canvas pages are viewable by owner"
  on public.canvas_pages for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas pages are insertable by owner" on public.canvas_pages;
create policy "Canvas pages are insertable by owner"
  on public.canvas_pages for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas pages are updatable by owner" on public.canvas_pages;
create policy "Canvas pages are updatable by owner"
  on public.canvas_pages for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas pages are deletable by owner" on public.canvas_pages;
create policy "Canvas pages are deletable by owner"
  on public.canvas_pages for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas assets are viewable by owner" on public.canvas_assets;
create policy "Canvas assets are viewable by owner"
  on public.canvas_assets for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas assets are insertable by owner" on public.canvas_assets;
create policy "Canvas assets are insertable by owner"
  on public.canvas_assets for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas assets are updatable by owner" on public.canvas_assets;
create policy "Canvas assets are updatable by owner"
  on public.canvas_assets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Canvas assets are deletable by owner" on public.canvas_assets;
create policy "Canvas assets are deletable by owner"
  on public.canvas_assets for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Canvas templates are public" on public.canvas_templates;
create policy "Canvas templates are public"
  on public.canvas_templates for select
  using (true);

drop policy if exists "Canvas assets are publicly readable" on storage.objects;
create policy "Canvas assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'canvas-assets');

drop policy if exists "Generated images are viewable by owner" on public.generated_images;
create policy "Generated images are viewable by owner"
  on public.generated_images for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Generation runs are viewable by owner" on public.generation_runs;
create policy "Generation runs are viewable by owner"
  on public.generation_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Generated images are insertable by owner" on public.generated_images;
create policy "Generated images are insertable by owner"
  on public.generated_images for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Generation runs are insertable by owner" on public.generation_runs;
create policy "Generation runs are insertable by owner"
  on public.generation_runs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Generated images are deletable by owner" on public.generated_images;
create policy "Generated images are deletable by owner"
  on public.generated_images for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Generated images are updatable by owner" on public.generated_images;
create policy "Generated images are updatable by owner"
  on public.generated_images for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Generation runs are deletable by owner" on public.generation_runs;
create policy "Generation runs are deletable by owner"
  on public.generation_runs for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_metadata_set_updated_at on public.user_metadata;
create trigger user_metadata_set_updated_at
  before update on public.user_metadata
  for each row execute function public.set_updated_at();

drop trigger if exists user_provider_keys_set_updated_at on public.user_provider_keys;
create trigger user_provider_keys_set_updated_at
  before update on public.user_provider_keys
  for each row execute function public.set_updated_at();

drop trigger if exists user_drive_connections_set_updated_at on public.user_drive_connections;
create trigger user_drive_connections_set_updated_at
  before update on public.user_drive_connections
  for each row execute function public.set_updated_at();

drop trigger if exists prompt_templates_set_updated_at on public.prompt_templates;
create trigger prompt_templates_set_updated_at
  before update on public.prompt_templates
  for each row execute function public.set_updated_at();

drop trigger if exists canvas_designs_set_updated_at on public.canvas_designs;
create trigger canvas_designs_set_updated_at
  before update on public.canvas_designs
  for each row execute function public.set_updated_at();

drop trigger if exists canvas_pages_set_updated_at on public.canvas_pages;
create trigger canvas_pages_set_updated_at
  before update on public.canvas_pages
  for each row execute function public.set_updated_at();

create or replace function public.touch_canvas_design_from_page()
returns trigger
language plpgsql
as $$
begin
  update public.canvas_designs
  set updated_at = now()
  where id = coalesce(new.design_id, old.design_id);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists canvas_pages_touch_design on public.canvas_pages;
create trigger canvas_pages_touch_design
  after insert or update or delete on public.canvas_pages
  for each row execute function public.touch_canvas_design_from_page();

create or replace function public.delete_canvas_asset_storage_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if old.storage_provider <> 'supabase-storage' or old.bucket <> 'canvas-assets' then
    return old;
  end if;

  delete from storage.objects
  where bucket_id = old.bucket
    and name = old.storage_path;

  return old;
end;
$$;

drop trigger if exists canvas_assets_delete_storage_object on public.canvas_assets;
create trigger canvas_assets_delete_storage_object
  after delete on public.canvas_assets
  for each row execute function public.delete_canvas_asset_storage_object();

create or replace function public.enforce_canvas_asset_limit()
returns trigger
language plpgsql
as $$
declare
  asset_count integer;
begin
  select count(*)
  into asset_count
  from public.canvas_assets
  where user_id = new.user_id;

  if asset_count >= 200 then
    raise exception 'Canvas asset limit reached';
  end if;

  return new;
end;
$$;

drop trigger if exists canvas_assets_limit on public.canvas_assets;
create trigger canvas_assets_limit
  before insert on public.canvas_assets
  for each row execute function public.enforce_canvas_asset_limit();

create or replace function public.shift_canvas_pages_after(
  p_design_id uuid,
  p_user_id uuid,
  p_after_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.canvas_pages
  set sort_order = sort_order + 1,
      updated_at = now()
  where design_id = p_design_id
    and user_id = p_user_id
    and sort_order > p_after_sort_order;
end;
$$;

revoke all on function public.shift_canvas_pages_after(uuid, uuid, integer) from public;
revoke all on function public.shift_canvas_pages_after(uuid, uuid, integer) from anon;
revoke all on function public.shift_canvas_pages_after(uuid, uuid, integer) from authenticated;
grant execute on function public.shift_canvas_pages_after(uuid, uuid, integer) to service_role;

create or replace function public.delete_canvas_data_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.canvas_assets
  where user_id = p_user_id;

  delete from public.canvas_designs
  where user_id = p_user_id;
end;
$$;

revoke all on function public.delete_canvas_data_for_user(uuid) from public;
revoke all on function public.delete_canvas_data_for_user(uuid) from anon;
revoke all on function public.delete_canvas_data_for_user(uuid) from authenticated;
grant execute on function public.delete_canvas_data_for_user(uuid) to service_role;

create or replace function public.delete_stale_canvas_assets(p_older_than interval default interval '90 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.canvas_assets
  where last_used_at < now() - p_older_than;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_stale_canvas_assets(interval) from public;
revoke all on function public.delete_stale_canvas_assets(interval) from anon;
revoke all on function public.delete_stale_canvas_assets(interval) from authenticated;
grant execute on function public.delete_stale_canvas_assets(interval) to service_role;

create or replace function public.delete_inactive_free_canvas_data(p_older_than interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.canvas_assets asset
  using public.user_metadata metadata
  where metadata.user_id = asset.user_id
    and metadata.plan = 'free'
    and not exists (
      select 1
      from public.canvas_designs design
      where design.user_id = asset.user_id
        and design.updated_at >= now() - p_older_than
    )
    and asset.created_at < now() - p_older_than;

  delete from public.canvas_designs design
  using public.user_metadata metadata
  where metadata.user_id = design.user_id
    and metadata.plan = 'free'
    and design.updated_at < now() - p_older_than;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_inactive_free_canvas_data(interval) from public;
revoke all on function public.delete_inactive_free_canvas_data(interval) from anon;
revoke all on function public.delete_inactive_free_canvas_data(interval) from authenticated;
grant execute on function public.delete_inactive_free_canvas_data(interval) to service_role;

create or replace function public.enforce_prompt_template_limit()
returns trigger
language plpgsql
as $$
declare
  template_count integer;
begin
  select count(*)
  into template_count
  from public.prompt_templates
  where user_id = new.user_id;

  if template_count >= 3 then
    raise exception 'Prompt template limit reached';
  end if;

  return new;
end;
$$;

drop trigger if exists prompt_templates_limit on public.prompt_templates;
create trigger prompt_templates_limit
  before insert on public.prompt_templates
  for each row execute function public.enforce_prompt_template_limit();

create or replace function public.upsert_provider_key(
  p_user_id uuid,
  p_provider_id text,
  p_secret text,
  p_key_hint text default null
)
returns public.user_provider_keys
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_key public.user_provider_keys;
  next_secret_id uuid;
  next_provider_label text;
  next_secret_name text;
  next_secret_description text;
  credentials_json jsonb;
  saved_key public.user_provider_keys;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  if p_provider_id is null or p_provider_id not in (
    'google-gemini',
    'openai',
    'groq',
    'azure-openai',
    'azure-openai-image',
    'openai-compatible'
  ) then
    raise exception 'Provider is not available yet';
  end if;

  if p_secret is null or char_length(trim(p_secret)) = 0 then
    raise exception 'Provider credentials are required';
  end if;

  if p_provider_id in ('google-gemini', 'openai', 'groq')
    and char_length(trim(p_secret)) < 20 then
    raise exception 'API key is too short';
  end if;

  if p_provider_id in ('azure-openai', 'azure-openai-image', 'openai-compatible') then
    begin
      credentials_json := p_secret::jsonb;
    exception when others then
      raise exception 'Provider credentials must be valid JSON';
    end;

    if jsonb_typeof(credentials_json) <> 'object'
      or nullif(trim(credentials_json ->> 'apiBase'), '') is null then
      raise exception 'Provider API base is required';
    end if;

    if p_provider_id in ('azure-openai', 'azure-openai-image') and (
      nullif(trim(credentials_json ->> 'apiKey'), '') is null
      or char_length(trim(credentials_json ->> 'apiKey')) < 20
      or nullif(trim(credentials_json ->> 'apiVersion'), '') is null
    ) then
      raise exception 'Azure OpenAI credentials are incomplete';
    end if;

    if p_provider_id = 'openai-compatible'
      and credentials_json ? 'apiKey'
      and (
        nullif(trim(credentials_json ->> 'apiKey'), '') is null
        or char_length(trim(credentials_json ->> 'apiKey')) < 20
      ) then
      raise exception 'OpenAI-compatible API key is too short';
    end if;
  end if;

  next_provider_label := case p_provider_id
    when 'google-gemini' then 'Google Gemini'
    when 'openai' then 'OpenAI'
    when 'groq' then 'Groq'
    when 'azure-openai' then 'Azure OpenAI'
    when 'azure-openai-image' then 'Azure OpenAI (Image)'
    when 'openai-compatible' then 'OpenAI-compatible'
  end;
  next_secret_name := 'user:' || p_user_id::text || ':provider:' || p_provider_id;
  next_secret_description := next_provider_label || case
    when p_provider_id in ('azure-openai', 'azure-openai-image', 'openai-compatible') then ' credentials'
    else ' API key'
  end;

  select *
  into existing_key
  from public.user_provider_keys
  where user_id = p_user_id
    and provider_id = p_provider_id;

  if existing_key.id is null then
    select vault.create_secret(
      p_secret,
      next_secret_name,
      next_secret_description
    )
    into next_secret_id;
  else
    next_secret_id := existing_key.vault_secret_id;

    perform vault.update_secret(
      next_secret_id,
      p_secret,
      next_secret_name,
      next_secret_description
    );
  end if;

  insert into public.user_provider_keys (
    user_id,
    provider_id,
    provider_label,
    key_hint,
    vault_secret_id,
    status,
    last_checked_at
  )
  values (
    p_user_id,
    p_provider_id,
    next_provider_label,
    p_key_hint,
    next_secret_id,
    'active',
    now()
  )
  on conflict (user_id, provider_id) do update set
    provider_label = excluded.provider_label,
    key_hint = excluded.key_hint,
    vault_secret_id = excluded.vault_secret_id,
    status = 'active',
    last_checked_at = excluded.last_checked_at,
    updated_at = now()
  returning *
  into saved_key;

  return saved_key;
end;
$$;

revoke all on function public.upsert_provider_key(uuid, text, text, text) from public;
revoke all on function public.upsert_provider_key(uuid, text, text, text) from anon;
revoke all on function public.upsert_provider_key(uuid, text, text, text) from authenticated;
grant execute on function public.upsert_provider_key(uuid, text, text, text) to service_role;

create or replace function public.get_provider_key(
  p_user_id uuid,
  p_provider_id text
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  stored_secret text;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  select decrypted.decrypted_secret
  into stored_secret
  from public.user_provider_keys provider_key
  join vault.decrypted_secrets decrypted
    on decrypted.id = provider_key.vault_secret_id
  where provider_key.user_id = p_user_id
    and provider_key.provider_id = p_provider_id
    and provider_key.status = 'active'
  limit 1;

  return stored_secret;
end;
$$;

revoke all on function public.get_provider_key(uuid, text) from public;
revoke all on function public.get_provider_key(uuid, text) from anon;
revoke all on function public.get_provider_key(uuid, text) from authenticated;
grant execute on function public.get_provider_key(uuid, text) to service_role;

create or replace function public.upsert_google_drive_connection(
  p_user_id uuid,
  p_refresh_token text,
  p_google_email text,
  p_folder_id text,
  p_folder_name text default 'Kavero Generated Images',
  p_scope text default 'https://www.googleapis.com/auth/drive.file'
)
returns public.user_drive_connections
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_connection public.user_drive_connections;
  next_secret_id uuid;
  next_secret_name text;
  saved_connection public.user_drive_connections;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  if p_refresh_token is null or char_length(trim(p_refresh_token)) < 20 then
    raise exception 'Refresh token is too short';
  end if;

  if p_folder_id is null or char_length(trim(p_folder_id)) < 3 then
    raise exception 'Google Drive folder is required';
  end if;

  next_secret_name := 'user:' || p_user_id::text || ':integration:google-drive';

  select *
  into existing_connection
  from public.user_drive_connections
  where user_id = p_user_id
    and provider = 'google-drive';

  if existing_connection.id is null then
    select vault.create_secret(
      p_refresh_token,
      next_secret_name,
      'Google Drive refresh token'
    )
    into next_secret_id;
  else
    next_secret_id := existing_connection.vault_secret_id;

    perform vault.update_secret(
      next_secret_id,
      p_refresh_token,
      next_secret_name,
      'Google Drive refresh token'
    );
  end if;

  insert into public.user_drive_connections (
    user_id,
    provider,
    google_email,
    folder_id,
    folder_name,
    scope,
    vault_secret_id,
    status,
    connected_at
  )
  values (
    p_user_id,
    'google-drive',
    p_google_email,
    p_folder_id,
    coalesce(nullif(trim(p_folder_name), ''), 'Kavero Generated Images'),
    coalesce(nullif(trim(p_scope), ''), 'https://www.googleapis.com/auth/drive.file'),
    next_secret_id,
    'active',
    now()
  )
  on conflict (user_id, provider) do update set
    google_email = excluded.google_email,
    folder_id = excluded.folder_id,
    folder_name = excluded.folder_name,
    scope = excluded.scope,
    vault_secret_id = excluded.vault_secret_id,
    status = 'active',
    connected_at = excluded.connected_at,
    updated_at = now()
  returning *
  into saved_connection;

  return saved_connection;
end;
$$;

revoke all on function public.upsert_google_drive_connection(uuid, text, text, text, text, text) from public;
revoke all on function public.upsert_google_drive_connection(uuid, text, text, text, text, text) from anon;
revoke all on function public.upsert_google_drive_connection(uuid, text, text, text, text, text) from authenticated;
grant execute on function public.upsert_google_drive_connection(uuid, text, text, text, text, text) to service_role;

create or replace function public.get_google_drive_refresh_token(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  stored_secret text;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  select decrypted.decrypted_secret
  into stored_secret
  from public.user_drive_connections connection
  join vault.decrypted_secrets decrypted
    on decrypted.id = connection.vault_secret_id
  where connection.user_id = p_user_id
    and connection.provider = 'google-drive'
    and connection.status = 'active'
  limit 1;

  return stored_secret;
end;
$$;

revoke all on function public.get_google_drive_refresh_token(uuid) from public;
revoke all on function public.get_google_drive_refresh_token(uuid) from anon;
revoke all on function public.get_google_drive_refresh_token(uuid) from authenticated;
grant execute on function public.get_google_drive_refresh_token(uuid) to service_role;

create or replace function public.disconnect_google_drive(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  update public.user_drive_connections
  set status = 'revoked',
      folder_status = 'unknown',
      updated_at = now()
  where user_id = p_user_id
    and provider = 'google-drive';
end;
$$;

revoke all on function public.disconnect_google_drive(uuid) from public;
revoke all on function public.disconnect_google_drive(uuid) from anon;
revoke all on function public.disconnect_google_drive(uuid) from authenticated;
grant execute on function public.disconnect_google_drive(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  insert into public.user_metadata (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Provider API keys are written through public.upsert_provider_key by trusted server code.
notify pgrst, 'reload schema';
