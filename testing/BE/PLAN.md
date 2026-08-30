# Personal Finance Backend — Implementation Plan

Target dir: /home/web-h-063/Documents/explainer-bot/testing/BE
Stack: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x async (asyncpg), PostgreSQL 16, Alembic, pytest + httpx.

## File tree (create all; no placeholders/TODOs)

```
BE/
  app/__init__.py
  app/main.py               # create_app(), include routers, error handlers, lifespan
  app/core/__init__.py
  app/core/config.py        # pydantic-settings: DATABASE_URL, SECRET_KEY, JWT_ALGORITHM=HS256, ACCESS_TOKEN_EXPIRE_MINUTES=60, ENV
  app/core/db.py            # async engine, async_sessionmaker, Base(DeclarativeBase), get_db dependency (commit/rollback per request)
  app/core/security.py      # hash_password/verify_password (passlib bcrypt), create_access_token(sub, exp), decode_token
  app/core/deps.py          # get_current_user: OAuth2PasswordBearer -> User, 401 on bad/expired/missing
  app/core/errors.py        # AppError(code, message, status, details=None) + NotFound/Conflict/Unauthorized/Unprocessable subclasses; handlers registered in main.py for AppError, RequestValidationError, Exception(500 generic message, no internals). Envelope: {"error": {"code","message","details"}}
  app/models/__init__.py    # import all models for alembic metadata
  app/models/user.py        # User: id PK, email unique+indexed (store lowercase), password_hash, is_active, created_at/updated_at timestamptz UTC
  app/models/category.py    # Category: id, user_id FK CASCADE indexed, name(50), type Enum(income,expense), created_at; UniqueConstraint handled by unique Index on (user_id, func.lower(name))
  app/models/transaction.py # Transaction: id, user_id FK CASCADE indexed, category_id FK categories RESTRICT nullable, amount NUMERIC(12,2) CHECK>0, type Enum(income,expense), description(255) not null, notes Text nullable, date Date not null, created_at/updated_at; Index(user_id, date)
  app/models/budget.py      # Budget: id, user_id FK CASCADE, category_id FK RESTRICT, year SMALLINT CHECK 1..2099, month SMALLINT CHECK 1..12, amount NUMERIC(12,2) CHECK>0; UniqueConstraint(user_id, category_id, year, month)
  app/schemas/__init__.py
  app/schemas/common.py     # Page[T] generic: items, page, page_size, total; Money = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
  app/schemas/user.py       # UserCreate(email: EmailStr, password: str min 8 max 128), UserOut(id,email,is_active,created_at), Token(access_token, token_type="bearer")
  app/schemas/category.py   # CategoryCreate(name 1..50, type), CategoryUpdate (optional fields), CategoryOut
  app/schemas/transaction.py# TxCreate(amount: Money, type, category_id optional, description 1..255, date, notes optional max 2000), TxUpdate all optional, TxOut (+category mini info)
  app/schemas/budget.py     # BudgetCreate(category_id, year, month, amount: Money), BudgetUpdate(amount only), BudgetOut(+category_name)
  app/schemas/report.py     # SummaryOut(income_total, expense_total, net, transaction_count), CategoryBreakdownItem(category_id, category_name, total, pct_of_total) + list out, BudgetVsActualItem(budget_id, category_name, month, budgeted, actual, remaining, percent_used)
  app/api/__init__.py
  app/api/v1/__init__.py
  app/api/v1/router.py      # aggregates sub-routers with tags
  app/api/v1/auth.py        # POST /auth/register (201 UserOut; dup email -> 409), POST /auth/login (OAuth2PasswordRequestForm, email in username field) -> Token; generic 401 "Invalid email or password" + 401 for inactive; GET /auth/me
  app/api/v1/categories.py  # GET /categories (plain list, all user's), POST 201, GET /{id} 404 if not owner, PUT /{id}, DELETE 204 (409 code "in_use" if transactions or budgets reference it)
  app/api/v1/transactions.py# GET /filters: category_id, type, date_from, date_to, q (ilike on description and notes), sort in {date,amount,created_at} default date, order asc|desc, page>=1 default 1, page_size 1..100 default 20 -> Page[TxOut]. selectinload category to avoid N+1. POST 201 (validate category_id belongs to user AND category.type == tx.type else 422 "category_mismatch"/404). PUT /{id}, DELETE 204. Same category checks on update.
  app/api/v1/budgets.py     # GET /budgets?year&month (both required) -> list BudgetOut, POST 201 (category must exist, owned, type=expense else 422 "not_an_expense_category"; IntegrityError on unique -> 409 "duplicate"), PUT /{budget_id} (amount), DELETE /{budget_id} 204
  app/api/v1/reports.py     # all take ?year&month required. GET /reports/summary -> totals via single aggregate (case/SUM), GET /reports/breakdown?year&month&type=expense|income (default expense) -> per-category SUM + pct, ordered desc, uncategorized as category_id=None row, GET /reports/budget-status -> join budgets with actual SUM of expense txs in that month for that category; remaining=budgeted-actual, percent_used (actual/budgeted*100, budgeted>0 guaranteed by CHECK)
  app/api/v1/health.py      # GET /health/liveness -> {"status":"ok"}; GET /health/readiness -> SELECT 1, 200 or 503
  alembic.ini
  alembic/env.py            # async-aware, reads DATABASE_URL from app settings via os.environ/env.py
  alembic/script.py.mako
  alembic/versions/0001_initial.py  # handwritten migration for all 4 tables + indexes (write manually; enums as postgresql.ENUM)
  tests/__init__.py
  tests/conftest.py         # TEST_DATABASE_URL env (default postgresql+asyncpg://finance:finance@localhost:5433/finance_test); create_all via run_sync before each test, drop after; httpx AsyncClient(ASGITransport) + override get_db; helpers: register_and_login(client,...) -> auth headers; anyio/pytest-asyncio in auto mode via pyproject
  tests/test_auth.py        # register 201 + validation failures (short pw, bad email, dup 409); login ok, wrong pw 401, unknown email 401 (same message), me w/ and w/o token, expired/garbage token 401
  tests/test_transactions.py# create 201, negative/zero/3-decimal/huge amount 422, missing category ok, income tx with expense category -> 422, other user's category -> 404; list filters (type, category, date range, q), sort+order, pagination page/page_size/total, out-of-range page -> empty items; get/update/delete own 200, other user's tx 404 for all ops
  tests/test_categories.py  # CRUD, dup name case-insensitive 409, delete with transactions 409, delete clean 204, isolation between users
  tests/test_budgets.py     # create 201, dup (user,cat,year,month) 409, budget on income category 422, update amount, delete, month=13 422, isolation
  tests/test_reports.py     # seed known txs; summary totals incl. net negative/positive; breakdown pct sums ~100 and uncategorized row; budget-status actual vs budgeted, remaining can go negative (overspend), percent_used
  tests/test_constraints.py # direct DB asserts: duplicate category index rejected, duplicate budget unique rejected, CHECK amount>0 rejected, tx delete w/ RESTRICT category delete blocked
  tests/test_health.py      # liveness 200, readiness 200 with DB up
  pyproject.toml            # runtime deps + [tool.pytest.ini_options] asyncio_mode="auto"
  requirements.txt          # pinned-ish runtime deps (fastapi, uvicorn[standard], pydantic>=2, pydantic-settings, email-validator, sqlalchemy[asyncio]>=2, asyncpg, alembic, passlib[bcrypt], bcrypt<4.1 (passlib compat pin), python-jose[cryptography], python-multipart)
  requirements-dev.txt      # pytest, pytest-asyncio, httpx, anyio
  .env.example              # DATABASE_URL, SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES, TEST_DATABASE_URL
  .gitignore                # .env, __pycache__, .pytest_cache, venv
  Dockerfile                # python:3.12-slim, install reqs, CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
  docker-compose.yml        # db: postgres:16 (user/pass/finance/db, port 5433:5432 host for tests, healthcheck); api: build ., env DATABASE_URL -> db service, depends_on healthy, command: sh -c "alembic upgrade head && uvicorn ..."
  README.md                 # overview, structure tree, quickstart (docker compose up + manual venv path), migration commands, test instructions (spin test db: docker run postgres or compose), example curl requests for every endpoint, design notes (money/tz/isolation)
```

