-- One running task per series across every runner, and role-scoped claims.
--
-- Every task loads and commits the whole series snapshot, so two runners
-- working the same series at once clobber each other's writes. The claim now
-- hands out at most one task per series and skips series that already have a
-- live lease anywhere. Runners can also exclude actions they cannot perform
-- (the Cloudflare cron has no ffmpeg, so it never takes render_episode).

create or replace function private.claim_engine_tasks(p_limit integer, p_exclude_actions text[] default null)
returns setof public.engine_tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select distinct on (t.series_id) t.id
    from public.engine_tasks t
    where ((t.status = 'queued' and t.visible_at <= now())
       or (t.status = 'running' and t.lease_until is not null and t.lease_until < now()))
      and (p_exclude_actions is null or not (t.action = any (p_exclude_actions)))
      and not exists (
        select 1 from public.engine_tasks r
        where r.series_id = t.series_id
          and r.status = 'running'
          and r.lease_until is not null
          and r.lease_until >= now()
      )
    order by t.series_id, t.created_at
    limit p_limit
    for update of t skip locked
  )
  update public.engine_tasks task
  set
    status = 'running',
    attempt = task.attempt + 1,
    lease_until = now() + interval '5 minutes',
    updated_at = now()
  from due
  where task.id = due.id
  returning task.*;
end;
$$;

revoke all on function private.claim_engine_tasks(integer, text[]) from public, anon, authenticated;

drop function if exists private.claim_engine_tasks(integer);
drop function if exists public.claim_engine_tasks(integer);

create or replace function public.claim_engine_tasks(p_limit integer, p_exclude_actions text[] default null)
returns setof public.engine_tasks
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_engine_tasks(least(greatest(coalesce(p_limit, 1), 1), 50), p_exclude_actions);
$$;

revoke all on function public.claim_engine_tasks(integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_engine_tasks(integer, text[]) to service_role;
