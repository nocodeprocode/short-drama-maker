-- Casting: a reusable actor catalog and a per-show cast plan.
--
-- Tags let one face be found again across shows (a franchise, a sequel, a
-- recurring villain). Cast slots hold "who plays this role" for a show that has
-- not been shot yet: `analyze` names the roles later, and each slot binds to the
-- character it matches, so the buyer's choice survives the run starting.

alter table public.actors
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.actors
  add column if not exists notes text not null default '';

create index if not exists actors_tags_idx on public.actors using gin (tags);
create index if not exists actors_owner_idx on public.actors (owner_id);

create table if not exists public.series_cast (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  -- Null means "you write this one": the run generates a fresh face.
  actor_id uuid references public.actors (id) on delete set null,
  -- Set once a character with this role name exists.
  character_id uuid references public.characters (id) on delete set null,
  role_name text not null,
  role_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Named so an upsert can target it; callers match case-insensitively first so
  -- "Yacine" and "yacine" do not become two parts.
  constraint series_cast_role_key unique (series_id, role_name)
);

create index if not exists series_cast_series_idx on public.series_cast (series_id);
create index if not exists series_cast_actor_idx on public.series_cast (actor_id);
create index if not exists series_cast_character_idx on public.series_cast (character_id);

alter table public.series_cast enable row level security;
alter table public.series_cast force row level security;

create policy series_cast_owner on public.series_cast
  for all to authenticated
  using ((select private.owns_series(series_id)))
  with check ((select private.owns_series(series_id)));

-- Backfill: every role already cast becomes a slot, so an in-flight show shows
-- its real cast on the new screen instead of an empty plan.
insert into public.series_cast (series_id, actor_id, character_id, role_name)
select c.series_id, c.actor_id, c.id, c.name
from public.characters c
where c.actor_id is not null
on conflict (series_id, role_name) do nothing;
