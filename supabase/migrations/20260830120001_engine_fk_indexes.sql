create index if not exists generation_jobs_series_id_idx on public.generation_jobs (series_id);
create index if not exists generation_jobs_episode_id_idx on public.generation_jobs (episode_id);
create index if not exists generation_jobs_scene_id_idx on public.generation_jobs (scene_id);
create index if not exists generation_jobs_shot_id_idx on public.generation_jobs (shot_id);
create index if not exists project_ledger_owner_id_idx on public.project_ledger (owner_id);
create index if not exists project_ledger_job_id_idx on public.project_ledger (generation_job_id);
create index if not exists moderation_decisions_job_id_idx on public.moderation_decisions (job_id);
