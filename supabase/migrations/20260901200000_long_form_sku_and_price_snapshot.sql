-- 15-minute episodes (900_1080) were priced and accepted by the API but the
-- productions check constraint still rejected them. Also record the 720p price
-- snapshot the engine has been stamping on ledger rows since 31 Aug.

alter table public.productions
  drop constraint if exists productions_length_chk;

alter table public.productions
  add constraint productions_length_chk
  check (episode_length in ('30_45', '60_90', '120_180', '900_1080'));

insert into public.price_snapshots (version, prices)
values (
  '2026-08-31.v1-720p',
  '{
    "bytedance/seedance-2.0": 0.08,
    "bytedance/seedance-2.0-mini": 0.076,
    "alibaba/wan-3.0": 0.1,
    "bytedance/seedance-2.5": 0.23,
    "google/veo-3.1-lite": 0.05,
    "kwaivgi/kling-v3.0-std": 0.084,
    "x-ai/grok-imagine-video": 0.07,
    "dialogue_tts": 0.004,
    "image": 0.04,
    "llm": 0.01,
    "voice_design": 0.12
  }'::jsonb
)
on conflict (version) do nothing;
