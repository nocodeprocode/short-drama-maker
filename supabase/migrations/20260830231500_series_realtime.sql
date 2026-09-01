alter table public.series replica identity full;
alter table public.episodes replica identity full;
alter table public.shots replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.series;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.episodes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.shots;
  exception when duplicate_object then null;
  end;
end $$;
