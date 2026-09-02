-- The engine writes the long-form outline and a render version onto episodes;
-- the table only had render_manifest.

alter table public.episodes
  add column if not exists episode_outline jsonb,
  add column if not exists render_version integer not null default 0;
