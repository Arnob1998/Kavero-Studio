begin;
-- One bounded owner snapshot. Raw binding never leaves the server projection.
create function public.connect_computers_owner(p_owner uuid,p_origin text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select case when not exists(select 1 from auth.users where id=p_owner) then jsonb_build_object('error','unauthorized') else
 jsonb_build_object('computers',coalesce((select jsonb_agg(to_jsonb(x)) from (
  select d.id,d.name,d.created_at,d.expires_at,d.revoked_at,d.last_seen_at,d.report,
   r.binding,r.binding_hash,r.binding_at,r.seen_at,
   (select count(*) from connect_jobs j where j.device_id=d.id and j.owner_id=p_owner and j.origin=p_origin
    and j.state in ('waiting','delivered','accepted','running','submission-unknown')) as outstanding
  from connect_devices d left join connect_delivery_devices r on r.device_id=d.id
  where d.owner_id=p_owner and d.origin=p_origin
  order by (d.revoked_at is null and d.expires_at>now()) desc,d.created_at desc,d.id limit 50
 ) x),'[]'::jsonb),
 'ownerOutstanding',(select count(*) from connect_jobs where owner_id=p_owner and origin=p_origin and state in ('waiting','delivered','accepted','running','submission-unknown')))
 end
$$;
revoke all on function public.connect_computers_owner(uuid,text) from public,anon,authenticated;
grant execute on function public.connect_computers_owner(uuid,text) to service_role;
commit;
