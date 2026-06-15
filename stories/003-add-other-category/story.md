# Add "Other" Event Category

## Context

The app currently restricts event categories to five predefined values: Birthday, Name Day, Flag Day, Holiday, and Anniversary. Users sometimes have events that don't fit any of these (e.g., "Graduation", "Reminder", "Club Meeting"). Adding an "Other" category lets admins capture any event without forcing a mismatch.

## Out of Scope

- Custom/free-text categories — "Other" is a single new fixed enum value, not an open text field.
- Changes to the recurring/one-time event logic or date handling.
- Category-specific UI styling or badges (all categories render identically today).

## Implementation Approach

The category list is enforced in seven places. Every one must be updated consistently; otherwise inserts will fail at the DB level or validation will reject valid API requests.

**Database migration strategy.** SQLite does not support `ALTER TABLE … ALTER CONSTRAINT`. The CHECK constraint must be replaced by the standard rebuild pattern:

1. `CREATE TABLE events_new` with `'Other'` added to the `CHECK(category IN (…))` list.
2. `INSERT INTO events_new SELECT * FROM events;`
3. `DROP TABLE events;`
4. `ALTER TABLE events_new RENAME TO events;`

This runs inside `initDb()` only when the existing schema's CHECK constraint does not include `'Other'`. Detection: query `pragma table_info(events)` and compare, or attempt a test insert and catch the constraint error. The simpler approach is to check `sqlite_master` SQL for the string `'Other'` in the CHECK clause — if absent, run the migration.

**Single source of truth.** Both `src/routes/admin.js` and `src/routes/public.js` define their own `VALID_CATEGORIES` array. After this change, extract the array to a shared module (e.g. `src/config/categories.js`) so it is defined once and imported by both routes, the migration logic, and the event form view.

**Category order.** "Other" is appended last in the array: `['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other']`. This keeps existing sort/filter behavior unchanged.

## Tasks

### Task 1 - Extract shared category list

- `src/config/categories.js` does not exist + module created
  - → module exports `VALID_CATEGORIES = ['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other']`
- `src/routes/admin.js` imports from `../config/categories`
  - → removes local `VALID_CATEGORIES` constant
  - → all existing admin route tests still pass
- `src/routes/public.js` imports from `../config/categories`
  - → removes local `VALID_CATEGORIES` constant
  - → all existing public route tests still pass

### Task 2 - Database schema migration

- existing `events` table with old CHECK (no `'Other'`) + app boots
  - → `initDb()` detects missing `'Other'` in CHECK via `sqlite_master` query
  - → migration runs: creates `events_new`, copies rows, drops `events`, renames `events_new`
  - → all existing rows preserved
- fresh database (no `events` table) + app boots
  - → `CREATE TABLE IF NOT EXISTS events` includes `'Other'` in CHECK
  - → no migration runs
- database already migrated (CHECK includes `'Other'`) + app boots
  - → migration is skipped (idempotent)

### Task 3 - Update EJS views and route data

The event form view currently hardcodes the category list in the EJS template (line 188). To use the shared `VALID_CATEGORIES` array, the admin routes must pass `categories` to the `eventForm` view (they already pass it to `dashboard`).

- `src/routes/admin.js` renders `admin/eventForm` (4 call sites: new GET, create POST with errors, edit GET, update POST with errors)
  - → each `res.render('admin/eventForm', …)` call includes `categories: VALID_CATEGORIES`
- `views/admin/eventForm.ejs` category `<select>` rendered
  - → replaces hardcoded `['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'].forEach` with `<% categories.forEach(function(cat) { %>`
  - → "Other" option appears as the last entry in the dropdown
- `views/admin/dashboard.ejs` category filter dropdown rendered
  - → "Other" appears as a filter option (already driven by `categories` array passed from route, no view change needed)
- `views/public/index.ejs` event card rendered with category "Other"
  - → `<span class="category">Other</span>` displayed (no view change needed, already renders `event.category`)

### Task 4 - Update Swagger API documentation

- Swagger spec generated for `GET /api/events` `category` parameter
  - → enum includes `Other`
- Swagger spec generated for `Event` and `EventInput` schemas
  - → `category` enum includes `Other`

### Task 5 - Add integration tests for "Other" category

- admin creates event with category "Other" (recurring) via POST `/admin/events`
  - → event saved successfully, redirect to dashboard
  - → event visible on dashboard with category "Other"
- API query `GET /api/events?category=Other` with valid API key
  - → returns 200 with only "Other" events
- API query with invalid category `GET /api/events?category=Foo`
  - → returns 400 with error message listing all valid categories including "Other"
- API query `GET /api/events?alias=today` returns "Other" events alongside other categories
  - → response includes "Other" events with correct `category` field

## Notes

- The migration must not lose data. The rebuild-and-copy approach is standard for SQLite constraint changes and is safe for the small data volumes expected.
- No new npm dependencies are required.
- The `views/admin/dashboard.ejs` already renders the category filter from the `categories` array passed by the route, so no view change is needed there.
