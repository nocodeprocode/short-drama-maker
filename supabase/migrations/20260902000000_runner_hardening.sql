-- Runner hardening.
--
-- 1. The atomic claim (FOR UPDATE SKIP LOCKED) lived in the private schema
--    where PostgREST cannot call it, so the runner used a racy select-then-
--    update instead. Expose it through a public wrapper for the service role.
-- 2. Long renders outlive a fixed lease; a heartbeat extends it while the
--    task is really running so a second runner does not double-dispatch.
-- 3. The platform daily-spend counter was written last-writer-wins from each
--    runner's in-memory copy. Make it an atomic delta.
-- 4. Every task and provider-job transition gets a row in job_events so an
--    operator can see what happened without reading logs.
-- 5. Tasks that exhaust retries are dead-lettered rather than left as
--    `failed` alongside tasks that failed once and will be retried.

create or replace function public.claim_engine_tasks(p_limit integer)
returns setof public.engine_tasks
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_engine_tasks(least(greatest(coalesce(p_limit, 1), 1), 50));
$$;

revoke all on function public.claim_engine_tasks(integer) from public, anon, authenticated;
grant execute on function public.claim_engine_tasks(integer) to service_role;

create or replace function public.extend_engine_task_lease(p_task_id uuid, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched integer;
begin
  update public.engine_tasks
  set lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 30), 1800)),
      updated_at = now()
  where id = p_task_id and status = 'running';
  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

revoke all on function public.extend_engine_task_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_engine_task_lease(uuid, integer) to service_role;

-- Atomic daily spend. Resets when the stored day is behind today; returns the
-- new total so the caller can enforce the cap against real platform spend.
create or replace function public.add_daily_spend(p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_total numeric;
begin
  update public.spend_controls
  set daily_spent = case when spent_on < current_date then greatest(0, coalesce(p_delta, 0)) else daily_spent + coalesce(p_delta, 0) end,
      spent_on = current_date,
      updated_at = now()
  where id = 'global'
  returning daily_spent into new_total;
  return coalesce(new_total, 0);
end;
$$;

revoke all on function public.add_daily_spend(numeric) from public, anon, authenticated;
grant execute on function public.add_daily_spend(numeric) to service_role;

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid references public.series (id) on delete cascade,
  production_id uuid,
  task_id uuid,
  generation_job_id uuid,
  kind text not null,
  status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_events_series_created_idx on public.job_events (series_id, created_at desc);
create index if not exists job_events_task_idx on public.job_events (task_id);
create index if not exists job_events_job_idx on public.job_events (generation_job_id);

alter table public.job_events enable row level security;
alter table public.job_events force row level security;

create policy job_events_own on public.job_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.job_events from anon;
grant select on public.job_events to authenticated;

-- Stuck-lease view for alerting: running tasks whose lease expired more than
-- five minutes ago and were not reclaimed.
create or replace view public.engine_tasks_stuck as
  select id, series_id, production_id, action, attempt, lease_until, updated_at
  from public.engine_tasks
  where status = 'running' and lease_until is not null and lease_until < now() - interval '5 minutes';

revoke all on public.engine_tasks_stuck from public, anon, authenticated;
grant select on public.engine_tasks_stuck to service_role;
