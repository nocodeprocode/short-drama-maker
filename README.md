# Short Drama Maker

A [Vike](https://vike.dev) + React + Vite app with server-side rendering. The first slice is a Hello World demo.

Generated from [vike.dev/new](https://vike.dev/new) (`create-vike` / Bati) with `--react`, then reduced to a single page.

## Branches

| Branch | Role |
| --- | --- |
| `staging` | Development. New work lands here. |
| `main` | Production. Promote a verified `staging` snapshot here. |

## Requirements

- Node.js 22 or later
- npm

## Run locally

```sh
npm install
npm run dev
```

The SSR development server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Supabase

This app talks to the `short-drama-maker` Supabase project through the official JavaScript client and the publishable key.

```sh
cp .env.example .env.local
```

Then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project Connect panel. Do not put a secret or `service_role` key in this repo.

The home page fetches Auth health during SSR so the first HTML already includes the connection status.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vike development server with SSR |
| `npm run build` | Create a production build |
| `npm run preview` | Build and preview the production server |

## Layout

- `vite.config.ts` — Vite + Vike + React plugins
- `pages/+config.ts` — Vike settings, including `ssr: true` and `vike-react`
- `pages/+Layout.tsx` — Shared page shell
- `pages/index/+Page.tsx` — Hello World page (`/`)
- `pages/_error/+Page.tsx` — 404 and error page
