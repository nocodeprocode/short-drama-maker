# Short Drama Maker

Vike + React app with a production engine: story in, consistent cast, dialogue-driven vertical shots, finished episode out.

Work happens on `staging`. `main` is production.

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
| `pages/` | Vike UI (shell + public legal pages; no editor in Phase 0) |
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
| Before paid credits | Stripe **test** restricted key + `STRIPE_WEBHOOK_SECRET`. Checkout is not implemented yet; the webhook receiver is. |
| Not yet | Cloudflare R2, Turnstile, Merchant of Record, service-role in the browser |

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
