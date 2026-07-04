#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 \
  -v db_password="$POSTGRES_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser createdb createrole replication bypassrls;
  end if;
end
$$;

set log_statement = 'none';
alter role supabase_admin with password :'db_password';
reset log_statement;
EOSQL
