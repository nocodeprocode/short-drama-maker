-- Identity, series-scale engine, season SKUs, and the platform spend kill switch.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.series
  add column if not exists story_bible jsonb,
  add column if not exists target_episode_count integer,
  add column if not exists sku text,
  add column if not exists location_refs jsonb not null default '{}'::jsonb;

alter table public.assets
  add column if not exists bucket text not null default 'private-generation';

create table public.engine_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempt integer not null default 0,
  error_code text,
  visible_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index engine_tasks_due_idx
  on public.engine_tasks (status, visible_at, created_at);

create index engine_tasks_series_id_idx on public.engine_tasks (series_id);
create index engine_tasks_owner_id_idx on public.engine_tasks (owner_id);
create index profiles_stripe_customer_id_idx on public.profiles (stripe_customer_id);

alter table public.spend_controls
  alter column daily_cap set default 2000;

update public.spend_controls
set daily_cap = 2000
where id = 'global' and daily_cap = 250;

insert into public.price_snapshots (version, prices)
values (
  '2026-08-30.v1',
  '{
    "alibaba/wan-3.0": 0.05,
    "bytedance/seedance-2.0-mini": 0.02,
    "bytedance/seedance-2.0": 0.08,
    "bytedance/seedance-2.5": 0.12,
    "google/veo-3.1-lite": 0.1,
    "dialogue_tts": 0.004,
    "image": 0.04,
    "llm": 0.01,
    "voice_design": 0.12
  }'::jsonb
)
on conflict (version) do nothing;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.engine_tasks enable row level security;
alter table public.engine_tasks force row level security;

create policy profiles_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy engine_tasks_own on public.engine_tasks
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy legal_acceptances_insert_own on public.legal_acceptances
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy privacy_requests_insert_own on public.privacy_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.engine_tasks from anon;
grant select on public.profiles to authenticated;
grant select on public.engine_tasks to authenticated;

create unique index if not exists legal_acceptances_user_doc_version_uidx
  on public.legal_acceptances (user_id, document_type, version);

create or replace function private.claim_engine_tasks(p_limit integer)
returns setof public.engine_tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select t.id
    from public.engine_tasks t
    where (t.status = 'queued' and t.visible_at <= now())
       or (t.status = 'running' and t.lease_until is not null and t.lease_until < now())
    order by t.created_at
    limit p_limit
    for update skip locked
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

revoke all on function private.claim_engine_tasks(integer) from public, anon, authenticated;
