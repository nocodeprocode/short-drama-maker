-- A production task is billable work. It may only be claimed after funds were
-- allocated by the explicit final Start action. Draft/catalog tasks have no
-- production_id and remain available before purchase.

update public.engine_tasks task
set status = 'cancelled',
    lease_until = null,
    error_code = 'production_not_started',
    error_detail = 'Production work was cancelled because payment and final start were not confirmed.',
    updated_at = now()
from public.productions production
where task.production_id = production.id
  and task.status in ('queued', 'running')
  and (
    coalesce(production.paid_amount, 0) <= 0
    or production.status not in ('queued', 'running')
    or production.paused
  );

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
      lease_until = now() + interval '5 minutes',
      updated_at = now()
  from due
  where task.id = due.id
  returning task.*;
end;
$$;

revoke all on function private.claim_engine_tasks(integer, text[]) from public, anon, authenticated;
