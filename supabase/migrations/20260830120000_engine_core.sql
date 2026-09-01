create extension if not exists pgcrypto;
create extension if not exists pgmq;

create schema if not exists private;

create table public.series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  style_profile jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  name text not null,
  description text not null default '',
  visual_profile jsonb not null default '{}'::jsonb,
  voice_profile jsonb not null default '{}'::jsonb,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  episode_number integer not null,
  title text not null,
  script text not null default '',
  status text not null default 'draft',
  render_manifest jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, episode_number)
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  position integer not null,
  location text not null,
  scene_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  unique (episode_id, position)
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  position integer not null,
  shot_data jsonb not null default '{}'::jsonb,
  selected_generation_id uuid,
  status text not null default 'planned',
  unique (scene_id, position)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  kind text not null,
  storage_path text not null,
  mime_type text not null,
  bytes bigint not null,
  checksum text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  episode_id uuid references public.episodes (id) on delete set null,
  scene_id uuid references public.scenes (id) on delete set null,
  shot_id uuid references public.shots (id) on delete set null,
  job_type text not null,
  model text,
  provider text,
  upstream_job_id text,
  callback_token text not null unique,
  callback_token_used boolean not null default false,
  idempotency_key text not null unique,
  status text not null,
  request_metadata jsonb not null default '{}'::jsonb,
  result_metadata jsonb not null default '{}'::jsonb,
  estimated_cost numeric(12, 4) not null default 0,
  actual_cost numeric(12, 4),
  attempt integer not null default 1,
  error_code text,
  expected_ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index generation_jobs_provider_upstream_uidx
  on public.generation_jobs (provider, upstream_job_id)
  where provider is not null and upstream_job_id is not null;

create table public.project_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  entry_type text not null,
  amount numeric(12, 4) not null,
  generation_job_id uuid references public.generation_jobs (id) on delete set null,
  stripe_event_id text,
  price_snapshot_version text not null,
  created_at timestamptz not null default now()
);

create unique index project_ledger_job_reserve_uidx
  on public.project_ledger (generation_job_id, entry_type)
  where generation_job_id is not null and entry_type in ('reserve', 'settle');

create unique index project_ledger_stripe_event_uidx
  on public.project_ledger (stripe_event_id)
  where stripe_event_id is not null;

create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.generation_jobs (id) on delete set null,
  series_id uuid references public.series (id) on delete set null,
  checkpoint text not null,
  verdict text not null,
  category text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.price_snapshots (
  version text primary key,
  prices jsonb not null,
  created_at timestamptz not null default now()
);

create table public.spend_controls (
  id text primary key default 'global',
  daily_cap numeric(12, 4) not null default 250,
  daily_spent numeric(12, 4) not null default 0,
  spent_on date not null default current_date,
  updated_at timestamptz not null default now()
);

insert into public.spend_controls (id) values ('global');

create or replace function private.owns_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.series
    where id = p_series_id
      and owner_id = (select auth.uid())
      and deleted_at is null
  );
$$;

create index series_owner_id_idx on public.series (owner_id) where deleted_at is null;
create index characters_series_id_idx on public.characters (series_id);
create index episodes_series_id_idx on public.episodes (series_id);
create index scenes_episode_id_idx on public.scenes (episode_id);
create index shots_scene_id_idx on public.shots (scene_id);
create index assets_owner_id_idx on public.assets (owner_id);
create index assets_series_id_idx on public.assets (series_id);
create index generation_jobs_owner_id_idx on public.generation_jobs (owner_id);
create index generation_jobs_series_id_idx on public.generation_jobs (series_id);
create index generation_jobs_episode_id_idx on public.generation_jobs (episode_id);
create index generation_jobs_scene_id_idx on public.generation_jobs (scene_id);
create index generation_jobs_shot_id_idx on public.generation_jobs (shot_id);
create index generation_jobs_status_created_idx on public.generation_jobs (status, created_at);
create index generation_jobs_callback_token_idx on public.generation_jobs (callback_token);
create index project_ledger_series_id_idx on public.project_ledger (series_id);
create index project_ledger_owner_id_idx on public.project_ledger (owner_id);
create index project_ledger_job_id_idx on public.project_ledger (generation_job_id);
create index moderation_decisions_series_id_idx on public.moderation_decisions (series_id);
create index moderation_decisions_job_id_idx on public.moderation_decisions (job_id);

alter table public.series enable row level security;
alter table public.characters enable row level security;
alter table public.episodes enable row level security;
alter table public.scenes enable row level security;
alter table public.shots enable row level security;
alter table public.assets enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.project_ledger enable row level security;
alter table public.moderation_decisions enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.spend_controls enable row level security;

alter table public.series force row level security;
alter table public.characters force row level security;
alter table public.episodes force row level security;
alter table public.scenes force row level security;
alter table public.shots force row level security;
alter table public.assets force row level security;
alter table public.generation_jobs force row level security;
alter table public.project_ledger force row level security;
alter table public.moderation_decisions force row level security;
alter table public.price_snapshots force row level security;
alter table public.spend_controls force row level security;

create policy series_owner on public.series
  for all to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null)
  with check (owner_id = (select auth.uid()));

create policy characters_owner on public.characters
  for all to authenticated
  using ((select private.owns_series(series_id)))
  with check ((select private.owns_series(series_id)));

create policy episodes_owner on public.episodes
  for all to authenticated
  using ((select private.owns_series(series_id)))
  with check ((select private.owns_series(series_id)));

create policy scenes_owner on public.scenes
  for all to authenticated
  using (
    exists (
      select 1
      from public.episodes e
      where e.id = episode_id
        and (select private.owns_series(e.series_id))
    )
  )
  with check (
    exists (
      select 1
      from public.episodes e
      where e.id = episode_id
        and (select private.owns_series(e.series_id))
    )
  );

create policy shots_owner on public.shots
  for all to authenticated
  using (
    exists (
      select 1
      from public.scenes sc
      join public.episodes e on e.id = sc.episode_id
      where sc.id = scene_id
        and (select private.owns_series(e.series_id))
    )
  )
  with check (
    exists (
      select 1
      from public.scenes sc
      join public.episodes e on e.id = sc.episode_id
      where sc.id = scene_id
        and (select private.owns_series(e.series_id))
    )
  );

create policy assets_owner on public.assets
  for all to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null)
  with check (owner_id = (select auth.uid()));

create policy generation_jobs_owner on public.generation_jobs
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy project_ledger_owner on public.project_ledger
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy moderation_decisions_owner on public.moderation_decisions
  for select to authenticated
  using (
    series_id is not null and (select private.owns_series(series_id))
  );

revoke all on public.spend_controls from anon, authenticated;
revoke all on public.price_snapshots from anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.owns_series(uuid) to authenticated;

select pgmq.create('generation_tasks');
