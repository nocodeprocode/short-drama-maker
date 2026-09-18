-- A five-minute claim lease was five minutes of silence whenever a worker died
-- before its first heartbeat. The runner claimed an actor pack, the invocation
-- was torn down without writing an image or an error, and nothing could retry
-- until the lease aged out. The UI had nothing to show for it.
--
-- A lease is now a small multiple of the heartbeat interval: the worker renews
-- every 30s and a dead claim becomes reclaimable after 90s. Long work stays
-- safe because the heartbeat keeps extending it.

create or replace function private.claim_engine_tasks(p_limit integer, p_exclude_actions text[] default null)
returns setof public.engine_tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select t.id, row_number() over (partition by t.series_id order by t.created_at) as rn
    from public.engine_tasks t
    where ((t.status = 'queued' and t.visible_at <= now())
       or (t.status = 'running' and t.lease_until is not null and t.lease_until < now()))
      and (p_exclude_actions is null or not (t.action = any (p_exclude_actions)))
      and (
        t.production_id is null
        or exists (
          select 1
          from public.productions p
          where p.id = t.production_id
            and coalesce(p.paid_amount, 0) > 0
            and p.status in ('queued', 'running')
            and not p.paused
        )
      )
      and not exists (
        select 1 from public.engine_tasks r
        where r.series_id = t.series_id
          and r.status = 'running'
          and r.lease_until is not null
          and r.lease_until >= now()
      )
  ),
  due as (
    select t.id
    from public.engine_tasks t
    join candidates c on c.id = t.id and c.rn = 1
    order by t.created_at
    limit p_limit
    for update of t skip locked
  )
  update public.engine_tasks task
  set status = 'running',
      attempt = task.attempt + 1,
      error_code = null,
      error_detail = null,
      lease_until = now() + interval '90 seconds',
      updated_at = now()
  from due
  where task.id = due.id
  returning task.*;
end;
$$;

revoke all on function private.claim_engine_tasks(integer, text[]) from public, anon, authenticated;

-- Release any lease still parked on the old five-minute window so the shorter
-- recovery applies to work that is already stuck.
update public.engine_tasks
set lease_until = least(lease_until, now() + interval '90 seconds')
where status = 'running' and lease_until is not null;
