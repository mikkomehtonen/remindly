# Execution Checklist: Event Query API + Admin UI

Use this checklist while implementing. Complete each phase fully before moving on.

## Phase 1 - Scaffolding and Tooling

- [ ] Initialize project (`npm init -y`)
- [ ] Install runtime dependencies: `express`, `better-sqlite3`, `bcrypt`, `express-session`, `dotenv`, `csurf`, `method-override`
- [ ] Install dev dependencies for quality gates (ESLint, Prettier, lint-staged, and related config packages)
- [ ] Add `package.json` scripts: `lint`, `format`, `test`, `start`
- [ ] Create initial directory structure under `src/` and `views/`
- [ ] Add base `src/index.js` app bootstrap with middleware placeholders and route mounting
- [ ] Verify app starts and listens on configured port

Exit criteria:
- [ ] `node src/index.js` runs without startup errors
- [ ] `npm run lint` and `npm run format` commands exist and run

## Phase 2 - Database and Core Domain Rules

- [ ] Create `src/db/connection.js` with SQLite singleton connection
- [ ] Add `events` table schema with category CHECK constraint
- [ ] Add DB/application validation for recurring vs one-time invariants
- [ ] Ensure timestamps (`created_at`, `updated_at`) are set
- [ ] Add helper(s) for event payload normalization/validation

Exit criteria:
- [ ] Table is created automatically on startup
- [ ] Invalid event payloads are rejected with clear errors

## Phase 3 - Date and Query Logic

- [ ] Implement `src/utils/dateMath.js`
- [ ] Resolve aliases `today`, `tomorrow`, `next_week` in `Europe/Helsinki`
- [ ] Support explicit `YYYY-MM-DD` input and range validation
- [ ] Implement next-week range (Monday-Sunday of the week starting 7 days ahead)
- [ ] Implement recurring-event date-range matching with Dec-Jan wrap handling

Exit criteria:
- [ ] Utilities return correct ranges for aliases
- [ ] Year-boundary range behavior is validated by tests or manual checks

## Phase 4 - Security and Middleware

- [ ] Implement `src/middleware/apiKey.js` for `x-api-key` validation from `API_KEYS`
- [ ] Implement `src/middleware/auth.js` with session config and admin guard
- [ ] Hash `ADMIN_PASSWORD` in memory at boot and compare via bcrypt on login
- [ ] Add `csurf` for all admin state-changing routes
- [ ] Add `method-override` (`_method`) for admin update/delete form submissions

Exit criteria:
- [ ] Unauthorized API requests return `401`
- [ ] Protected admin routes redirect/deny without session
- [ ] CSRF token is required and validated on admin write actions

## Phase 5 - Admin Routes and Views

- [ ] Implement admin route module (`src/routes/admin.js`)
- [ ] Add login/logout handlers (`GET/POST /admin/login`, `POST /admin/logout`)
- [ ] Add dashboard list route (`GET /admin`)
- [ ] Add event CRUD routes and handlers:
  - [ ] `GET /admin/events/new`
  - [ ] `POST /admin/events`
  - [ ] `GET /admin/events/:id/edit`
  - [ ] `PUT /admin/events/:id`
  - [ ] `DELETE /admin/events/:id`
- [ ] Build EJS templates: layout, login, dashboard, event form
- [ ] Include CSRF token and `_method` fields in forms where needed

Exit criteria:
- [ ] Admin can log in, create/edit/delete events, and log out
- [ ] Validation errors render cleanly in forms

## Phase 6 - Public API and Public Page

- [ ] Implement `src/routes/public.js`
- [ ] Add `GET /` to render today's events page
- [ ] Add `GET /api/events` query handling:
  - [ ] Reject requests containing both `date` and `alias` with `400`
  - [ ] Support `alias` and explicit `date`
  - [ ] Support optional `category` filter
  - [ ] Query recurring and one-time events separately, then merge results
- [ ] Return response shape:
  - [ ] Single-day: `{ date, events }`
  - [ ] `next_week`: `{ startDate, endDate, events }`

Exit criteria:
- [ ] API returns correct status codes (`200`, `400`, `401`, `500`)
- [ ] API payload shape matches spec for both single-day and next-week

## Phase 7 - Error Handling and UX Polish

- [ ] Add 404 and 500 handlers
- [ ] Add minimal shared stylesheet or inline styles
- [ ] Ensure mobile-friendly layout for public and admin pages
- [ ] Verify escaping of user-provided text in templates

Exit criteria:
- [ ] Missing routes and internal errors show user-friendly pages
- [ ] Pages are readable on desktop and mobile

## Phase 8 - Testing and Documentation

- [ ] Add unit tests for `dateMath` alias resolution and boundary cases
- [ ] Add integration tests for:
  - [ ] API key enforcement
  - [ ] `date` + `alias` conflict (`400`)
  - [ ] `next_week` range payload
  - [ ] recurring vs one-time event matching
  - [ ] admin login and CRUD flow
- [ ] Add/refresh README with setup, env vars, run commands, and API examples

Exit criteria:
- [ ] `npm run lint` passes
- [ ] `npm run format` passes (or is clean after write)
- [ ] `npm test` passes
- [ ] README reflects final behavior and routes

## Final Verification Gate

- [ ] Valid API key + `GET /api/events?alias=today` returns expected events
- [ ] Invalid API key returns `401`
- [ ] `GET /api/events?date=2026-05-30&alias=today` returns `400`
- [ ] `GET /api/events?alias=next_week` returns `{ startDate, endDate, events }`
- [ ] Recurring event appears across years; one-time event appears only on exact date
- [ ] Admin session protects all `/admin/*` except login
- [ ] Create, update, and delete operations reflect immediately in API responses
