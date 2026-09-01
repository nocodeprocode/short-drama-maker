-- Drama Space productions (runs), pilot gate, and block SKUs.

alter table public.series
  add column if not exists pilot_approved_at timestamptz,
  add column if not exists poster_tone text not null default 'g1';

create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  mode text not null default 'autopilot',
  sku text not null,
  priority text not null default 'balanced',
  episode_length text not null default '60_90',
  notify text not null default 'in_app_email',
  episode_start integer not null,
  episode_end integer not null,
  status text not null default 'awaiting_payment',
  ui_phase text not null default 'preparing',
  intervention_type text,
  intervention jsonb not null default '{}'::jsonb,
  agent_decision text,
  stripe_checkout_id text,
  paid_amount numeric(12, 4) not null default 0,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint productions_mode_chk check (mode in ('autopilot', 'studio')),
  constraint productions_sku_chk check (sku in ('2', '12', '24', '45', '60', 'topup')),
  constraint productions_priority_chk check (priority in ('fast', 'balanced', 'quality')),
  constraint productions_length_chk check (episode_length in ('30_45', '60_90', '120_180')),
  constraint productions_status_chk check (status in (
    'awaiting_payment', 'queued', 'running', 'needs_user', 'ready', 'failed', 'cancelled'
  )),
  constraint productions_phase_chk check (ui_phase in (
    'preparing', 'producing', 'finishing', 'ready', 'needs_you'
  )),
  constraint productions_intervention_chk check (
    intervention_type is null
    or intervention_type in ('quality_budget', 'content_policy', 'provider_unavailable', 'payment_required')
  )
);

create index if not exists productions_owner_id_idx on public.productions (owner_id, created_at desc);
create index if not exists productions_series_id_idx on public.productions (series_id, created_at desc);
create index if not exists productions_status_idx on public.productions (status, updated_at desc);

alter table public.engine_tasks
  add column if not exists production_id uuid references public.productions (id) on delete set null;

create index if not exists engine_tasks_production_id_idx on public.engine_tasks (production_id);

alter table public.episodes
  add column if not exists production_id uuid references public.productions (id) on delete set null,
  add column if not exists poster_tone text not null default 'g1',
  add column if not exists duration_seconds numeric(8, 2);

create index if not exists episodes_production_id_idx on public.episodes (production_id);

alter table public.productions enable row level security;
alter table public.productions force row level security;

create policy productions_own on public.productions
  for select to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.productions to authenticated;
revoke all on public.productions from anon;

do $$
begin
  begin
    alter publication supabase_realtime add table public.productions;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.engine_tasks;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.episodes;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.shots;
  exception
    when duplicate_object then null;
  end;
end $$;
