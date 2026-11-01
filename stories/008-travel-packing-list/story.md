# Travel Event Packing List

## Context

Travel events currently carry only a title, description, and date, so there is no way to record what must be taken along. Admins need to author a checklist per Travel event, and visitors need to consume it on the public page as a tickable list that keeps a visible record of what is already packed.

Packed state is stored server-side and shared by every visitor of the deployment (planning decision). The app has no user accounts (AGENTS.md "Admin is env-only", PRODUCT Non-Goal "Multi-user accounts"), the public page is server-rendered HTML with no JavaScript today, and the whole test suite is server-side HTTP (`tests/api.test.js` uses raw `http.request` + `node --test`, no DOM harness). Server-side state is therefore the only option whose full behavior — tick, untick, move-to-end, styling — is verifiable by automated tests.

## Out of Scope

- Packing items for categories other than Travel, and any UI/API surface for them.
- The JSON API: `GET /api/events` response shape and the Swagger `Event`/`EventInput` schemas stay byte-for-byte unchanged.
- Per-user or per-device packing state, multiple lists per event, item quantities, due dates, notes, sub-items, tags.
- Manual reordering of items (drag, up/down). Item order is creation order; packed items sort last.
- Auto-reset of packed state (e.g. when a recurring Travel event rolls into next year), "clear all packed", and packing progress counters such as "3/7 packed".
- Client-side-only state (localStorage/IndexedDB), PWA/offline behaviour, any build step or bundler.
- API-key protection for the new route — the packing toggle belongs to the public HTML surface, not `/api/*`.

## Implementation approach

Four pieces: a child table, an admin editor embedded in the existing event form, public rendering with packed-last ordering, and one public CSRF-protected toggle route. No new npm dependencies.

### 1. Child table `event_packing_items` (src/db/connection.js)

Follow the shared-DDL convention already used for `events` (`EVENTS_COLUMNS` → `EVENTS_TABLE_COLUMNS` / `EVENTS_COLUMN_NAMES`, `src/db/connection.js:22-38`). Add a parallel list and derive the DDL from it:

```js
const PACKING_ITEM_COLUMNS = [
  { name: 'id', def: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
  { name: 'event_id', def: 'INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE' },
  { name: 'label', def: 'TEXT NOT NULL' },
  { name: 'packed', def: 'INTEGER NOT NULL DEFAULT 0 CHECK (packed IN (0, 1))' },
  { name: 'created_at', def: "TEXT NOT NULL DEFAULT (datetime('now'))" },
  { name: 'updated_at', def: "TEXT NOT NULL DEFAULT (datetime('now'))" },
];
const PACKING_ITEM_TABLE_COLUMNS = PACKING_ITEM_COLUMNS.map((c) => `${c.name} ${c.def}`).join(
  ',\n  ',
);
```

`ensurePackingItemsTable(db)` creates the table and its lookup index idempotently, and is exported for tests:

```js
db.exec(`CREATE TABLE IF NOT EXISTS event_packing_items (${PACKING_ITEM_TABLE_COLUMNS})`);
db.exec('CREATE INDEX IF NOT EXISTS idx_packing_items_event ON event_packing_items(event_id)');
```

