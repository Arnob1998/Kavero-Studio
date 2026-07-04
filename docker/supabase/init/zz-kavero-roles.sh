#!/usr/bin/env bash
set -euo pipefail

PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 \
  -v db_password="$POSTGRES_PASSWORD" \
  --username supabase_admin \
  --dbname "$POSTGRES_DB" <<'EOSQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole;
  end if;
end
$$;

set log_statement = 'none';
set log_min_error_statement = 'panic';
alter role authenticator with password :'db_password';
alter role supabase_auth_admin with password :'db_password';
alter role supabase_storage_admin with password :'db_password';
reset log_min_error_statement;
reset log_statement;

alter role service_role bypassrls;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to supabase_auth_admin;
grant anon, authenticated, service_role to supabase_storage_admin;

create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
create schema if not exists extensions;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;

create or replace function auth.email()
returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')::text
$$;

alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.email() owner to supabase_auth_admin;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.email() to anon, authenticated, service_role;
EOSQL
