# Short Drama Maker

Vike + React app with a production engine: story in, consistent cast, dialogue-driven vertical shots, finished episode out.

Work happens on `staging`. `main` is production.

## Where this is hosted

The engine you run locally (`createEngine` in `src/engine`) is the same engine the hosts run. There is no Hyperdrive and the engine is not a Supabase Edge Function.

| Piece | Host | What it is |
| --- | --- | --- |
| Studio UI | Cloudflare Workers `drama-space-staging` and `drama-space` | Vike + React. Same build. Staging deploys from the `staging` branch, production from `main`. |
| Authenticated API + Stripe / OpenRouter webhooks | Supabase Edge Functions on project `zdhbmvdprdyqzrmuxwiy` | Thin HTTP. Enqueues `engine_tasks`, then wakes the jobs Worker. |
| Series / episode / task state | Supabase Postgres (`us-east-1`) | RLS, `claim_engine_tasks`, generation jobs. |
| Engine orchestrator | Cloudflare Worker `drama-space-jobs` | Same `createEngine`. Cron every minute + `JOBS_WAKE_URL`. Plans, dialogue, cast, wardrobe. No ffmpeg. |
| Engine media runner | Cloudflare Container `short-drama-media-worker` | Same `createEngine` with `RUNNER_ROLE=media`. Shoots, ingests, QC, cut. Needs Docker locally to build the image, and a **Workers Paid** plan to host it. Until the image is on Cloudflare, `RUNNER_ROLE=media npm run jobs` is the same process against the same database and R2. |
| Media bytes | Cloudflare Worker `short-drama-media-store` + R2 `short-drama-maker-media` | Stills, takes, masters. |

```
UI (Cloudflare) → API (Supabase) → engine_tasks (Postgres)
                                      ↓ JOBS_WAKE_URL
                         drama-space-jobs (Cloudflare, orchestrator)
                                      ↓ MEDIA_WORKER_URL /jobs
                         media container (Cloudflare, ffmpeg)
                                      ↓
                         media-store (R2) + OpenRouter / ElevenLabs
```

Deploy:

```sh
npm run deploy:jobs
npm run deploy:media-store
npm run deploy:media          # Colima/Docker + Workers Paid; then scripts/sync-media-worker-secrets.ts
npm run deploy:staging
npm run deploy:prod
npx supabase functions deploy api --project-ref zdhbmvdprdyqzrmuxwiy
```

- Staging UI: https://drama-space-staging.despianative.workers.dev
- Production UI: https://drama-space.despianative.workers.dev


## Phase 0

The engine in `src/engine` is the product. It calls OpenRouter and ElevenLabs only. Missing keys fail closed. There is no mock provider path in the application, including staging.

```sh
npm install
npm test
npm run dev
```

Dev server: [http://127.0.0.1:43123](http://127.0.0.1:43123)

## Layout

| Path | Role |
| --- | --- |
| `src/engine/` | Domain, AI gateway, jobs, ledger, pipeline, QC, render |
| `worker/` | Containerized media worker (ingest / QC / FFmpeg-shaped render) |
| `supabase/migrations/` | Postgres schema, RLS, pgmq |
| `supabase/functions/` | Thin authenticated API + webhook receivers |
| `pages/` | Vike UI — autopilot studio (pay, watch it shoot, review takes, download) |
| `src/legal/` | Legal copy, entity placeholders, provider registry |
| `src/components/` | Untitled UI React source (copy-owned, not a package) |
| `src/styles/` | Untitled UI Tailwind v4 theme |
| `agent_configs/` | ElevenLabs support-agent config (CLI push) |

## Privacy and keys

Copy `.env.example` → `.env.local`. Only `VITE_*` values may reach the browser.

| When | What |
| --- | --- |
| Already needed | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Before live generation | `OPENROUTER_API_KEY` + OpenRouter privacy dashboard (logging off, ZDR, data collection deny) |
| Before voices / support agent | `ELEVENLABS_API_KEY` + workspace “Improve the models” off. `VITE_ELEVENLABS_AGENT_ID` only after `npm run agents:add` |
| Before paid credits | Stripe **test** restricted key + `STRIPE_WEBHOOK_SECRET`. Checkout is live in test mode (`POST /productions` and `POST /billing/checkout`). Live keys stay 503 until `LEGAL_ENTITY` is filled and `LEGAL_ENTITY_COMPLETE=1` is set on the API. |
| Optional | `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` on signup / password reset. Merchant of Record is a legal placeholder. |

OpenRouter, ElevenLabs API keys, Stripe secrets, and the Supabase service role stay on the server (`.env.local` for local CLI, `supabase secrets set` for Edge Functions). Never prefix those with `VITE_`.

## Support agent

Local config lives in `agent_configs/short-drama-maker-support.json`. The site widget stays hidden until `VITE_ELEVENLABS_AGENT_ID` is set.

```sh
export ELEVENLABS_API_KEY=xi-...
npx elevenlabs auth login   # or use the key above
npm run agents:add
npm run agents:push
```

Then put the printed agent ID in `.env.local` as `VITE_ELEVENLABS_AGENT_ID`. Test the agent in the [ElevenLabs dashboard](https://elevenlabs.io/app/agents) first. Enabling the widget loads a third-party ElevenLabs script; update the cookie notice before turning it on in production.