Call it at the end of `initDb()`, **after** `migrateCategoryConstraint(db)` (`src/db/connection.js:40-57`), because the FK target `events` must exist first. `PRAGMA foreign_keys = ON` is already set at `src/db/connection.js:49`, so `ON DELETE CASCADE` fires on `DELETE FROM events` — verified against the pinned `better-sqlite3` build (deleting a parent removed exactly its 3 child rows, leaving other events' children intact). Unlike story 007's rebuild-and-copy, this change is additive only: `CREATE TABLE IF NOT EXISTS` is the whole migration, no row copying and no `PRAGMA user_version` bookkeeping.

**Ordering is a single rule, applied in SQL, never in JS:**

- public page / toggle re-render: `ORDER BY packed ASC, id ASC` (unpacked first in creation order, packed last in creation order)
- admin edit form: `ORDER BY id ASC`

`packed ASC` puts packed items last. Tie-break on `id` (not pack time) is deliberate: `datetime('now')` has one-second resolution, so ordering by it would be nondeterministic for items packed in the same second and would make HTML-order assertions flaky.

### 2. Admin editor embedded in the existing event form (src/routes/admin.js, views/admin/eventForm.ejs)

No separate CRUD screens and no dynamic JS rows (none exist today). Items ride along in the one existing event form, keyed by two parallel arrays:

- existing item i: `<input type="hidden" name="packing_item_ids[]" value="<id>">` + `<input type="text" name="packing_items[]" maxlength="200" value="<label>">`
- 3 blank rows at the end with `packing_items[]` only (no id) → insert

Field names use the `[]` suffix because `express.urlencoded({ extended: true })` (`src/index.js:24`) turns repeated `name[]` into an array; a single submission arrives as a string, so every read goes through `[].concat(value || [])`.

Parsing rule (deterministic, one pass over `packing_items[]`):

```js
function parsePackingItems(body) {
  const labels = [].concat(body.packing_items || []);
  const ids = [].concat(body.packing_item_ids || []);
  const rows = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = String(labels[i] === undefined || labels[i] === null ? '' : labels[i]).trim();
    if (label === '') continue; // blank row: new row ignored, existing row falls out of the kept set = deleted
    const rawId = String(ids[i] === undefined ? '' : ids[i]).trim();
    rows.push({ id: /^[1-9]\d*$/.test(rawId) ? Number(rawId) : NaN, label });
  }
  return rows;
}
```

So: add = fill a blank row, edit = change the text, delete = clear the text (the id then never enters the kept set). The form shows a hint line stating this. The `[1-9]\d*` id pattern rejects `0` and leading zeros, so a junk id can never be silently treated as a new row; `AUTOINCREMENT` ids always start at 1.

Sync rule, applied only when the submitted `category === 'Travel'`, inside one `db.transaction()` together with the event INSERT/UPDATE (`POST /admin/events` at `src/routes/admin.js:247`, `PUT /admin/events/:id` at `:373`):

```js
for (const r of rows) {
  if (r.id)
    db.prepare(
      "UPDATE event_packing_items SET label = ?, updated_at = datetime('now') WHERE id = ? AND event_id = ?",
    ).run(r.label, r.id, eventId);
  else
    db.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      eventId,
      r.label,
    );
}
const kept = new Set(rows.filter((r) => r.id).map((r) => r.id));
for (const row of db
  .prepare('SELECT id FROM event_packing_items WHERE event_id = ?')
  .all(eventId)) {
  if (!kept.has(row.id)) db.prepare('DELETE FROM event_packing_items WHERE id = ?').run(row.id);
}
```

The `AND event_id = ?` clause is the cross-event tamper guard — verified: an UPDATE targeting another event's item id with this predicate reports `changes: 0`.

Validation is appended to the existing `errors` array (`validateEvent` at `src/routes/admin.js:429-455`), and the existing short-circuit (`errors.length > 0` → re-render with `event: req.body`, or `{ ...req.body, id: req.params.id }` on PUT) must run **before** the transaction opens, so a rejected item never leaves a half-written event. Messages:

- `rows.length > 50` → `A travel event can have at most 50 packing items`
- any `label.length > 200` → `Packing item labels must be 200 characters or fewer` (pushed once, however many offenders)
- any row where `Number.isNaN(row.id)` (never `row.id === NaN`, which is always false in JS), or a non-null `row.id` failing `SELECT 1 FROM event_packing_items WHERE id = ? AND event_id = ?`, or **any** submitted id on create (`POST /admin/events`, where no items exist yet) → `Unknown packing item`

Category coupling: when the submitted `category !== 'Travel'`, the item fields are ignored and existing rows are **left untouched** (hidden, not deleted — planning decision), so switching back to Travel restores them. Because the section must be able to appear/disappear without a round-trip, `eventForm.ejs` always renders the `.packing-fields` block and hides it with CSS (`display: none`, revealed by an `.active` class), mirroring the existing `.recurring-fields` / `.onetime-fields` toggle (`views/admin/eventForm.ejs:148-156`): add the category `change` listener to that same reveal logic, keyed on the selected value being `Travel`. The server-side gate above is the real enforcement; the CSS is presentation only.

`GET /admin/events/:id/edit` (`src/routes/admin.js:359-372`) additionally passes `packingItems` from `SELECT id, label FROM event_packing_items WHERE event_id = ? ORDER BY id ASC`.

### 3. Public rendering (src/routes/public.js, views/public/index.ejs, new views/partials/packing-list.ejs)

`queryEvents()` (`src/routes/public.js:218-306`) is private but shared verbatim by `GET /` and `GET /api/events`; do **not** touch it. Instead add a second, HTML-only step in the `GET /` handler (`src/routes/public.js:31-58`) that batch-attaches items to the already-sorted event list:

```js
function attachPackingItems(db, events) {
  for (const e of events) e.packingItems = [];
  if (events.length === 0) return events;
  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, event_id, label, packed FROM event_packing_items
       WHERE event_id IN (${placeholders}) ORDER BY packed ASC, id ASC`,
    )
    .all(...ids);
  const byEvent = new Map(events.map((e) => [e.id, e.packingItems]));
  for (const row of rows) {
    const bucket = byEvent.get(row.event_id);
    if (bucket) bucket.push(row);
  }
  return events;
}
```

One query regardless of event count (placeholders verified against the pinned SQLite), no N+1, and the SQL ordering already yields the packed-last order per event. Because the API route never calls it, the JSON objects keep their current keys (`id`, `title`, `description`, `category`, `displayDate`).

Inside the event-card loop (`views/public/index.ejs:146-157`) render a "Packing list" heading and:

```ejs
<%- include('../partials/packing-list', { items: event.packingItems, csrfToken, returnTo }) %>
```

`csrfToken` comes from `res.locals.csrfToken`, which `csrfProtection` sets (`src/middleware/csrf.js:12`). `returnTo` is a new render local computed in the `GET /` handler from the already-sanitized alias (`src/routes/public.js:34-37` guarantees one of the four known values): `alias === "today" ? "/" : "/?alias=" + alias` — exactly the string the redirect allowlist regex below accepts. EJS partials inherit the parent's locals, as `views/partials/logo.ejs` already relies on, but the new partial takes its data as an explicit include argument so it is self-contained and testable. EJS 6.0.1 supports `include(path, data)` and keeps auto-escaping, both verified in this environment: a label of `Passport <x>` renders as `Passport &lt;x&gt;`.

Render the section only when `event.category === 'Travel'` and `(event.packingItems || []).length > 0`, so a render path that never ran the attach step degrades to "no list" instead of throwing.

`views/partials/packing-list.ejs` — one `<form>` per item so a tick is a single request, with the hidden-default-plus-checkbox idiom:

```html
<li class="packing-item<%= it.packed ? ' packed' : '' %>">
  <form method="POST" action="/packing/items/<%= it.id %>/packed">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
    <input type="hidden" name="packed" value="0" />
    <label>
      <input type="checkbox" name="packed" value="1" <%= it.packed ? 'checked' : '' %> onchange="this.form.submit()" />
      <%= it.label %>
    </label>
    <input type="hidden" name="returnTo" value="<%= returnTo %>" />
    <button type="submit" class="packing-update">Update</button>
  </form>
