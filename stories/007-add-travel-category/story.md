# Add "Travel" Event Category

## Context

Admins cannot file trips, commutes, or holiday travels under any existing category (Birthday, Name Day, Flag Day, Holiday, Anniversary, Other) without mislabeling them. Adding a "Travel" category lets admins record travel events with a meaningful label. This also fixes a latent drift problem: the DB `CHECK` constraint hardcodes the category list, duplicating `VALID_CATEGORIES` in `src/config/categories.js` (AGENTS.md flags this as a known gotcha). Per planning decision, the CHECK clause will be derived from `VALID_CATEGORIES` so future category changes never require DDL edits.

## Out of Scope

- Custom/free-text categories — "Travel" is a single new fixed enum value, not an open text field.
- Changes to recurring/one-time event logic or date handling.
- Category-specific UI styling or badges (all categories render identically today).
- Renaming or removing existing categories.

## Implementation Approach

The category list is enforced in three layers: the shared `VALID_CATEGORIES` array (`src/config/categories.js:1`), the SQLite `CHECK` constraint in `EVENTS_TABLE_COLUMNS` (`src/db/connection.js:14-27`), and static Swagger JSDoc enums. Validation and views already consume `VALID_CATEGORIES` via imports, so they need no code change.

**1. Shared list.** Append `'Travel'` as the last entry in `VALID_CATEGORIES`:

```js
['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other', 'Travel'];
```

Appending last keeps existing sort/filter behavior unchanged (same pattern story 003 used for "Other").

**2. Derive the CHECK clause from `VALID_CATEGORIES`.** In `src/db/connection.js`, require `VALID_CATEGORIES` and build the constraint via a template literal so `CREATE TABLE` in `initDb()` and the migration's `events_new` DDL both come from the same derived string (shared-DDL rule from AGENTS.md):

