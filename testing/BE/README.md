# Personal Finance Backend

FastAPI + SQLAlchemy 2 (async) + PostgreSQL 16 personal finance API.
Users track income/expense transactions, organize them into categories, set
monthly budgets, and read month-level reports.

## Structure

```
app/
  main.py                  # create_app(), routers, error handlers, lifespan
  core/
    config.py              # pydantic-settings (DATABASE_URL, SECRET_KEY, ...)
    db.py                  # async engine, session factory, Base, get_db
    security.py            # bcrypt hashing, JWT create/decode
    deps.py                # get_current_user (OAuth2 Bearer)
    errors.py              # AppError + handlers -> {"error": {code,message,details}}
  models/                  # user, category, transaction, budget
  schemas/                 # pydantic v2 request/response models (+ Page[T], Money)
  api/v1/                  # auth, categories, transactions, budgets, reports, health
alembic/                   # async-aware migration env + handwritten 0001
tests/                     # pytest (asyncio auto mode) + httpx, real PostgreSQL
```

## Quickstart (docker compose)

```bash
docker compose up --build       # db on localhost:5433, api on :8000, migrations applied
open http://localhost:8000/docs
```

## Quickstart (manual)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt

# Start a postgres for the app (or reuse docker compose up db):
docker run -d --name finance-pg -p 5432:5432 \
  -e POSTGRES_USER=finance -e POSTGRES_PASSWORD=finance -e POSTGRES_DB=finance postgres:16

cp .env.example .env            # then edit SECRET_KEY
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

## Migrations

```bash
.venv/bin/alembic upgrade head                     # apply
DATABASE_URL=... .venv/bin/alembic upgrade head    # URL from env wins
.venv/bin/alembic downgrade -1                     # rollback one step
```

## Tests

Tests run against a real PostgreSQL (no sqlite fakes). Start a test db on 5433:

```bash
docker run -d --name finance-test-pg -p 5433:5432 \
  -e POSTGRES_USER=finance -e POSTGRES_PASSWORD=finance -e POSTGRES_DB=finance_test postgres:16

TEST_DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_test \
  .venv/bin/pytest -q
```

(If your local 5433 is taken, point `TEST_DATABASE_URL` at any free port.)

## Example requests

```bash
BASE=http://localhost:8000/api/v1

# Health (no auth)
curl $BASE/health/liveness
curl $BASE/health/readiness

# Register / login / me
curl -X POST $BASE/auth/register -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"supersecret123"}'
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -d 'username=user@example.com&password=supersecret123' | jq -r .access_token)
AUTH="Authorization: Bearer $TOKEN"
curl $BASE/auth/me -H "$AUTH"

# Categories
curl $BASE/categories -H "$AUTH"
curl -X POST $BASE/categories -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Groceries","type":"expense"}'
curl $BASE/categories/1 -H "$AUTH"
curl -X PUT $BASE/categories/1 -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Food"}'
curl -X DELETE $BASE/categories/1 -H "$AUTH" -i

# Transactions
curl -X POST $BASE/transactions -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amount":"42.50","type":"expense","category_id":1,
       "description":"Weekly groceries","notes":"Supermarket","date":"2026-03-14"}'
curl "$BASE/transactions?type=expense&date_from=2026-03-01&date_to=2026-03-31&q=groc&sort=amount&order=desc&page=1&page_size=10" -H "$AUTH"
curl $BASE/transactions/1 -H "$AUTH"
curl -X PUT $BASE/transactions/1 -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amount":"50.00"}'
curl -X DELETE $BASE/transactions/1 -H "$AUTH" -i

# Budgets
curl -X POST $BASE/budgets -H "$AUTH" -H 'content-type: application/json' \
  -d '{"category_id":1,"year":2026,"month":3,"amount":"400.00"}'
curl "$BASE/budgets?year=2026&month=3" -H "$AUTH"
curl -X PUT $BASE/budgets/1 -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amount":"450.00"}'
curl -X DELETE $BASE/budgets/1 -H "$AUTH" -i

# Reports
curl "$BASE/reports/summary?year=2026&month=3" -H "$AUTH"
curl "$BASE/reports/breakdown?year=2026&month=3&type=expense" -H "$AUTH"
curl "$BASE/reports/budget-status?year=2026&month=3" -H "$AUTH"
```

Errors always come back as:

```json
{"error": {"code": "category_mismatch", "message": "...", "details": null}}
```

## Design notes

- **Money** is `NUMERIC(12,2)` in Postgres and `Decimal` everywhere in Python —
  never float. Pydantic rejects amounts with more than 2 decimal places (422).
- **Timezones**: timestamps are `timestamptz` in UTC; transaction `date` is a
  plain calendar date (a finance day is not a timezone event).
- **User isolation**: every query filters `user_id == current_user.id` in the
  WHERE clause; a missing row and someone else's row both return 404, so
  existence of foreign resources never leaks.
- **Category uniqueness** is a unique index on `(user_id, lower(name))`, so
  duplicates are rejected case-insensitively per user, enforced by the database.
- **Delete safety**: categories are RESTRICT against transactions and budgets
  (API pre-checks and answers 409 `in_use`); user deletion cascades.
- **N+1**: category rows on transactions/budgets load via `selectin`.