</li>
```

Attribute order matters: the test helper `extractCsrf()` (`tests/api.test.js:50-53`) matches `name="_csrf"\s+value="([^"]+)"`. `onchange="this.form.submit()"` is progressive enhancement (consistent with the inline-JS convention in `eventForm.ejs`); the visible `Update` button keeps the control working with JS disabled, so no un-tickable dead end.

Styling, appended to the `<style>` block in `views/public/index.ejs` (inline-CSS convention, no framework). `#548466` and `#f2efe8` are values that view already uses; `#8a8f8c` is the one invented value — a faded grey picked to sit inside the view's muted palette (compare `#7a7470` in `views/error.ejs`), and it is fine to swap in a project grey if the implementer prefers. The button gets its own class rather than reusing `.btn`/`.btn-sm`, which live in other views' `<style>` blocks and are not guaranteed to exist in this one:

```css
.packing-heading {
  margin: 14px 0 4px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #548466;
}
.packing-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.packing-item {
  padding: 4px 0;
}
.packing-item form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.packing-item.packed label {
  color: #8a8f8c;
  text-decoration: line-through;
}
.packing-update {
  padding: 2px 8px;
  font-size: 0.75rem;
  border-radius: 8px;
  border: 1px solid #d9d3c8;
  background: #f2efe8;
  color: #548466;
}
```

