# Health Check API

## Context

There is no health endpoint today, so infrastructure (load balancers, container orchestrators, uptime monitors) has no way to confirm the service is reachable and its only external dependency — the SQLite database — is responsive. A readiness probe lets probes distinguish a live-but-broken process from a healthy one, enabling automatic restart/recovery on DB failure. This is now needed because the app is being deployed behind a probe-capable layer.

## Out of Scope

- A separate liveness endpoint (process-only check). The single readiness check covers the only external dependency.
- Authentication or API-key gating of the health endpoint. Probes must reach it without credentials.
- A `/api/health` path variant. The endpoint lives at `/health` outside the `/api/*` namespace.
- A `version` field or any build/commit metadata in the response body.

## Implementation approach

Add a single unauthenticated `GET /health` readiness endpoint that verifies the SQLite database is reachable by executing `SELECT 1` via the existing `better-sqlite3` sync API, then returns a strictly minimal JSON body.

### Routing & middleware interaction

The endpoint is added to `src/routes/public.js` (the existing public router mounted at `/`) so it inherits the same wiring as the homepage and `/api/events`. The route is registered **before** the `/api/events` route to keep related unauthenticated GETs grouped, though order is not functionally significant because Express matches on full path.

Middleware behavior, verified against `src/index.js` and `src/middleware/*.js`:
- `apiKeyGuard` short-circuits with `next()` for any path that does not start with `/api/`, so `/health` is naturally unauthenticated — no change to `apiKey.js`.
- `csrfProtection` is mounted only at `/admin`, so `/health` is unaffected — no change to `csrf.js`.
- `sessionMiddleware` applies app-wide but only acts on session-bearing requests; a stateless GET is fine.

### DB check

Use the existing `getDb()` singleton from `src/db/connection.js` (initialized at boot by `initDb()` in `src/index.js`, so it is guaranteed to be set when requests arrive). Execute `db.prepare('SELECT 1').get()` — synchronous, no async/await, per the project's better-sqlite3 convention. Wrap in try/catch:

- Success → `200` with `{ "status": "ok" }`.
- Throw (e.g. DB closed, locked, or corrupted) → `503` with `{ "status": "error" }`. The thrown message is **not** echoed to avoid leaking internal details from a public, unauthenticated endpoint.

### Response shape (strictly minimal)

- Happy path: HTTP `200`, `Content-Type: application/json`, body `{"status":"ok"}`.
- Failure path: HTTP `503`, `Content-Type: application/json`, body `{"status":"error"}`.
- No `timestamp`, no `version`, no `db` field, no error text.

### Swagger documentation

Add an inline `@swagger` JSDoc block above the route handler in `src/routes/public.js`, matching the existing convention used by `/` and `/api/events`. The `swaggerJsdoc` config in `src/config/swagger.js` already scans `./src/routes/*.js`, so no config change is needed. Tag it under a new `Health` tag (distinct from `Public` and `Public API`) and document both the 200 and 503 responses. No `security` block — the endpoint is unauthenticated.

### Test placement

Two distinct test locations in `tests/api.test.js`:

1. **HTTP behavior (Task 1)** — add a new `describe('Health check', ...)` block as the **last** subdescribe inside the existing `describe('API integration', ...)` so it reuses the already-booted test server on port 3099 (env vars `API_KEYS`, `ADMIN_*` are set in its `before` hook). Do not spin up a separate server. Use the existing `request()` helper. Placing it last ensures the DB-close test cannot disrupt earlier DB-dependent tests.

   The DB-unreachable test closes the process-wide DB singleton and must restore it even if an assertion throws, otherwise every later test that touches the DB will fail. Wrap the request + assertions in `try { ... } finally { initDb(); }` (import `initDb` from `src/db/connection.js`). `initDb()` reassigns the module-scoped `db` to a fresh `Database` on the same file path; its `CREATE TABLE IF NOT EXISTS` and migration check are idempotent, so re-initialization is safe. Because the test imports `getDb`/`initDb` from the same module the server uses, the close is visible to the server's handler and the reopen is visible to subsequent requests.

2. **Swagger spec (Task 2)** — add assertions to the **existing** top-level `describe('Swagger spec', ...)` block, which already reloads the spec via `delete require.cache[require.resolve('../src/config/swagger')]` in its `before` hook. Do not add a second reload; reuse that block's `swaggerSpec` variable.

## Tasks

### Task 1 - Unauthenticated readiness endpoint

- no precondition + `GET /health` request (no API key, no session, no headers)
  - → HTTP `200`
  - → `Content-Type` contains `application/json`
  - → body parses as JSON and equals `{"status":"ok"}`
  - → response contains no `timestamp`, `version`, `db`, or `error` keys
- DB unreachable (simulate by closing the DB singleton before the request) + `GET /health`
  - → HTTP `503`
  - → `Content-Type` contains `application/json`
  - → body parses as JSON and equals `{"status":"error"}`
  - → response contains no `timestamp`, `version`, `db`, or `error` keys
- existing public endpoints unaffected + `GET /health` added
  - → `GET /` still returns `200` HTML
  - → `GET /api/events?alias=today` still returns `401` without an API key (regression guard)

### Task 2 - Swagger documentation

- swagger spec generated from JSDoc + inspect `swaggerSpec.paths['/health'].get`
  - → path item exists
  - → tagged `Health`
  - → no `security` block present (unauthenticated)
  - → documents a `200` response with `application/json`
  - → documents a `503` response with `application/json`

## Bootstrap

This feature adds no new app, service, or package and introduces no new dependencies — Express and better-sqlite3 are already in `package.json`. To reach a working dev environment with tests passing:

```bash
cp .env.example .env   # then fill in ADMIN_USERNAME, ADMIN_PASSWORD, API_KEYS, PORT, NODE_ENV
npm install
npm run lint && npm run format && npm test
```

## Technical Context

No new packages are introduced. Relevant existing dependencies (from `package.json`, already pinned):
- `express` `^5.2.1` — router and `res.json()`.
- `better-sqlite3` `^12.10.0` — synchronous `db.prepare('SELECT 1').get()` for the readiness probe.

`getDb()` is guaranteed non-null for inbound requests because `initDb()` runs synchronously at module load in `src/index.js` before `app.listen()`. The test simulating DB failure calls `getDb().close()` before the request and re-opens it via `initDb()` in a `finally` block so a failing assertion cannot leave the process-wide DB closed for later tests (see Test placement).

## Notes

- The endpoint is intentionally unauthenticated and returns no internal error text on failure, so a public-facing probe does not leak DB error messages.
- `SELECT 1` is the canonical SQLite liveness probe; it confirms the connection handle is usable without depending on table state. It does not verify the `events` schema — that is covered by the boot-time `initDb()` migration logic, not by the health check.
- A failure (`503`) is not expected during normal operation because better-sqlite3 is in-process; it primarily signals a closed/corrupted DB handle, which warrants an automated process restart.
- Keep the handler synchronous and avoid async/await around the DB call, per the project's better-sqlite3 convention in `AGENTS.md`.
