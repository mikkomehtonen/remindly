# Implementation Plan: Event Query API + Admin UI

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ |
| Web framework | Express.js |
| Database | SQLite (via better-sqlite3) |
| Templating | EJS |
| Sessions | express-session |
| Passwords | bcrypt |
| Styling | Inline CSS (no framework) |

## Directory Layout

```
src/
  index.js                  # Entry point: express app, middleware wiring
  db/
    connection.js           # better-sqlite3 singleton, schema setup
  middleware/
    auth.js                 # session middleware, login guard
    apiKey.js               # API-key guard (x-api-key header)
  routes/
    public.js               # GET / (html) + GET /api/events (json)
    admin.js                # admin CRUD + login/logout
  views/
    layout.ejs              # shared <head>/<body> wrapper
    public/index.ejs        # public homepage (today's events)
    admin/login.ejs         # login form
    admin/dashboard.ejs     # event list + edit/delete actions
    admin/eventForm.ejs     # create/edit event form
  utils/
    dateMath.js             # alias resolver + recurring-event matcher
```

## Database Schema

### `events` table

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL CHECK (
    category IN ('Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary')
  ),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  month       INTEGER CHECK (month BETWEEN 1 AND 12),
  day         INTEGER CHECK (day BETWEEN 1 AND 31),
  event_date  TEXT CHECK (event_date LIKE '____-__-__'),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Invariants enforced in application code:

* if `is_recurring = 1` then `month` and `day` must be set, `event_date` null
* if `is_recurring = 0` then `event_date` must be set, `month` and `day` null
* one CHECK constraint can enforce this in DB; additional validation in route handlers

No users table needed — single admin account is defined purely via environment variables; credentials are never stored in DB.

## Environment Variables

```
ADMIN_USERNAME    # admin login username
ADMIN_PASSWORD    # admin login password (plaintext, hashed in-memory at boot via bcrypt)
API_KEYS          # comma-separated list of valid API keys
PORT              # default 3000
NODE_ENV          # development | production
```

## Route Map

### Public (HTML)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Homepage — shows today's events, links to other views |

### Public API (JSON)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/events` | API key required | Query events. Params: `date` (YYYY-MM-DD), `alias` (today\|tomorrow\|next_week), `category` |

Alias `next_week` returns events for the 7-day window starting from the Monday of the current week (or "next week" relative to today).

Response envelope:

```json
{
  "date": "2026-05-30",
  "events": [
    { "id": 1, "title": "Marco's birthday", "description": null, "category": "Birthday" }
  ]
}
```

Errors:
* 400 — invalid date format
* 401 — missing or invalid API key
* 500 — internal error

### Admin (server-rendered HTML)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/login` | Public | Login form |
| POST | `/admin/login` | Public | Authenticate, set session cookie |
| POST | `/admin/logout` | Session required | Destroy session, redirect to login |
| GET | `/admin` | Session required | Dashboard — list all events, ordered by relevance (recurring first, then by month/day or date) |
| GET | `/admin/events/new` | Session required | Blank event form |
| POST | `/admin/events` | Session required | Create event, redirect to dashboard |
| GET | `/admin/events/:id/edit` | Session required | Pre-filled event form |
| PUT | `/admin/events/:id` | Session required | Update event, redirect to dashboard |
| DELETE | `/admin/events/:id` | Session required | Delete event, redirect to dashboard |

Admin forms POST multipart or urlencoded data. CSRF tokens added via `csurf` middleware (or double-submit cookie pattern).

## Query Logic for Events by Date

`utils/dateMath.js` exports:

```
resolveDate(alias | 'YYYY-MM-DD') → { startDate: Date, endDate: Date }
```

| alias | start | end |
|-------|-------|-----|
| `today` | today | today |
| `tomorrow` | today+1 | today+1 |
| `next_week` | Monday of next week | Sunday of next week |
| explicit date | that date | that date |

Event matching for a date range `[start, end]`:

1. **Recurring events**: match if `(month, day)` falls within the date range when projected onto the calendar year of `start`. Handle year-boundary wrap for `next_week` spanning December→January.
2. **One-time events**: match if `event_date` falls within `[start, end]`.

