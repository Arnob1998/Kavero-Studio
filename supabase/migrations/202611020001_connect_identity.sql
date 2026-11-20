-- Opt-in Connect identity only. Apply explicitly; does not change local jobs.
begin;
create table public.connect_devices (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  origin text not null,
  installation_id uuid not null,
  name text not null check (length(name) between 1 and 60),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{59}$'),
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  last_seen_at timestamptz,
  epoch uuid,
  report jsonb
);
create unique index connect_active_installation on public.connect_devices(origin,installation_id) where revoked_at is null;
create index connect_device_owner on public.connect_devices(owner_id,origin);
create table public.connect_pairings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  origin text not null,
  name text not null,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  state text not null default 'pending' check (state in ('pending','claimed','confirmed','cancelled')),
  installation_id uuid,
  public_key text,
  fingerprint text,
  device_id uuid
);
create index connect_pairing_owner on public.connect_pairings(owner_id,created_at);
create table public.connect_nonces (
  device_id uuid not null references public.connect_devices(id) on delete cascade,
  nonce uuid not null,
  expires_at timestamptz not null default now() + interval '2 minutes',
  primary key(device_id,nonce)
);
create table public.connect_rates (
  bucket text not null,
  window_id bigint not null,
  count integer not null,
  expires_at timestamptz not null default now()+interval '1 day',
  primary key(bucket,window_id)
);
alter table public.connect_devices enable row level security;
alter table public.connect_pairings enable row level security;
alter table public.connect_nonces enable row level security;
alter table public.connect_rates enable row level security;
revoke all on public.connect_devices,public.connect_pairings,public.connect_nonces,public.connect_rates from public,anon,authenticated;
grant all on public.connect_devices,public.connect_pairings,public.connect_nonces,public.connect_rates to service_role;

-- Return false rather than raise: a rejected attempt must still consume budget.
create function public.connect_rate(p_bucket text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path = public,pg_temp as $$
declare n integer; w bigint := floor(extract(epoch from now()) / p_seconds);
begin
  insert into connect_rates(bucket,window_id,count) values(p_bucket,w,1)
  on conflict(bucket,window_id) do update set count=least(connect_rates.count+1,1000000) returning count into n;
  return n <= p_limit;
end $$;

create function public.connect_owner(p_owner uuid,p_origin text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public,pg_temp as $$
declare p connect_pairings; d connect_devices; rows jsonb;
begin
  -- Serialize owner enrollment and inventory mutations, including device quota.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 97211));
  if not exists(select 1 from auth.users where id=p_owner) then return jsonb_build_object('error','unauthorized'); end if;
  if p_action='create' then
    if not connect_rate('owner:'||p_owner,5,600) then return jsonb_build_object('error','rate-limited'); end if;
    delete from connect_pairings where id in (select id from connect_pairings where expires_at<now()-interval '1 day' limit 100);
    delete from connect_rates where (bucket,window_id) in (select bucket,window_id from connect_rates where expires_at<now() limit 1000);
    if (select count(*) from connect_devices where owner_id=p_owner and revoked_at is null and expires_at>now())>=10 then return jsonb_build_object('error','device-limit'); end if;
    insert into connect_pairings(owner_id,origin,name,code_hash) values(p_owner,p_origin,p_input->>'name',p_input->>'codeHash') returning * into p;
  elsif p_action in ('inspect','confirm','cancel') then
    select * into p from connect_pairings where id=(p_input->>'id')::uuid and owner_id=p_owner and origin=p_origin for update;
    if not found then return jsonb_build_object('error','not-found'); end if;
    if p_action='confirm' then
      if p.state not in ('claimed','confirmed') or p.expires_at<=now() then return jsonb_build_object('error','pairing-unavailable'); end if;
      if p.fingerprint is distinct from p_input->>'fingerprint' or p.installation_id::text is distinct from p_input->>'installationId' then return jsonb_build_object('error','identity-changed'); end if;
      if p.state='claimed' then
        perform pg_advisory_xact_lock(hashtextextended(p_origin||p.installation_id::text,97212));
        if (select count(*) from connect_devices where owner_id=p_owner and revoked_at is null and expires_at>now())>=10 then return jsonb_build_object('error','device-limit'); end if;
        -- Explicit re-pair of an expired installation is allowed with a new ID.
        update connect_devices set revoked_at=now() where origin=p_origin and installation_id=p.installation_id and expires_at<=now() and revoked_at is null;
        if exists(select 1 from connect_devices where origin=p_origin and installation_id=p.installation_id and revoked_at is null) then return jsonb_build_object('error','installation-paired'); end if;
        insert into connect_devices(id,owner_id,origin,installation_id,name,public_key)
        values(p.device_id,p_owner,p_origin,p.installation_id,p.name,p.public_key);
        update connect_pairings set state='confirmed' where id=p.id returning * into p;
      end if;
    elsif p_action='cancel' and p.state in ('pending','claimed') then
      update connect_pairings set state='cancelled' where id=p.id returning * into p;
    end if;
  elsif p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'installationId',q.installation_id,
      'createdAt',q.created_at,'expiresAt',q.expires_at,'revokedAt',q.revoked_at,'lastSeenAt',q.last_seen_at,
      'connected',coalesce(q.last_seen_at>now()-interval '150 seconds' and q.revoked_at is null and q.expires_at>now(),false),
      'keyVersion',q.key_version,'report',case when q.revoked_at is null and q.expires_at>now() then q.report else null end,
      'capabilitiesVerified',false,'generationEnabled',false)), '[]'::jsonb)
      into rows from (select * from connect_devices where owner_id=p_owner and origin=p_origin order by (revoked_at is null and expires_at>now()) desc,created_at desc limit 50) q;
    return jsonb_build_object('devices',rows);
  elsif p_action in ('rename','revoke') then
    select * into d from connect_devices where id=(p_input->>'id')::uuid and owner_id=p_owner and origin=p_origin for update;
    if not found then return jsonb_build_object('error','not-found'); end if;
    if p_action='revoke' then update connect_devices set revoked_at=coalesce(revoked_at,now()) where id=d.id;
    else update connect_devices set name=p_input->>'name' where id=d.id; end if;
    return jsonb_build_object('ok',true);
  else return jsonb_build_object('error','invalid-action'); end if;
  return jsonb_build_object('pairing',jsonb_build_object('id',p.id,'name',p.name,'origin',p.origin,'state',p.state,
    'expiresAt',p.expires_at,'installationId',p.installation_id,'fingerprint',p.fingerprint,'deviceId',p.device_id));
