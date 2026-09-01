create table public.actors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source text not null default 'generated' check (source in ('generated', 'likeness')),
  seed_asset_id uuid,
  appearance_profile jsonb not null default '{}'::jsonb,
  visual_reference_asset_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.characters
  add column actor_id uuid references public.actors (id) on delete set null;

create index characters_actor_id_idx on public.characters (actor_id);

alter table public.assets
  alter column series_id drop not null;

alter table public.assets
  drop constraint assets_series_id_fkey;

alter table public.assets
  add constraint assets_series_id_fkey
  foreign key (series_id) references public.series (id) on delete set null;

alter table public.assets
  add column actor_id uuid references public.actors (id) on delete set null;

create index assets_actor_id_idx on public.assets (actor_id);

alter table public.actors
  add constraint actors_seed_asset_id_fkey
  foreign key (seed_asset_id) references public.assets (id) on delete set null;

alter table public.actors enable row level security;
alter table public.actors force row level security;

create policy actors_owner on public.actors
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

do $$
declare
  rec record;
  new_id uuid;
begin
  for rec in
    select
      c.id as character_id,
      s.owner_id,
      c.name,
      coalesce(c.visual_profile -> 'appearance_profile', '{}'::jsonb) as appearance_profile,
      coalesce(c.visual_profile -> 'visual_reference_asset_ids', '{}'::jsonb) as refs
    from public.characters c
    join public.series s on s.id = c.series_id
    where c.actor_id is null
      and jsonb_typeof(c.visual_profile -> 'visual_reference_asset_ids') = 'object'
      and c.visual_profile -> 'visual_reference_asset_ids' <> '{}'::jsonb
  loop
    insert into public.actors (owner_id, name, source, appearance_profile, visual_reference_asset_ids)
    values (rec.owner_id, rec.name, 'generated', rec.appearance_profile, rec.refs)
    returning id into new_id;
    update public.characters set actor_id = new_id where id = rec.character_id;
  end loop;
end $$;

update public.assets a
set actor_id = c.actor_id
from public.characters c
where c.actor_id is not null
  and a.deleted_at is null
  and a.kind = 'character_reference'
  and (
    a.metadata ->> 'character_id' = c.id::text
    or a.id::text in (
      select value
      from jsonb_each_text(coalesce(c.visual_profile -> 'visual_reference_asset_ids', '{}'::jsonb))
    )
  );
