alter table public.series
  add column if not exists cover_asset_id uuid references public.assets (id) on delete set null;

alter table public.productions
  drop constraint if exists productions_intervention_chk;

alter table public.productions
  add constraint productions_intervention_chk check (
    intervention_type is null
    or intervention_type in (
      'quality_budget',
      'content_policy',
      'provider_unavailable',
      'payment_required',
      'technical'
    )
  );

alter table public.productions replica identity full;
alter table public.engine_tasks replica identity full;
alter table public.assets replica identity full;
alter table public.characters replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.productions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.engine_tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.assets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.characters;
  exception when duplicate_object then null;
  end;
end $$;
