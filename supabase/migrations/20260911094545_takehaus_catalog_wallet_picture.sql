-- Takehaus catalog: 30/50/90 episode runs, wallet ledger rows (nullable
-- series_id), and Pro vs Catalog picture on each production.

alter table public.productions
  drop constraint if exists productions_sku_chk;

alter table public.productions
  add constraint productions_sku_chk
    check (sku in ('2', '12', '24', '30', '45', '50', '60', '90', 'topup', 'credit'));

alter table public.productions
  add column if not exists video_tier text not null default 'pro';

alter table public.productions
  drop constraint if exists productions_video_tier_chk;

alter table public.productions
  add constraint productions_video_tier_chk
    check (video_tier in ('pro', 'catalog'));

alter table public.project_ledger
  alter column series_id drop not null;

create index if not exists project_ledger_wallet_idx
  on public.project_ledger (owner_id)
  where series_id is null;