Faded **and** struck-through: `color` alone would fail WCAG against the white card, and `line-through` alone is ambiguous, so both are applied to `.packing-item.packed label`. This is the "show it a bit differently" requirement, and the class name is asserted in tests.

### 4. Public toggle route (src/routes/public.js)

New route, no path collisions with the 12 currently registered routes:

```js
router.post('/packing/items/:id/packed', csrfProtection, handler);
```

`csrfProtection` is currently mounted only at `app.use('/admin', csrfProtection)` (`src/index.js:28`), so it is applied here as **route-level** middleware (same file, same module) rather than globally — that keeps anonymous session creation scoped to the two routes that need a token. `apiKeyGuard` (`src/middleware/apiKey.js:9-11`) returns `next()` for any path not starting with `/api/`, so this route stays key-free.

Handler contract, in order:

1. `const itemId = Number(req.params.id)`; if `!Number.isInteger(itemId) || itemId < 1` → `res.status(404).render('error', { message: 'Packing item not found' })` (the `message`-only local matches the four existing error call sites, e.g. `src/index.js:43`).
2. Resolve the target state from the hidden-default + checkbox pair:

   ```js
   function parsePacked(value) {
     const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
     if (values.some((v) => String(v) === '1')) return 1; // checked: "packed=0&packed=1" -> ["0","1"]
     if (values.length > 0 && values.every((v) => String(v) === '0')) return 0; // unchecked
     return null; // absent or junk -> 400
   }
   ```

   `null` → `res.status(400).render('error', { message: 'Invalid packed value' })`.

3. Resolve the redirect target by allowlist: `returnTo` is used verbatim only if it matches `/^\/(\?alias=(today|tomorrow|this_week|next_week))?$/`, otherwise `/`. Anything else (e.g. `//evil.example`, `/admin`) falls back to `/`, so the route is not an open redirect.
4. `const info = db.prepare("UPDATE event_packing_items SET packed = ?, updated_at = datetime('now') WHERE id = ?").run(target, itemId)`; `info.changes === 0` → 404 as in step 1.
5. `res.redirect(returnTo)` — plain redirect (302), matching the existing admin handlers (`src/routes/admin.js:247`, asserted today at `tests/api.test.js:368`).

Because the handler writes `req.session.csrfToken` on `GET /`, public home-page visitors now receive a `connect.sid` cookie: verified that `saveUninitialized: false` (`src/middleware/auth.js:11-20`) still persists a **modified** session. `SESSION_SECRET` already has a dev fallback (`src/middleware/auth.js:7-9`), and the integration suite sets it explicitly (`tests/api.test.js:177`), so no env changes are required.

## Tasks

### Task 1 - Create the packing-item table and pin its schema

- Fresh database (empty file) + `initDb()`
  - → `PRAGMA table_info(event_packing_items)` returns exactly `['id:INTEGER', 'event_id:INTEGER', 'label:TEXT', 'packed:INTEGER', 'created_at:TEXT', 'updated_at:TEXT']` (same `EXPECTED_COLUMN_TYPES` pattern as `tests/connection.test.js:38-53`)
  - → `sqlite_master` contains `idx_packing_items_event`
  - → inserting a row with `event_id` referencing an existing event succeeds with `packed = 0` by default
  - → inserting a row with `packed = 2` fails on the CHECK constraint
  - → inserting a row whose `event_id` matches no event fails on the FK (no `ON DELETE`/`IGNORE` softening; enforcement is per-connection, so open the fixture through `initDb({ file })` or issue `PRAGMA foreign_keys = ON` before asserting — this is how `tests/connection.test.js:94-95` already does it)
