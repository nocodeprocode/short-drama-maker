alter table public.engine_tasks
  add column if not exists error_detail text;
