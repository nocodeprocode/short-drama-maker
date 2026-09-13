-- Structured cast slate on the brief, plus likeness-studio fields on actors.
--
-- A slate slot is a placeholder (Lead / Antagonist / Confidant / Disruptor)
-- created with the brief. role_name stays null until the buyer names it or
-- the story does. identity_fidelity lets a likeness stay faithful to the
-- uploaded face instead of being beauty-gated into someone else.

alter table public.actors
  add column if not exists identity_fidelity text not null default 'faithful';

alter table public.actors
  add column if not exists judge_notes text;

alter table public.actors
  drop constraint if exists actors_identity_fidelity_check;

alter table public.actors
  add constraint actors_identity_fidelity_check
  check (identity_fidelity in ('faithful', 'idealized'));

alter table public.series_cast
  add column if not exists job text;

alter table public.series_cast
  add column if not exists archetype text;

alter table public.series_cast
  add column if not exists importance text not null default 'supporting';

alter table public.series_cast
  add column if not exists castable boolean not null default true;

alter table public.series_cast
  add column if not exists suggested_name text;

alter table public.series_cast
  add column if not exists position int not null default 0;

alter table public.series_cast
  add column if not exists origin text not null default 'buyer';

alter table public.series_cast
  drop constraint if exists series_cast_importance_check;

alter table public.series_cast
  add constraint series_cast_importance_check
  check (importance in ('lead', 'supporting', 'background'));

alter table public.series_cast
  drop constraint if exists series_cast_origin_check;

alter table public.series_cast
  add constraint series_cast_origin_check
  check (origin in ('slate', 'buyer'));

alter table public.series_cast
  drop constraint if exists series_cast_job_check;

alter table public.series_cast
  add constraint series_cast_job_check
  check (job is null or job in ('engine', 'wall', 'witness', 'nuke'));

-- Placeholders share a show before they have a name.
alter table public.series_cast
  alter column role_name drop not null;

alter table public.series_cast
  drop constraint if exists series_cast_role_key;

drop index if exists series_cast_role_key;

create unique index if not exists series_cast_role_key
  on public.series_cast (series_id, role_name)
  where role_name is not null;

create index if not exists series_cast_job_idx on public.series_cast (series_id, job);

alter table public.actors replica identity full;
alter table public.series_cast replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.actors;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.series_cast;
  exception
    when duplicate_object then null;
  end;
end $$;

-- Existing slots were typed by the buyer; stamp a job from the linked
-- character or from order so the new sheet has structure. Missing slates
-- on old shows are filled on first open of the cast tab.
with ranked as (
  select
    sc.id,
    coalesce(
      sc.job,
      nullif(c.visual_profile #>> '{personality_profile,job}', ''),
      case
        when row_number() over (partition by sc.series_id order by sc.created_at) = 1 then 'engine'
        when row_number() over (partition by sc.series_id order by sc.created_at) = 2 then 'wall'
        when row_number() over (partition by sc.series_id order by sc.created_at) = 3 then 'witness'
        else 'nuke'
      end
    ) as next_job
  from public.series_cast sc
  left join public.characters c on c.id = sc.character_id
)
update public.series_cast sc
set
  job = ranked.next_job,
  importance = case when ranked.next_job in ('engine', 'wall') then 'lead' else 'supporting' end,
  origin = 'buyer'
from ranked
where sc.id = ranked.id
  and (sc.job is null or sc.job = '');
