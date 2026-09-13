-- Places and objects as a reusable catalog, the way faces already are.
--
-- `actors` is owner-level and `series_cast` attaches one to a show. Design had
-- only the second half: a plate built for one show could not be used by the
-- next, so the same penthouse was paid for twice and looked different both
-- times. These two tables are the first half.
--
-- Attaching copies the asset id onto the show's row, exactly as casting copies
-- an actor's stills onto a character, so the shoot reads what it already reads
-- and nothing downstream needs to know the catalog exists.

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- generated: built by the engine. upload: the buyer's own photograph.
  source text not null default 'generated',
  notes text not null default '',
  tags text[] not null default '{}',
  -- The empty plate every scene in this room is lit and graded against.
  plate_asset_id uuid references public.assets (id) on delete set null,
  -- The buyer's original upload, kept so a regenerate can work from it.
  seed_asset_id uuid references public.assets (id) on delete set null,
  -- Vision note from the plate; every close-up in this room carries it.
  lighting_lock text,
  status text not null default 'planned',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_status_check
    check (status in ('planned', 'building', 'ready', 'failed')),
  constraint locations_source_check
    check (source in ('generated', 'upload'))
);

create table if not exists public.props (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source text not null default 'generated',
  notes text not null default '',
  tags text[] not null default '{}',
  -- The object alone on a surface, reused every time a shot locks onto it.
  still_asset_id uuid references public.assets (id) on delete set null,
  seed_asset_id uuid references public.assets (id) on delete set null,
  -- The engine's cached prop kinds (letter, phone, contract, watch, carrier).
  kind text,
  -- sealed / open / broken: the same object in a different state.
  state text,
  status text not null default 'planned',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint props_status_check
    check (status in ('planned', 'building', 'ready', 'failed')),
  constraint props_source_check
    check (source in ('generated', 'upload'))
);

-- One entry per name per owner: the point of the catalog is that "penthouse"
-- means one room, so a second row with the same name would defeat it.
create unique index if not exists locations_owner_name_key
  on public.locations (owner_id, lower(name));
create index if not exists locations_owner_idx on public.locations (owner_id);
create index if not exists locations_tags_idx on public.locations using gin (tags);

create unique index if not exists props_owner_name_key
  on public.props (owner_id, lower(name));
create index if not exists props_owner_idx on public.props (owner_id);
create index if not exists props_tags_idx on public.props using gin (tags);

-- Which catalog entry a show's row is using. Null still means "this show only".
alter table public.series_locations
  add column if not exists location_id uuid references public.locations (id) on delete set null;
alter table public.series_props
  add column if not exists prop_id uuid references public.props (id) on delete set null;

create index if not exists series_locations_location_idx on public.series_locations (location_id);
create index if not exists series_props_prop_idx on public.series_props (prop_id);

alter table public.locations enable row level security;
alter table public.locations force row level security;
alter table public.props enable row level security;
alter table public.props force row level security;

drop policy if exists locations_owner on public.locations;
create policy locations_owner on public.locations
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists props_owner on public.props;
create policy props_owner on public.props
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- The catalog pages watch these while plates and stills are generated.
alter table public.locations replica identity full;
alter table public.props replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.locations;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.props;
  exception
    when duplicate_object then null;
  end;
end $$;

-- Backfill: everything already built for a show becomes a catalog entry, so the
-- new pages open with the buyer's real rooms and objects rather than empty. The
-- oldest row wins a duplicate name, and the show's row is pointed at it.
insert into public.locations (owner_id, name, source, plate_asset_id, lighting_lock, status)
select distinct on (s.owner_id, lower(sl.name))
  s.owner_id,
  sl.name,
  'generated',
  sl.plate_asset_id,
  sl.lighting_lock,
  'ready'
from public.series_locations sl
join public.series s on s.id = sl.series_id
where sl.plate_asset_id is not null
order by s.owner_id, lower(sl.name), sl.created_at
on conflict do nothing;

insert into public.props (owner_id, name, source, still_asset_id, kind, state, status)
select distinct on (s.owner_id, lower(sp.name))
  s.owner_id,
  sp.name,
  'generated',
  sp.still_asset_id,
  sp.kind,
  sp.state,
  'ready'
from public.series_props sp
join public.series s on s.id = sp.series_id
where sp.still_asset_id is not null
order by s.owner_id, lower(sp.name), sp.created_at
on conflict do nothing;

update public.series_locations sl
set location_id = l.id
from public.locations l, public.series s
where sl.location_id is null
  and s.id = sl.series_id
  and s.owner_id = l.owner_id
  and lower(l.name) = lower(sl.name);

update public.series_props sp
set prop_id = p.id
from public.props p, public.series s
where sp.prop_id is null
  and s.id = sp.series_id
  and s.owner_id = p.owner_id
  and lower(p.name) = lower(sp.name);
