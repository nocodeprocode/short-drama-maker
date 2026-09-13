-- Gender for each speaking part, filled by plan_cast before a face is generated.
-- A leaked NDA is not a person; only castable slots get a gender.

alter table public.series_cast
  add column if not exists suggested_gender text;

alter table public.series_cast
  drop constraint if exists series_cast_suggested_gender_check;

alter table public.series_cast
  add constraint series_cast_suggested_gender_check
  check (suggested_gender is null or suggested_gender in ('woman', 'man'));