- Legacy database containing only the pre-feature `events` table plus 2 events + `ensurePackingItemsTable(db)`
  - → `event_packing_items` exists and is empty, both events preserved, no `*_new` tables left behind
- `ensurePackingItemsTable(db)` run twice in a row
  - → no error, row counts and schema unchanged (idempotent)
- Event with 2 packing items, on a connection with `foreign_keys = ON`, + `DELETE FROM events WHERE id = ?`
  - → both child rows are gone (cascade), children of other events untouched

### Task 2 - Admin item editor (add / rename / delete, limits, category gate)

- Admin session + `POST /admin/events` with `category=Travel` and two non-blank `packing_items[]` rows
  - → 302 to `/admin`
  - → `event_packing_items` holds exactly 2 rows for the new event with `packed = 0`, ids in submission order
- `POST /admin/events` with 3 `packing_items[]` rows where 2 are blank/whitespace-only
  - → event created with exactly 1 item; blank rows produce no rows and no error
- Admin edits a Travel event via `POST /admin/events/:id?_method=PUT` (method-override, `src/index.js:26`): rename one existing item, omit one existing item's row entirely, add one new label
  - → 302 to `/admin`
  - → renamed label persisted, omitted id deleted from the DB, new label inserted; item count is exactly as submitted
- `PUT` on a Travel event where an existing item's text is cleared to blank
  - → that item is deleted, remaining items keep their ids and order
- `PUT` where a `packing_item_ids[]` value belongs to a **different** event
  - → form re-renders (HTTP 200) containing `Unknown packing item`
  - → neither event's items changed (labels byte-identical, ids preserved)
- `POST /admin/events` where a `packing_item_ids[]` value is submitted on create
  - → form re-renders with `Unknown packing item`, no event and no items created
- Submit a label of 201 characters (Travel)
  - → form re-renders containing `Packing item labels must be 200 characters or fewer`
  - → on `PUT`, the event's own fields and its items are unchanged
- Submit 51 non-blank labels (Travel)
  - → form re-renders containing `A travel event can have at most 50 packing items`, no items created
- `PUT /admin/events/:id` changing `category` from `Travel` to `Other` on an event that has 3 items
  - → 302, event saved with `category = Other`
  - → all 3 item rows still present in the DB (hidden, not deleted)
- `GET /admin/events/:id/edit` for that `Other` event
  - → 200, and the packing block is present but not revealed: it carries `class="packing-fields"` with **no** `active` class (labels stay in the admin-only markup by design — see Notes)
  - → the category `<select>` marks `Other` as `selected`
- Re-submit the same event with `category=Travel` and its 3 ids
  - → 302, the 3 rows are preserved with their original ids (no delete/reinsert churn)

### Task 3 - Public page renders the list with packed items last and faded/struck-through

- Today's view (`GET /`) with a Travel event due today carrying items `A(id1, packed=0)`, `B(id2, packed=1)`, `C(id3, packed=0)`
  - → body contains a `packing-list` list and a "Packing list" heading inside that event's card
  - → label order in the HTML is `A`, then `C`, then `B` (unpacked first by id ascending; packed last) — assert with `indexOf` ordering
  - → the `B` `<li>` carries `class="packing-item packed"`, its checkbox has `checked`, and CSS rules for `.packing-item.packed label` set both `line-through` and a muted color
  - → each item form contains a hidden `_csrf` input in `name="_csrf" value="…"` attribute order and a `packed` checkbox
- Travel event with zero items, and a non-Travel event with items (seeded directly via `getDb()`)
  - → neither card contains a `packing-list` heading or markup
- Item label seeded as `Passport <script>x</script>`
  - → body contains the escaped `&lt;script&gt;` form and no raw `<script>x</script>` from the label
