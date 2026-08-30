# Vike React Hello World

A minimal [Vike](https://vike.dev) app that uses React and Vite with server-side rendering enabled. The home page is a Hello World demo.

Generated from [vike.dev/new](https://vike.dev/new) (`create-vike` / Bati) with `--react`, then reduced to a single page.

## Requirements

- Node.js 22 or later
- npm

## Run locally

```sh
npm install
npm run dev
```

The SSR development server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

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