```js
const CATEGORY_CHECK = `category IN (${VALID_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;
```

`EVENTS_TABLE_COLUMNS` then uses `CHECK (${CATEGORY_CHECK})`. Constraint predicate: every entry in `VALID_CATEGORIES` must be a label safe for single-quote SQL interpolation (no embedded `'` characters) — all current labels satisfy this, and it is a compile-time constant, not user input.

**3. Generalize migration detection.** `migrateCategoryConstraint()` (`src/db/connection.js:42-61`) currently skips when `row.sql.includes("'Other'")`. That predicate is wrong once the list grows: a DB migrated for "Other" but missing "Travel" would be silently skipped. Replace the skip check with a predicate over the shared list:

```js
if (VALID_CATEGORIES.every((c) => row.sql.includes(`'${c}'`))) return;
```

- Skip iff the stored `sqlite_master` SQL contains every quoted category from `VALID_CATEGORIES`.
- Otherwise run the existing rebuild-and-copy sequence (`CREATE TABLE events_new` → `INSERT INTO events_new SELECT * FROM events` → `DROP TABLE events` → `ALTER TABLE events_new RENAME TO events`) inside `db.transaction(() => { ... })()`.

This is idempotent and forward-compatible: any DB missing any current category (including very old pre-"Other" schemas) is rebuilt once to the derived schema. The rebuild is case-sensitive and quote-anchored, so a lowercase stored `'travel'` elsewhere in the schema SQL would not falsely satisfy the check.

**4. Swagger enums are static JSDoc text** in `src/routes/public.js:124` and `src/routes/admin.js:23,57,59` — they cannot be derived at runtime and must be hand-updated to include `Travel`.

No new npm dependencies are required.

## Tasks

### Task 1 - Add "Travel" to the shared category list

- `src/config/categories.js` contains `VALID_CATEGORIES` + `'Travel'` appended last
  - → module exports `['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other', 'Travel']`
- App serving `/admin/events/new` with updated config
  - → event form category `<select>` contains a `Travel` option as the last entry (view is already driven by the route-passed `categories` array — no `eventForm.ejs` change)
- Admin dashboard category filter dropdown rendered
  - → `Travel` appears as a filter option (already driven by `categories` array — no `dashboard.ejs` change)

### Task 2 - Derive CHECK constraint from VALID_CATEGORIES

- `src/db/connection.js` + module loaded
  - → `EVENTS_TABLE_COLUMNS` embeds a CHECK clause generated from `VALID_CATEGORIES` (no hardcoded category list remains in `connection.js`)
- Fresh database (no `events` table) + `initDb()`
  - → created `events` table schema SQL contains `'Travel'` and all other categories in its CHECK
  - → inserting an event with `category = 'Travel'` succeeds
  - → inserting an event with `category = 'Vacation'` fails with a constraint error

### Task 3 - Generalize category migration detection

- Existing `events` table whose CHECK includes `'Other'` but not `'Travel'` + `migrateCategoryConstraint(db)`
  - → migration runs: `events_new` created from derived DDL, all rows copied, old table dropped and renamed inside one transaction
  - → all pre-existing rows preserved with identical column values
  - → stored `sqlite_master` SQL now includes `'Travel'`
  - → inserting `category = 'Travel'` succeeds after migration
- Database whose CHECK already includes all seven categories + `migrateCategoryConstraint(db)`
  - → no new tables created, row count unchanged (idempotent skip)
- Pre-"Other" database (CHECK missing both `'Other'` and `'Travel'`) + `migrateCategoryConstraint(db)`
  - → single rebuild produces schema containing both `'Other'` and `'Travel'`
  - → all rows preserved
- Update the existing idempotency test fixture in `tests/connection.test.js`: the "already migrated" fixture schema must include `'Travel'`, otherwise the new `every(...)` predicate correctly treats it as unmigrated and the test premise breaks

### Task 4 - Update Swagger API documentation

- Swagger spec generated for `GET /api/events` `category` query parameter
  - → enum includes `Travel`
- Swagger spec generated for `Event` and `EventInput` schemas (admin route annotations)
  - → `category` enum includes `Travel`

### Task 5 - Add integration tests for the "Travel" category

Following the `describe('Other category', ...)` block pattern in `tests/api.test.js:279-386`:

- admin creates a recurring event with `category=Travel` via POST `/admin/events` (valid session + CSRF token)
  - → 302 redirect to dashboard
  - → event visible on dashboard with category "Travel"
- API query `GET /api/events?category=Travel`
  - → 200, every returned event has `category === "Travel"`
- API query with invalid category `GET /api/events?category=Foo`
  - → 400, error message lists all valid categories including "Travel"
- API query `GET /api/events?alias=today` with a "Travel" event due today
  - → response includes the "Travel" event alongside other categories
- Swagger spec loaded via the existing direct-module pattern (`require('../src/config/swagger')` after clearing its `require.cache`, as at `tests/api.test.js:78-82`)
  - → `category` enum contains `Travel`, asserted alongside the existing "Other" enum test at `tests/api.test.js:84-106`

## Technical Context

- No new dependencies — everything needed (`better-sqlite3`, `express`, `swagger-jsdoc`, built-in `node --test`) is already installed.
- `migrateCategoryConstraint` is exported from `src/db/connection.js` and called at the end of `initDb()`; tests call it directly on a file-backed DB in `data/`.
- Migration detection reads the stored DDL from `sqlite_master` (`SELECT sql FROM sqlite_master WHERE type='table' AND name='events'`), so the skip check must match the exact quoting style of the generated DDL (single quotes around each category).
- Swagger enums live inside `@swagger` JSDoc comment blocks in the route files — they are plain text evaluated by `swagger-jsdoc` at spec-build time, so they do not update automatically from `VALID_CATEGORIES`.
- Test runner: `node --test tests/**/*.test.js` (no external framework). `tests/api.test.js` boots the full app with env vars `PORT`, `API_KEYS`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV`, `LOGO_LINK_URL` (see its `before` hook at `tests/api.test.js:128-136`).

## Notes

- `better-sqlite3` is synchronous — no `async/await` around DB calls (AGENTS.md convention).
- If anyone later adds a category containing an apostrophe (e.g. "Val's Day"), the `CATEGORY_CHECK` template must escape it (`'` → `''`) before interpolation; note this as a maintenance constraint.
- The pre-existing tests in `tests/connection.test.js` that assert migration behavior use hardcoded old-schema fixtures; they keep working because fixtures missing `'Other'` also miss `'Travel'` and still trigger the rebuild — only the idempotency fixture needs the update called out in Task 3.
- Verify with the project order: `npm run lint && npm run format && npm test`.
