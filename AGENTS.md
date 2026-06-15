# Agent Notes — remindly

## Project Status

Scaffolding complete. All phases implemented and verified. See `.opencode/plans/` for design decisions.

- `interview/event-query-api-admin.md` — product requirements & Q&A
- `.opencode/plans/plan-event-query-api-admin.md` — implementation plan, schema, route map
- `.opencode/plans/checklist-event-query-api-admin.md` — execution checklist

Trust the plan over any ad-hoc guesses when generating code.

## Tech Stack & Conventions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20+ | |
| DB | SQLite via `better-sqlite3` | **Synchronous API** — do not add async/await wrappers around DB calls |
| Templating | EJS | Not Pug; HTML-like syntax for admin forms; views are standalone (no layout engine) |
| Sessions | `express-session` | |
| Password hashing | `bcrypt` | Hash the single admin password at boot, never store in DB |
| CSRF | Custom `src/middleware/csrf.js` | Session-based CSRF token (replaced deprecated `csurf` package) |
| Styling | Inline CSS in each view | No CSS framework; each view is self-contained |

## Directory Layout

```
src/
  index.js              # Express app bootstrap, middleware wiring
  db/connection.js      # better-sqlite3 singleton + schema setup
  middleware/
    auth.js             # session config + admin guard
    apiKey.js           # x-api-key header validation
    csrf.js             # custom CSRF protection
  config/
    categories.js       # shared VALID_CATEGORIES array
    swagger.js          # swagger-jsdoc spec
  routes/
    public.js           # GET / (HTML), GET /api/events (JSON)
    admin.js            # login/logout + event CRUD
  views/
    layout.ejs
    public/index.ejs
    admin/login.ejs
    admin/dashboard.ejs
    admin/eventForm.ejs
    error.ejs
  utils/dateMath.js     # alias resolver + recurring-event matcher
tests/
  dateMath.test.js      # unit tests for date utilities
  api.test.js           # integration tests for API endpoints
  connection.test.js    # DB schema migration unit tests
```

## Environment Variables (all required at runtime)

| Variable | Purpose |
|----------|---------|
| `ADMIN_USERNAME` | Single built-in admin login |
| `ADMIN_PASSWORD` | Plaintext at deploy; hashed in-memory at boot |
| `API_KEYS` | Comma-separated valid API keys for public API |
| `PORT` | Default `3000` |
| `NODE_ENV` | `development` or `production` |

`.env` files are gitignored. Copy `.env.example` to `.env` and fill in your values.

## Database Schema (single table)

- `events` — `id`, `title`, `description`, `category` (CHECK: `Birthday`, `Name Day`, `Flag Day`, `Holiday`, `Anniversary`, `Other`), `is_recurring` (0 or 1), `month`/`day` (for recurring), `event_date` (YYYY-MM-DD for one-time), `created_at`, `updated_at`
- **No `users` table.** Admin is env-only.
- Invariant: `is_recurring=1` → `month`+`day` set, `event_date` null; `is_recurring=0` → opposite.

## API Behavior

- `GET /api/events` requires `x-api-key` header validated against `API_KEYS`.
- Query params: `date` (YYYY-MM-DD), `alias` (`today` | `tomorrow` | `next_week`), `category`.
- `next_week` = Monday–Sunday of the week starting 7 days from today.
- Response envelope: `{ date: "YYYY-MM-DD", events: [...] }`
- `next_week` envelope: `{ startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", events: [...] }`
- Recurring events match by `(month, day)` projected onto the query year; one-time events match `event_date` directly.
- SQL approach: **two separate queries** (recurring + fixed) concatenated in JS. Do not try to unify them into one clever SQL query.

## Admin Routes & Auth

- All `/admin/*` (except `/admin/login`) require session cookie.
- Login POST validates against bcrypt hash of env password.
- Logout POST destroys session.
- CRUD: `GET/POST /admin/events`, `GET/PUT/DELETE /admin/events/:id`
- Forms are server-rendered EJS with CSRF tokens (via custom middleware).

## Code Quality

| Tool | Scope | Notes |
|------|-------|-------|
| **ESLint** | JS source (`src/`) | Flat config with `eslint-config-prettier` |
| **Prettier** | JS source (`src/`) | Single source of truth for formatting; run before commits |
| **lint-staged** | Pre-commit | ESLint + Prettier on staged JS files |
| **Node test runner** | `tests/` | Built-in `node --test`, no external test framework |
| **Swagger UI** | `/docs` | API documentation via `swagger-ui-express`, spec in `src/config/swagger.js` |

**Commands:**

```bash
npm run lint      # eslint src/
npm run format    # prettier --write "src/**/*.js"
npm test          # node --test tests/**/*.test.js
npm start         # node src/index.js
```

Run `lint -> format -> test` before pushing. CI should enforce the same order.

## Gotchas

- **better-sqlite3 is sync.** Avoid `async/await` around DB calls; use `.prepare().all()` / `.run()` directly.
- EJS auto-escapes output; do not disable escaping on user-provided fields.
- Date range queries for recurring events must handle December→January year-wrap when `next_week` spans the boundary.
- Admin credentials live **only** in env vars — never seed a users table or hardcode defaults.
- API keys are env-only — no key management UI.
- **`cookie-parser` is an explicit dependency** — added when replacing `csurf` with custom CSRF middleware.
- **SQLite CHECK constraint migrations use rebuild-and-copy via `db.transaction()`.** SQLite does not support `ALTER TABLE … ALTER CONSTRAINT`. To change a CHECK, create a new table, `INSERT INTO … SELECT *`, drop the old table, and rename. Always wrap the DDL sequence in `db.transaction(() => { … })()` for crash safety — without it, a process crash between `DROP TABLE` and `ALTER TABLE … RENAME` orphans the data.
- **Share DDL between table creation and migration.** When a migration rebuilds the same table with updated constraints, extract column definitions into a template literal constant (e.g., `EVENTS_TABLE_COLUMNS`) used by both `CREATE TABLE` and the migration's `CREATE TABLE events_new`. Otherwise the two copies will drift and the migration will silently produce a wrong schema.
- **Time-zone-sensitive tests must match the server's timezone.** The server resolves date aliases (`today`, `tomorrow`, etc.) in `Europe/Helsinki`. Tests that compute month/day for recurring events must also use Helsinki timezone via `new Date().toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })`, not `new Date()`.
