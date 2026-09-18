create table public.story_generations (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  input jsonb not null default '{}'::jsonb,
  partial_title text not null default '',
  partial_brief text not null default '',
  title text,
  brief text,
  category text,
  error text,
  attempt integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index story_generations_owner_updated_idx
  on public.story_generations (owner_id, updated_at desc);

alter table public.story_generations enable row level security;
revoke all on public.story_generations from anon, authenticated;
grant all on public.story_generations to service_role;
