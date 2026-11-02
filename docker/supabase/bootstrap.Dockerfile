FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/bootstrap-compose-supabase.mjs ./scripts/bootstrap-compose-supabase.mjs
COPY supabase/schema.sql ./supabase/schema.sql
COPY supabase/local-foundation.sql ./supabase/local-foundation.sql
COPY supabase/migrations/202610020001_local_generation_jobs.sql ./supabase/migrations/202610020001_local_generation_jobs.sql
COPY supabase/migrations/202610020002_local_generation_outputs.sql ./supabase/migrations/202610020002_local_generation_outputs.sql
COPY supabase/migrations/202610030001_local_generation_saves.sql ./supabase/migrations/202610030001_local_generation_saves.sql

CMD ["node", "scripts/bootstrap-compose-supabase.mjs"]
