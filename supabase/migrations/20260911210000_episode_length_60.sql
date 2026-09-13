alter table public.productions
  drop constraint if exists productions_length_chk;

alter table public.productions
  add constraint productions_length_chk
  check (episode_length in ('30_45', '45_60', '60_90', '120_180', '900_1080'));