SQL approach — two queries, results concatenated in JS:

```sql
-- Recurring
SELECT * FROM events
WHERE is_recurring = 1
  AND (month > :mStart OR (month = :mStart AND day >= :dStart))
  AND (month < :mEnd OR (month = :mEnd AND day <= :dEnd))
```

For single-day queries, `mStart=mEnd` and `dStart=dEnd`.

Better-sqlite3 prepared statements used throughout — no N+1 queries, one round-trip per list.

## Implementation Order

### Phase 1 — Scaffolding & DB
1. `npm init`, install deps: `express better-sqlite3 bcrypt express-session dotenv csurf`
2. Create `src/db/connection.js` — open SQLite DB file, run `CREATE TABLE` once, export singleton
3. Write `src/utils/dateMath.js` — alias resolver + recurring matcher
4. Smoke-test: `node src/index.js` prints "listening on :3000"

### Phase 2 — Admin Auth & CRUD
5. `src/middleware/auth.js` — session config, `ensureAdmin(req,res,next)` guard, bcrypt compare against env vars
6. `src/views/admin/login.ejs` — simple form (username, password)
7. `src/routes/admin.js` — login POST, logout POST, session routes
8. Event form + list views + CRUD route handlers
9. CSRF protection on all admin POST/PUT/DELETE

### Phase 3 — Public API
10. `src/middleware/apiKey.js` — guard for `/api/*` routes
11. `src/routes/public.js` GET `/api/events` — param parsing, date resolution, DB queries, JSON response
12. `GET /` — render homepage with today's events

### Phase 4 — Polish & Testing
13. Minimal CSS styling (shared stylesheet, no framework)
14. Error pages (404, 500)
15. Unit tests for `dateMath.js` (aliases, year-wrap, single-day match)
16. Integration tests: API key auth, CRUD through API, admin login flow
17. README with setup instructions, .env.example template

## Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **better-sqlite3 (sync)** | Small app, one server process; sync API avoids callback nesting and is simpler for CRUD |
| **EJS (not Pug)** | HTML-like syntax is more readable for admin forms; matches team familiarity |
| **No ORM** | Single table, simple queries; raw SQL is clearer and easier to optimize |
| **bcrypt in-memory** | Only one admin user; password in env var → hash at boot, compare in session middleware |
| **Two separate queries (recurring + fixed)** | Cleanest SQL; no complex CASE/COALESCE; JS-level dedup if same event matches both |
| **CSRF via csurf** | Industry-standard for session-based apps with state-changing POST endpoints |
| **next_week = Mon→Sun of next week** | Unambiguous; covers the full 7-day window users expect |
| **JSON envelope always wraps `events` array** | Predictable shape for API consumers; includes queried `date` for confirmation |

## Date Alias Resolution

| Alias | Resolved Range |
|-------|---------------|
| `today` | `new Date().toISOString().slice(0,10)` — single day |
| `tomorrow` | single day, `today + 1` |
| `next_week` | Monday–Sunday of week starting 7 days from today |
| arbitrary `YYYY-MM-DD` | single day |

For arbitrary dates, the validator rejects dates before 2000-01-01 and after 2099-12-31.

## Security Notes

* Admin password never stored on disk — loaded from `ADMIN_PASSWORD`, hashed with bcrypt at startup, compared during login
* API keys stored in `process.env.API_KEYS` only, never in code or DB
* `.env` files excluded via `.gitignore`
* CSRF tokens on all admin forms
* Input sanitization on all text fields (XSS prevention via EJS auto-escape + manual sanitization on rich-text fields)
* Rate limiting on `/admin/login` and `/api/events` — `express-rate-limit` added in Phase 4
* Helmet headers — `helmet` middleware for production

## Success Criteria

* `GET /api/events?alias=today` returns correct events with valid API key
* `GET /api/events?date=2026-12-31&category=Birthday` filters correctly
* Admin login with valid credentials grants access to CRUD
* Admin login with invalid credentials shows error, no session
* Recurring birthday on month/day appears for any year queried
* One-time event appears only on its exact date
* DELETE removes event from DB, subsequent queries don't return it
* All tests pass in a single `npm test` run