## Cross-cutting rules

- Money: Decimal everywhere; Pydantic Decimal validation with decimal validator rejecting >2 decimal places (use `Decimal` + custom check: `amount != amount.quantize(Decimal("0.01"))` -> 422). Never float. JSON serialization of Decimals is fine as strings/numbers via pydantic.
- All list/lookup queries filter `Model.user_id == current_user.id`. Fetch-by-id = `select(...).where(id==, user_id==)` -> 404 when absent OR foreign. Never return data then check owner.
- Category deletion 409 check: `SELECT 1 FROM transactions WHERE category_id=:id LIMIT 1` same for budgets.
- get_db: session per request; commit on success, rollback on exception. Services/routers use `await session.flush()` where ids needed before commit. IntegrityError catch: `await session.rollback()` then raise Conflict.
- OpenAPI: every route has summary, response_model, and example payloads via `Body(..., examples=[...])` / schema examples on models.
- Passwords: min 8, bcrypt. Token: `{"sub": str(user.id), "exp": ...}`, decode validates and loads user.
- Health endpoints unauthenticated; everything else behind get_current_user.

## Verification steps (agent must run)

1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt`
2. Start test postgres: `docker run -d --name finance-test-pg -p 5433:5432 -e POSTGRES_USER=finance -e POSTGRES_PASSWORD=finance -e POSTGRES_DB=finance_test postgres:16` (remove container when done)
3. `TEST_DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test .venv/bin/pytest -q` — ALL tests must pass. Iterate until green.
4. `alembic revision --autogenerate` not required; handwritten 0001 must apply cleanly against a fresh db: run `alembic upgrade head` once against a scratch db and confirm no errors (can reuse test db after drop all / another db name).
