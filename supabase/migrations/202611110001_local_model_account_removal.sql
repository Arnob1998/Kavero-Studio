-- Account-only completion keeps the shared installation and global runtime intact.
begin;
create or replace function public.settle_local_model_account_removal(p_owner uuid,p_id uuid,p_host uuid,p_removed boolean)
returns public.local_model_removals language plpgsql security definer set search_path=public,pg_temp as $$
declare operation public.local_model_removals;
begin
 perform pg_advisory_xact_lock(735210021);
 select * into operation from public.local_model_removals where id=p_id and owner_id=p_owner;
 if not found or p_host is null or p_removed is null then raise exception 'local-removal-not-found'; end if;
 if operation.host_operation is not null and operation.host_operation<>p_host then raise exception 'local-removal-host-conflict'; end if;
 if operation.state='removed' then return operation; end if;
 if p_removed then
  if exists(select 1 from public.local_generation_runtime where switch_id is not null)
   or exists(select 1 from public.local_generation_jobs where state in ('pending','queued','dispatching','running','cancel-requested','submission-unknown')) then raise exception 'local-jobs-outstanding'; end if;
  -- Signed native account-only completion releases this owner reference.
  -- Other owners still use the same worker, receipt, device and runtime identity.
 end if;
 update public.local_model_removals set host_operation=p_host,state=case when p_removed then 'removed' else 'pending' end where id=p_id returning * into operation;
 return operation;
end $$;
revoke all on function public.settle_local_model_account_removal(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.settle_local_model_account_removal(uuid,uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
