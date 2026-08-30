# Personal Finance Frontend — Implementation Plan

Target dir: /home/web-h-063/Documents/explainer-bot/testing/FE
Backend: /home/web-h-063/Documents/explainer-bot/testing/BE (running at http://localhost:8001, docs at /docs). READ the BE routers/schemas in testing/BE/app/api/v1 + app/schemas for exact paths and response shapes before writing API code. All endpoints under /api/v1, error envelope {"error":{"code","message","details"}}, login is form-encoded (username= email), amounts are strings like "45.67".

## Step 0 — minimal backend changes (do these first, verify BE tests still pass: 47 passed)

1. CORS: add `CORSMiddleware` in BE/app/main.py — allow origins from env `CORS_ORIGINS` (comma-separated, default `http://localhost:5173,http://localhost:5174,http://localhost:5175`), credentials false, standard methods/headers.
2. Trends endpoint: `GET /api/v1/reports/trends?months=N` (N 1..24 default 6) -> {months:[{year,month,income_total,expense_total,net}]} newest-last, single GROUP BY on date_trunc month; zero rows for months with no txs (fill client-side or server-side — server-side preferred). Add OpenAPI example. Add 1-2 tests to BE/tests/test_reports.py. Rebuild/restart the running BE container after changes (compose files: docker-compose.yml + docker-compose.override.yml already exist in BE, api on 8001, db host port 5435).

## FE stack (Vite scaffold, TypeScript)

- react-router-dom v7 (or v6), @tanstack/react-query v5, axios, react-hook-form + zod + @hookform/resolvers, recharts, lucide-react, date-fns, tailwindcss v4 (@tailwindcss/vite plugin).
- Vite dev server port 5173; if occupied use next free and note it. Set VITE_API_URL in .env (default http://localhost:8000, actual dev default http://localhost:8001). Provide .env.example.

## Directory layout

```
FE/
  index.html, vite.config.ts, tsconfig*, .env.example, .gitignore, README.md
  src/main.tsx            # Router + QueryClientProvider + ToastProvider (custom, no lib)
  src/App.tsx             # route table: /auth/* outside shell, protected shell under /
  src/api/client.ts       # axios instance, token interceptor, 401 handler -> clear token + redirect /auth/signin
  src/api/types.ts        # TS mirrors of BE schemas (User, Category, Transaction, Budget, Page<T>, reports...)
  src/api/endpoints.ts    # typed functions per endpoint group (auth, categories, transactions, budgets, reports)
  src/auth/AuthContext.tsx # login(email,pw) -> token stored localStorage 'pf_token'; logout clears; useAuth()
  src/auth/ProtectedRoute.tsx
  src/lib/format.ts       # formatMoney(str Decimal, currency="$"), formatDate, monthLabel; parseMoneyInput (string handling, <=2 decimals)
  src/lib/queryKeys.ts    # centralized query key factory (tx list keys carry filter params)
  src/components/         # Layout(Shell: sidebar desktop / bottom tabbar mobile), StatCard, MoneyText, Badge(type), DataTable or TxList, Pagination, CategoryPicker, EmptyState, Skeleton components, Toast system, Modal-free ConfirmInline, ErrorState(retry button), PageHeader, MonthPicker (prev/next arrows + month name)
  src/components/forms/   # TransactionForm (used by add/edit), BudgetForm, CategoryForm, SignIn/SignUp forms — react-hook-form + zod, inline field errors, submitting state
  src/pages/Dashboard.tsx
  src/pages/Transactions.tsx
  src/pages/Budgets.tsx
  src/pages/Categories.tsx
  src/pages/Analytics.tsx
  src/pages/auth/SignIn.tsx SignUp.tsx
```

## Screens (all data from real API via TanStack Query; NO mock data)

### Auth — SignIn/SignUp
Single column, brand-mark, no chrome. Validation: email format, password >=8 <=72. Backend 401/409 surfaced as friendly message (map code->message, never dump raw). Loading spinner in submit button; disable while submitting. On success -> dashboard.

### Shell
Desktop ≥1024: left sidebar (logo, nav: Dashboard, Transactions, Budgets, Analytics, Categories; bottom: user email + sign out). Mobile: top header + bottom tab bar, content single column. Nav = aria-current, visible focus rings everywhere, skip-to-content link, semantic landmarks.

### Dashboard
MonthPicker (default current month) drives all widgets via year/month params:
- Row of 4 stat tiles: Income, Expenses, Net cash flow (green/red), Remaining budget (from /reports/budget-status; sum budgeted - actual, note when no budgets exist)
- "Spending trends" line/area chart of last 6 months (new trends endpoint) — income vs expense
- Category breakdown donut (/reports/breakdown) with legend + amounts, top 6 + "Other"
- Budget health strip: top budgets by % used, amber ≥80%, red >100% (from budget-status)
- Recent transactions: last 5 (GET /transactions?sort=created_at&order=desc&page_size=5), compact rows, link to full list
Loading: skeletons matching each layout. Empty: first-run experience (illustrated empty + "Add your first transaction" CTA).

### Transactions
- Toolbar: search box (debounced 300ms -> q), type filter (all/income/expense), category filter (select), date-range (from/to native date inputs), clear-filters button when any active
- Sortable headers (date, amount) -> sort/order params
- Pagination (page/page_size, prev/next + "showing X–Y of Z")
- Rows: icon by type, description, category chip, date, amount colored (+/-)
- Add: primary button opens inline drawer/panel (right side sheet on desktop, full-screen sheet mobile) with TransactionForm — NOT a centered modal stack; Edit reuses form; Delete = inline two-step confirm on the row (click delete -> row shows "Delete? Yes/No"), optimistic remove + toast with Undo via re-add? NO undo lib — undo can re-post same body; keep it: toast "Deleted — Undo" that re-creates tx. If id-dependent category checks make re-add fail, drop undo and just confirm-first (decision at impl time; prefer keep).
- Optimistic updates for edit/delete; rollback + toast on API error.
- Empty state distinguishes "no transactions at all" vs "no results for these filters".

### Budgets
- MonthPicker; list (not card-grid) of budgets for that month: category name, budgeted, actual, remaining, progress bar (green <80, amber 80-100, red >100 with overspend label)
- Add budget: inline row at bottom of list (expense categories only — picker filters client-side and BE enforces)
- Edit amount inline (click amount, becomes input); Delete via inline confirm. 409 duplicate -> "Budget already exists for this category this month" and point at the existing row.

### Categories
- Two sections: Expense / Income. List with tx counts? (BE doesn't provide counts — skip counts, keep simple.) Add form inline; rename via inline edit; delete: if BE 409 in_use, show "This category is used by transactions/budgets" error state. Duplicate -> 409 message.

### Analytics
- Period control: last 3/6/12 months
- Income vs expense grouped bar chart per month (trends endpoint)
- Net cash flow line chart same period
- Category breakdown for selected month with table (amount + % + count-ish)
- Everything aggregates via existing endpoints; note explicitly which endpoint feeds each chart.

## Cross-cutting behavior
- Every query: skeleton while loading, ErrorState with Retry on failure, EmptyState when empty.
- Toasts: success on create/update/delete, error with mapped BE message on failure.
- Money: render from backend strings with Intl; form input validates <=2 decimals, >0; never do Decimal math client-side beyond display sign/format (sums come from BE reports endpoints).
- Dates: send YYYY-MM-DD strings; display via date-fns; never Date-construct the tx date for display (timezone trap) — parse explicitly.
- Accessibility: labeled inputs (htmlFor), focus-visible rings, dialogs/sheets with role=dialog + Esc close + focus trap, aria-live for toasts, color is never the ONLY signal (icons/labels accompany).
- No every-section-a-card: stat tiles share one bordered panel row; lists are rows/dividers; cards reserved for charts + forms.

## Verification (agent must run, iterate until green)
1. `npm run build` — zero TS errors, zero vite warnings-as-errors.
2. BE still green: `.venv/bin/pytest -q` in BE (expect 49+ after trends tests).
3. Start FE dev server against the running BE on 8001; curl FE index 200.
4. Integration sanity WITHOUT browser: login via BE, then exercise each endpoint the FE calls (trends, budget-status, breakdown, summary, tx page/filters) confirming shapes match FE/src/api/types.ts exactly — mismatch = fix FE types or note.
5. If a headless browser (playwright/chromium) is available, screenshot all 6 pages (auth + 5 app pages) desktop+mobile widths into FE/screenshots/; if not available, say so in the report and rely on build + a11y-conscious code.
6. Responsive: verify breakpoints at 375/768/1280 via the screenshots or CSS audit.

## README (FE/README.md)
Prereq (BE running), env setup, dev command, build, prod-serve (vite preview / nginx note in Dockerfile optional — include a simple FE Dockerfile + nginx.conf serving dist with /assets caching), setup for the whole app (BE + FE together), architecture notes, backend changes made.
