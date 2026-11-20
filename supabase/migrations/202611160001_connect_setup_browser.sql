-- MH-6B.4C: owner-scoped preparation and original-key recovery only. Setup remains gated off.
begin;
create or replace function public.connect_setup_owner(p_owner uuid,p_origin text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d connect_devices; c connect_setup_devices; r connect_setup_requests; frozen jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,97224));
 if not exists(select 1 from auth.users where id=p_owner) then return jsonb_build_object('error','unauthorized'); end if;
 if p_action='create' then
  select * into d from connect_devices where id=(p_input->>'deviceId')::uuid and owner_id=p_owner and origin=p_origin for update;
  if not found or d.revoked_at is not null or d.expires_at<=now() then return jsonb_build_object('error','not-found'); end if;
  frozen=p_input-'id';
  select * into r from connect_setup_requests where owner_id=p_owner and origin=p_origin and submission_key=(p_input->>'key')::uuid for update;
  if found then
   if r.payload<>frozen then return jsonb_build_object('error','idempotency-conflict'); end if;
   return jsonb_build_object('request',connect_setup_view(r));
  end if;
  if not connect_rate('setup-owner:'||p_owner,10,60) then return jsonb_build_object('error','rate-limited'); end if;
  if p_input->>'kind' not in ('assess','install') or p_input->>'intentHash' !~ '^[a-f0-9]{64}$'
   or p_input#>>'{intent,ownerId}' is distinct from p_owner::text or p_input#>>'{intent,origin}' is distinct from p_origin
   or p_input#>>'{intent,deviceId}' is distinct from d.id::text or p_input#>>'{intent,installationId}' is distinct from d.installation_id::text
   or p_input#>>'{intent,keyVersion}' is distinct from d.key_version::text or p_input#>>'{intent,setupProtocol}' is distinct from '1'
   or p_input#>>'{intent,profile}' not in ('qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation')
   or (p_input->>'kind'='install' and p_input->>'acceptedTerms' is distinct from 'true') then return jsonb_build_object('error','intent-invalid'); end if;
  select * into c from connect_setup_devices where device_id=d.id;
  if not found or c.seen_at<=now()-interval '150 seconds' or c.key_version<>d.key_version or c.installation_id<>d.installation_id
   or not c.profiles ? (p_input#>>'{intent,profile}') then return jsonb_build_object('error','setup-capability-unavailable'); end if;
  update connect_setup_requests set state='expired',version=version+1 where device_id=d.id and state='requested' and attempt=0 and expires_at<=now();
  if (select count(*) from connect_setup_requests where owner_id=p_owner)>=1000 then return jsonb_build_object('error','receipt-capacity'); end if;
  if exists(select 1 from connect_setup_requests where device_id=d.id and state not in ('ready','assessed','cancelled','failed','rejected','expired'))
   or (select count(*) from connect_setup_requests where owner_id=p_owner and state not in ('ready','assessed','cancelled','failed','rejected','expired'))>=2 then return jsonb_build_object('error','queue-full'); end if;
  insert into connect_setup_requests(id,owner_id,device_id,origin,submission_key,kind,payload)
   values((p_input->>'id')::uuid,p_owner,d.id,p_origin,(p_input->>'key')::uuid,p_input->>'kind',frozen) returning * into r;
 elsif p_action='recover' then
  select * into r from connect_setup_requests where owner_id=p_owner and origin=p_origin and submission_key=(p_input->>'key')::uuid;
  if not found then return jsonb_build_object('error','not-found'); end if;
 elsif p_action='prepare' then
  select * into d from connect_devices where id=(p_input->>'deviceId')::uuid and owner_id=p_owner and origin=p_origin;
  if not found or d.revoked_at is not null or d.expires_at<=now() then return jsonb_build_object('error','not-found'); end if;
  select * into c from connect_setup_devices where device_id=d.id and installation_id=d.installation_id and key_version=d.key_version and seen_at>now()-interval '150 seconds' and profiles ? (p_input#>>'{intent,profile}');
  select * into r from connect_setup_requests where owner_id=p_owner and origin=p_origin and device_id=d.id and kind='assess' and state='assessed' and payload->'intent'=p_input->'intent' order by created_at desc,id desc limit 1;
  return jsonb_build_object('capable',c.device_id is not null,'seenAt',c.seen_at,'deviceName',d.name,'assessment',case when r.id is null then null else connect_setup_view(r) end,
   'active',(select connect_setup_view(x) from connect_setup_requests x where x.owner_id=p_owner and x.origin=p_origin and x.device_id=d.id and x.state not in ('ready','assessed','cancelled','failed','rejected','expired') order by x.created_at,x.id limit 1));
 elsif p_action in ('inspect','cancel') then
  select * into r from connect_setup_requests where id=(p_input->>'id')::uuid and owner_id=p_owner and origin=p_origin;
  if not found then return jsonb_build_object('error','not-found'); end if;
  -- Lock order matches device checkpoints: device, then setup receipt.
  perform 1 from connect_devices where id=r.device_id for update;
  select * into r from connect_setup_requests where id=r.id for update;
  if p_action='cancel' and r.state not in ('ready','assessed','cancelled','failed','rejected','expired') and not r.cancel_requested then
   update connect_setup_requests set cancel_requested=true,state=case when attempt=0 then 'cancelled' else 'cancelling' end,version=version+1 where id=r.id returning * into r;
  end if;
 else return jsonb_build_object('error','invalid-action'); end if;
 return jsonb_build_object('request',connect_setup_view(r));
end $$;


revoke all on function public.connect_setup_owner(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.connect_setup_owner(uuid,text,text,jsonb) to service_role;
commit;
