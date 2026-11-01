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
  utils/dateMath.js     # alias resolver + recurring-event matcher
views/                  # app.set('views') points at ./views — NOT src/views
  layout.ejs
  error.ejs
  partials/
    favicon.ejs
    logo.ejs
    packing-list.ejs
  public/index.ejs
  admin/login.ejs
  admin/dashboard.ejs
  admin/eventForm.ejs   # inline ES5 script: field toggles + packing auto-grow
tests/
  dateMath.test.js      # unit tests for date utilities
  categories.test.js    # pins the exported VALID_CATEGORIES list
  api.test.js           # integration tests for API endpoints
  connection.test.js    # DB schema migration unit tests
  packingAutogrow.test.js # jsdom unit tests for the admin form's packing auto-grow
  helpers/dom.js        # shared jsdom bootstrap (parse markup / run a view's scripts)
```

## Environment Variables (all required at runtime)

| Variable | Purpose |
|----------|---------|
| `ADMIN_USERNAME` | Single built-in admin login |
| `ADMIN_PASSWORD` | Plaintext at deploy; hashed in-memory at boot |
| `API_KEYS` | Comma-separated valid API keys for public API |
| `PORT` | Default `3000` |
| `NODE_ENV` | `development` or `production` |
| `LOGO_LINK_URL` | Optional. URL the header logo links to; if unset, logo is shown without a link |
| `DB_FILE` | Optional. Overrides the SQLite database path (default `data/remindly.db`); the test suite uses it to stay off the real DB |

`.env` files are gitignored. Copy `.env.example` to `.env` and fill in your values.

## Database Schema (two tables)

- `events` — `id`, `title`, `description`, `category` (CHECK: `Birthday`, `Name Day`, `Flag Day`, `Holiday`, `Anniversary`, `Other`, `Travel`), `is_recurring` (0 or 1), `month`/`day` (for recurring), `event_date` (YYYY-MM-DD for one-time), `created_at`, `updated_at`
- `event_packing_items` — `id`, `event_id` (`REFERENCES events(id) ON DELETE CASCADE`), `label`, `packed` (0 or 1, CHECK), `created_at`, `updated_at`
- **No `users` table.** Admin is env-only.
- Invariant: `is_recurring=1` → `month`+`day` set, `event_date` null; `is_recurring=0` → opposite.
- Packing invariant: `packed` ∈ {0,1}; child rows cascade-delete with their event (`PRAGMA foreign_keys=ON`); items are only ever authored/synced for `Travel` events — switching an event's category away from Travel hides the rows but never deletes them.

## API Behavior

- `GET /api/events` requires `x-api-key` header validated against `API_KEYS`.
- Query params: `date` (YYYY-MM-DD), `alias` (`today` | `tomorrow` | `next_week`), `category`.
- `next_week` = Monday–Sunday of the week starting 7 days from today.
- Response envelope: `{ date: "YYYY-MM-DD", events: [...] }`
- `next_week` envelope: `{ startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", events: [...] }`
- Recurring events match by `(month, day)` projected onto the query year; one-time events match `event_date` directly.
- SQL approach: **two separate queries** (recurring + fixed) concatenated in JS. Do not try to unify them into one clever SQL query.
- The JSON API is untouched by the packing-list feature: no `packingItems`/`packed` keys anywhere in `GET /api/events`. Items are attached to the HTML view only, via `attachPackingItems()` in the `GET /` handler (`src/routes/public.js`).

## Admin Routes & Auth

- All `/admin/*` (except `/admin/login`) require session cookie.
- Login POST validates against bcrypt hash of env password.
- Logout POST destroys session.
- CRUD: `GET/POST /admin/events`, `GET/PUT/DELETE /admin/events/:id`
- Forms are server-rendered EJS with CSRF tokens (via custom middleware).
- Packing items are authored inside the one event form via index-aligned `packing_items[]` / `packing_item_ids[]` arrays; server-side sync runs only when the submitted `category === 'Travel'`.
- Public packing toggle: `POST /packing/items/:id/packed` — no API key, protected by `csrfProtection` applied as **route-level** middleware; `csrfProtection` now also runs on `GET /` (anonymous visitors get a session holding the CSRF token). `returnTo` is allowlisted to `/` or `/?alias=<known alias>` — anything else redirects to `/`.

## Code Quality

| Tool | Scope | Notes |
|------|-------|-------|
| **ESLint** | JS source (`src/`) | Flat config with `eslint-config-prettier` |
| **Prettier** | JS source (`src/`) | Single source of truth for formatting; run before commits |
| **lint-staged** | Pre-commit | ESLint + Prettier on staged JS files |
| **Node test runner** | `tests/` | Built-in `node --test`, no external test framework; `jsdom` (devDep) drives DOM-level view tests |
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
- **SQLite CHECK constraint migrations use rebuild-and-copy via `db.transaction()`.** SQLite does not support `ALTER TABLE … ALTER CONSTRAINT`. To change a CHECK, create a new table, copy rows with a **named column list** (not `SELECT *`, so legacy column order can't shuffle values), drop the old table, and rename. Always wrap the DDL sequence in `db.transaction(() => { … })()` for crash safety — without it, a process crash between `DROP TABLE` and `ALTER TABLE … RENAME` orphans the data.
- **Turn `foreign_keys` OFF around a rebuild-and-copy `DROP TABLE`.** With FKs ON, `DROP TABLE parent` runs an implicit `DELETE FROM parent` that fires children's `ON DELETE CASCADE` — `migrateCategoryConstraint` would silently wipe every `event_packing_items` row. Toggle the pragma **outside** the transaction (it is a no-op inside one) and restore ON in a `finally`.
- **Share DDL between table creation and migration.** Column definitions are generated from the single `EVENTS_COLUMNS` name/def list in `src/db/connection.js` — `EVENTS_TABLE_COLUMNS` (DDL text) and `EVENTS_COLUMN_NAMES` (migration INSERT/SELECT) both derive from it. Add/rename columns only by editing `EVENTS_COLUMNS`.
- **Pin generated-schema shape with `PRAGMA table_info`.** DDL derived from config (e.g., `CHECK` built from `VALID_CATEGORIES`) is only drift-proof if tests assert the full `name:type` column list, not just the CHECK clause text. Transcribing hand-written DDL into a generated column list once silently dropped `INTEGER`/`TEXT` on `month`/`day`/`event_date`; `EXPECTED_COLUMN_TYPES` in `tests/connection.test.js` now guards this on the fresh `initDb` schema and every rebuild path.
- **Integration tests must never touch the real `data/remindly.db`.** Set `process.env.DB_FILE` to a throwaway file (e.g., `data/test-api.db`) **before** `require('../src/index')`, and tear down by deleting the file — never by `DELETE`-ing rows matched on title. A title-based cleanup in `api.test.js` once destroyed production data on every run.
- **Time-zone-sensitive tests must match the server's timezone.** The server resolves date aliases (`today`, `tomorrow`, etc.) in `Europe/Helsinki`. Tests that compute month/day for recurring events must also use Helsinki timezone via `new Date().toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })`, not `new Date()`.
- **`GET /` now sets a `connect.sid` cookie for anonymous visitors** (csrfProtection runs there to seed the CSRF token for packing forms). A new `Set-Cookie` on `/` responses is expected behavior, not a regression.
- **Packing item order is one SQL rule, never JS re-sorting:** public pages/toggle re-render use `ORDER BY packed ASC, id ASC` (packed last), the admin form uses `ORDER BY id ASC`. Tie-breaking on `id` is deliberate — `datetime('now')` has one-second resolution, so ordering by pack time makes HTML-order assertions flaky.
- **Packing caps are mirrored in three places.** The 50-item cap exists as `validatePackingItems` (server), `MAX_ROWS` in the `eventForm.ejs` inline script (auto-grow append guard), and `PACKING_MAX_ROWS` in the same view's EJS, which clamps the 3 blank rows so an event near the cap never renders blanks that would push a submission over 50. The 200-char label cap is mirrored by `maxlength="200"` in both blank-row renderers (the EJS loop and `initPackingAutogrow`). Change all of them together; `tests/packingAutogrow.test.js` pins the appended row's attributes to the server-rendered blank row, and its cap tests pin the 50-row ceiling from both sides.
- **Verify inline view scripts by running them, never by substring-matching.** ESLint/Prettier skip `.ejs`, so the admin form's inline ES5 script is guarded only by tests: parse the served HTML with `tests/helpers/dom.js` (`windowFromHtml` uses `runScripts: 'dangerously'` and awaits window `load` — jsdom's `readyState` flips to `complete` only in a microtask after construction). Assert `typeof window.initPackingAutogrow === 'function'` and `String(window.onload)`; a `body.includes('initPackingAutogrow')` marker also passes for a function that is defined but never called. Substring counts of markup are unsafe for the same reason — the script contains `name="packing_items[]"` inside selector strings, so row counts need a parsed DOM (`documentFromHtml`), not `body.split(...)`.