end $$;

create function public.connect_claim(p_origin text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public,pg_temp as $$
declare p connect_pairings;
begin
  if not connect_rate('claims',300,60) then return jsonb_build_object('error','rate-limited'); end if;
  select * into p from connect_pairings where code_hash=p_input->>'codeHash' and origin=p_origin for update;
  if not found then return jsonb_build_object('error','pairing-unavailable'); end if;
  if not connect_rate('pair:'||p.id,5,60) then return jsonb_build_object('error','rate-limited'); end if;
  if p.expires_at<=now() or p.state in ('confirmed','cancelled') then return jsonb_build_object('error','pairing-unavailable'); end if;
  if p.state='claimed' and (p.public_key is distinct from p_input->>'publicKey' or p.installation_id::text is distinct from p_input->>'installationId' or p.device_id::text is distinct from p_input->>'deviceId') then return jsonb_build_object('error','pairing-unavailable'); end if;
  if p.state='pending' then
    update connect_pairings set state='claimed',installation_id=(p_input->>'installationId')::uuid,
      public_key=p_input->>'publicKey',fingerprint=p_input->>'fingerprint',device_id=(p_input->>'deviceId')::uuid where id=p.id returning * into p;
  end if;
  return jsonb_build_object('pairingId',p.id,'deviceId',p.device_id,'fingerprint',p.fingerprint,'expiresAt',p.expires_at,'state',p.state);
end $$;

create function public.connect_device_action(p_id uuid,p_origin text,p_public_key text,p_nonce uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public,pg_temp as $$
declare d connect_devices;
begin
  select * into d from connect_devices where id=p_id and origin=p_origin for update;
  if not found or d.revoked_at is not null or d.expires_at<=now() or d.public_key<>p_public_key then return jsonb_build_object('error','unauthorized'); end if;
  if not connect_rate('device:'||p_id,30,60) then return jsonb_build_object('error','rate-limited'); end if;
  delete from connect_nonces where device_id=p_id and expires_at<=now();
  if exists(select 1 from connect_nonces where device_id=p_id and nonce=p_nonce) then return jsonb_build_object('error','replayed-request'); end if;
  if (select count(*) from connect_nonces where device_id=p_id)>=128 then return jsonb_build_object('error','rate-limited'); end if;
  insert into connect_nonces(device_id,nonce) values(p_id,p_nonce);
  if p_action='status' then
    update connect_devices set last_seen_at=now(),epoch=(p_input->>'epoch')::uuid,report=p_input->'report' where id=p_id returning * into d;
  elsif p_action='rotate' then
    if p_public_key=p_input->>'publicKey' then return jsonb_build_object('error','unchanged-key'); end if;
    update connect_devices set public_key=p_input->>'publicKey',key_version=key_version+1,expires_at=now()+interval '30 days' where id=p_id returning * into d;
  elsif p_action='unpair' then
    update connect_devices set revoked_at=now() where id=p_id returning * into d;
  else return jsonb_build_object('error','invalid-action'); end if;
  return jsonb_build_object('deviceId',d.id,'name',d.name,'origin',d.origin,'keyVersion',d.key_version,
    'expiresAt',d.expires_at,'revoked',d.revoked_at is not null,'generationEnabled',false,'pollAfterSeconds',60);
end $$;

revoke all on function public.connect_rate(text,integer,integer),public.connect_owner(uuid,text,text,jsonb),public.connect_claim(text,jsonb),public.connect_device_action(uuid,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.connect_owner(uuid,text,text,jsonb),public.connect_claim(text,jsonb),public.connect_device_action(uuid,text,text,uuid,text,jsonb) to service_role;
commit;