- `GET /api/events?alias=today` for the same Travel event
  - → 200 and the event object's keys are exactly the pre-feature set (`id`, `title`, `description`, `category`, `displayDate`); no `packingItems`/`packed` key appears anywhere in the payload
- `GET /?alias=next_week` where a Travel event falls in that range
  - → its items render too, and the forms' `returnTo` hidden value is `/?alias=next_week`

### Task 4 - Public tick / untick route (CSRF-protected, shared state)

- `GET /` with no cookies
  - → `Set-Cookie` includes `connect.sid`, and the packing form contains an extractable `_csrf` token
- `POST /packing/items/:id/packed` with that cookie, `_csrf`, body `packed=0&packed=1`
  - → 302 with `location: /`
  - → DB row now has `packed = 1`
  - → the next `GET /` renders that label last, with `class="packing-item packed"` and `checked`
- `POST /packing/items/:id/packed` with the same cookie, `_csrf`, body `packed=0` on a packed item
  - → 302, `packed = 0`
  - → next `GET /` renders it back in id order among the unpacked items, with no ` packed` class and no `checked`
- `POST` to the same route with no cookie, and `POST` with a valid cookie but a wrong `_csrf`
  - → 403 (`Invalid CSRF token`)
  - → DB row unchanged in both cases
- `POST /packing/items/999999/packed` with valid cookie + token, and `POST` with a non-numeric `:id`
  - → 404, error page rendered
- `POST` with valid cookie + token and no `packed` field at all (or `packed=` / `packed=maybe`)
  - → 400, DB row unchanged
- `POST` with `returnTo=/?alias=next_week`, and `POST` with `returnTo=//evil.example`
  - → 302 `location: /?alias=next_week` in the first case; 302 `location: /` in the second
- Two visitors (two cookie jars) POST the same item in sequence
  - → second write wins and both subsequent `GET /` renderings agree (shared state, documented)

### Task 5 - Update project documentation (inspection-only)

These are documentation outcomes, verified by reading the files, not by an automated test — see Notes.

- `README.md` route table (`README.md:65-75`)
  - → gains `POST /packing/items/:id/packed` with a "public, CSRF-protected" description
- `AGENTS.md`
  - → "Database Schema" section gains the `event_packing_items` table and its invariant (`packed` ∈ {0,1}, `ON DELETE CASCADE` from `events`)
  - → "Admin Routes & Auth" / "API Behavior" gain the public toggle route and note that `csrfProtection` is now also applied to `GET /` and that route
  - → "Gotchas" gains: public home page now sets `connect.sid` for anonymous visitors; packing order is `ORDER BY packed ASC, id ASC` in SQL, never re-sorted in JS
- `docs/product.md` Features list and Known Limitations (already updated by this planning step — verify, do not duplicate)
- After editing, `npx prettier --check "docs/product.md" "stories/008-travel-packing-list/story.md"` passes; `README.md` and `AGENTS.md` are **not** prettier-clean today and the `format`/`format:check` scripts only cover `src/**/*.js` (`package.json:8-11`), so match their local style instead of reformatting them

## Technical Context

