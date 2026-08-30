# Ledgerly — Personal Finance Frontend

React + TypeScript SPA for the Personal Finance API (`../testing/BE`).
Stack: Vite 6, React Router 7, TanStack Query 5, axios, react-hook-form + zod, Recharts, Tailwind CSS v4.

## Prerequisites

- Node 20+ (dev verified on Node 22)
- Backend running at `http://localhost:8001`
  (`cd ../BE && docker compose -f docker-compose.yml -f docker-compose.override.yml up -d`)
  Demo account: `demo@example.com` / `correct-horse-battery`

## Setup & run

```bash
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:8001
npm run dev               # http://localhost:5173
```

If port 5173 is busy, Vite picks the next free port and prints it.

## Build & preview

```bash
npm run build             # tsc -b && vite build -> dist/
npm run preview           # serve dist/ locally
```

## Production serve (Docker + nginx)

```bash
docker build -t pf-fe .
docker run -p 8080:80 pf-fe   # http://localhost:8080
```

`nginx.conf` serves `dist/` with an SPA fallback and `Cache-Control: immutable`
for hashed `/assets/*` files. Point `VITE_API_URL` at your public API URL at
build time (`docker build --build-arg ...` — or edit `.env` before building).

## Running the whole app (BE + FE)

1. Backend: `cd ../BE && docker compose -f docker-compose.yml -f docker-compose.override.yml up -d`
   (API on `http://localhost:8001`, docs at `/docs`)
2. Frontend: `npm run dev` in this folder → `http://localhost:5173`.
   CORS is enabled on the backend for `localhost:5173–5175`.

## Architecture notes

- `src/api/` — typed axios client. Token interceptor + 401 handler that clears
  the session and redirects to `/auth/signin`. All Decimal amounts stay
  **strings** end-to-end; only `Intl.NumberFormat` / chart libraries touch them.
- `src/lib/queryKeys.ts` — one key factory; tx list keys carry their filters so
  cache entries never collide.
- Money math: never client-side except integer-cents summation in
  `sumAmounts()` (used for one derived dashboard tile; the BE has no
  "total remaining" endpoint).
- Dates: transaction dates are `YYYY-MM-DD` strings, parsed from parts — never
  via `new Date(str)` (UTC-shift trap).
- Mutations: create/update/delete + Undo-on-delete (re-POST) invalidate
  `transactions`, `reports`, and `budgets` keys — reports depend on tx data.
- Accessibility: skip link, landmarks, `aria-current` nav, focus-visible rings,
  focus-trapped sheet (`role=dialog`, Esc), `aria-live` toasts, color never the
  only signal.

## Backend changes made for this frontend

1. **CORS middleware** (`BE/app/main.py` + `CORS_ORIGINS` setting) — without it
   the browser blocks every request from the Vite origin.
2. **`GET /api/v1/reports/trends?months=N`** (`BE/app/api/v1/reports.py`) —
   monthly income/expense/net, newest-last, zero-filled server-side; single
   `GROUP BY date_trunc('month', …)`. Powers the dashboard trend chart and the
   Analytics bar/line charts. Two tests added (`BE/tests/test_reports.py`).
