create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  context text not null default 'signup',
  session_id text,
  ip_reference text,
  user_agent_summary text
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  type text not null,
  status text not null default 'received',
  requested_at timestamptz not null default now(),
  identity_verified_at timestamptz,
  completed_at timestamptz,
  notes_internal text not null default ''
);

create table public.ai_provider_routes (
  model_id text primary key,
  upstream_provider text not null,
  purpose text not null,
  data_types jsonb not null default '[]'::jsonb,
  retention_class text not null,
  training_allowed boolean not null default false,
  headquarters text not null,
  processing_region text not null,
  processing_region_verified boolean not null default false,
  evidence_url text,
  approved_standard boolean not null default false,
  approved_strict boolean not null default false,
  reviewed_at date not null,
  notes text not null default ''
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  series_id uuid references public.series (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index legal_acceptances_user_id_idx on public.legal_acceptances (user_id);
create index privacy_requests_user_id_idx on public.privacy_requests (user_id);
create index privacy_requests_status_idx on public.privacy_requests (status);
create index audit_events_actor_id_idx on public.audit_events (actor_id);
create index audit_events_series_id_idx on public.audit_events (series_id);

alter table public.legal_acceptances enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.ai_provider_routes enable row level security;
alter table public.audit_events enable row level security;

alter table public.legal_acceptances force row level security;
alter table public.privacy_requests force row level security;
alter table public.ai_provider_routes force row level security;
alter table public.audit_events force row level security;

create policy legal_acceptances_own on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy privacy_requests_own on public.privacy_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy ai_provider_routes_read on public.ai_provider_routes
  for select to authenticated
  using (true);

revoke all on public.audit_events from anon, authenticated;