- No new dependencies. Installed and pinned today: `express@5.2.1`, `express-session@1.19.0`, `better-sqlite3@12.10.0` (bundled SQLite 3.53.1), `ejs@6.0.1`, `cookie-parser@1.4.7`, `method-override@3.0.0`, `dotenv@17.4.2`; dev formatter/linter `prettier` + `eslint` per `package.json:8-17`. Runtime here is Node 26.12.1 (AGENTS.md floor is Node 20+).
- No new environment variables. `SESSION_SECRET` is not in the AGENTS.md table but is already required at runtime and defaulted in `src/middleware/auth.js:7-9`; the integration suite sets it (`tests/api.test.js:177`).
- Behaviors verified against this environment rather than assumed: writing `req.session.x` on a public `GET` with `saveUninitialized: false` **does** emit `Set-Cookie: connect.sid=…` and a later `POST` carrying that cookie sees the token; `ON DELETE CASCADE` fires only because `PRAGMA foreign_keys = ON` is set at `src/db/connection.js:49`; `UPDATE … WHERE id = ? AND event_id = ?` returns `changes: 0` for another event's item; `WHERE event_id IN (?, ?)` batching works; `ejs@6` `include(path, data)` works and escapes `<`.
- `better-sqlite3` is synchronous: `prepare().run()/.get()/.all()` and `db.transaction(() => { … })()` with no `async`/`await` (AGENTS.md).
- `queryEvents()` in `src/routes/public.js:218-306` is the shared HTML/API seam — the packing attach step must live in the `GET /` handler only.
- Test harness: `node --test tests/**/*.test.js`; `tests/api.test.js` boots the app with `DB_FILE=data/test-api.db`, `PORT=9999` and reuses `request()`, `parseCookies()`, `extractCsrf()`, `loginAsAdmin()` helpers (`tests/api.test.js:12-76`). A new cookie jar for the two-visitor test must reuse `parseCookies()` on a fresh `GET /`.
- Swagger is intentionally untouched: `src/config/swagger.js:143-172` and the `@swagger` blocks at `src/routes/public.js:12-30` and `:98-129` document only the JSON surface, which does not change.
- `PUT`/`DELETE` are reached in tests via `method-override('_method')` (`src/index.js:26`), i.e. `POST /admin/events/:id?_method=PUT` with the form body — the same trick `views/admin/dashboard.ejs:225-227` uses for delete.
- Any test that seeds events for `today` / `next_week` must compute month/day in `Europe/Helsinki` via `new Date().toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })`, not bare `new Date()` — the server resolves aliases in that zone (AGENTS.md gotcha, already followed in `tests/api.test.js`).

## Notes

- Packed state is global to the deployment: there are no accounts, so any visitor's tick is visible to everyone, and concurrent writes are last-write-wins (no optimistic locking). This was chosen deliberately over per-session state, which would be wiped by the default in-memory session store on restart.
- Packed state never auto-resets. A recurring Travel event keeps its ticked items across a year boundary, and an event whose items were all packed stays packed until someone unticks or edits it. Explicitly out of scope, so flag it if the UX team wants a reset.
- Deleting an item is done by clearing its label — a surprising gesture if undocumented, so the admin form must render a visible hint sentence, and the re-render-on-error path must keep the ids aligned so a validation failure never silently deletes items.
- Item labels are plain text rendered through EJS auto-escaping; never interpolate them into SQL string literals (parameters only) and never disable escaping.
- The `packing_items[]` / `packing_item_ids[]` arrays are only index-aligned because every existing row submits both fields in DOM order while the 3 blank rows submit no id, and nothing in the UI reorders rows. If anyone later adds row add/remove JavaScript, switch to paired names (e.g. `packing_items[<n>][id]` and `packing_items[<n>][label]`) rather than relying on parallel-array indices.
- The `Update` submit button is a no-JS fallback, not decoration: without it, a JS-disabled visitor cannot untick anything.
- Adding `csrfProtection` to `GET /` means the public page now stores a session for anonymous visitors; existing tests that assert on `/` responses (e.g. the logo assertions at `tests/api.test.js:530`) must keep passing — a new `Set-Cookie` header is expected, not a regression.
- On the admin edit page a non-Travel event's existing item inputs remain in the HTML inside the hidden `.packing-fields` block. That page is admin-only (`ensureAdmin`), and keeping the markup lets the category `<select>` reveal the list without a save round-trip; the real guarantee that a non-Travel event's items are never written or synced is the server-side category gate, not the CSS.
- `attachPackingItems` binds one placeholder per visible event. That is far below SQLite's bound-parameter limit for a day's or week's worth of events, but if a future change ever widens the visible set dramatically, chunk the `IN` list rather than building one huge statement.
- Task 5 is documentation only, verified by reading the files. The same applies to the user's "whatever looks good": the automated tests pin the observable structure (the `packed` class, packed-last HTML order, and a CSS rule combining `line-through` with a muted color), while the aesthetic judgement itself is a human review.
- Verify with the project's order: `npm run lint && npm run format && npm test`.
