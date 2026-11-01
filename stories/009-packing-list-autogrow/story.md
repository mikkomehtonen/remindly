# Packing List Auto-Grow in Admin Event Form

## Context

The admin event form pre-renders exactly 3 blank packing-item rows (`views/admin/eventForm.ejs:278`). Authoring a Travel event with more than 3 packing items forces a save round-trip: submit, find the event on the dashboard, open the edit form again. The admin should be able to keep typing and have a fresh empty row appear automatically, so a list of any size (up to the existing server cap of 50) is authored in one pass.

## Out of Scope

- Reordering packing rows (drag-and-drop or move buttons).
- Explicit remove buttons — removal stays "clear the text", the hint copy is unchanged.
- Any change to the public page, packing toggle route, or JSON API.
- Any change to server-side sync, CSRF, or the 50-item / 200-char validation rules.
- Raising the 50-item cap.
- A static-asset pipeline or JS bundler — the script stays inline in the view, matching the existing pattern.

## Implementation approach

Client-only change in the existing inline `<script>` block of `views/admin/eventForm.ejs` (lines 169–182, which already defines `toggleEventType` / `togglePackingFields` and a `window.onload` handler at line 181). No server changes: blank rows are already dropped by `parsePackingItems` (`src/routes/admin.js:519-533`, skips labels whose `trim()` is `''`), new rows insert because they carry no hidden `packing_item_ids[]`, and `validatePackingItems` already rejects >50 items (`src/routes/admin.js:547-579`).

Add a named function `initPackingAutogrow()`, invoked from the existing `window.onload` handler. The function attaches **one delegated `input` listener** on the `.packing-fields` container (the script sits above the form markup, so it must run after load). Exact rule per input event:

1. Ignore events whose target is not `input[name="packing_items[]"]` (hidden id inputs never match).
2. `rows = container.querySelectorAll('.packing-row')`; if `rows.length >= 50` → return (client-side mirror of the server cap).
3. If the **last** `.packing-row`'s text input has `value.trim() === ''` → return (a blank trailing row already exists; whitespace-only counts as empty, matching the server's trim rule).
4. Otherwise append one new row at the end of the container, built with `createElement` (never `cloneNode` of an existing row, which could carry a value or a hidden id):

   ```html
   <div class="packing-row">
     <input
       type="text"
       name="packing_items[]"
       maxlength="200"
       placeholder="Add a new packing item"
     />
   </div>
   ```

Invariants this produces: at most one trailing empty row at all times; the list grows by exactly one row per filled row (filling any non-last blank row is a no-op because the last row is still empty); the single delegated listener covers appended rows without rebinding; the hidden `.packing-fields` block (non-Travel events) is unaffected.

Testing: a new jsdom-based unit test renders the real `eventForm.ejs` and drives real `input` events; integration tests in `tests/api.test.js` prove the server already round-trips arbitrary row counts.

## Tasks

### Task 1 - Auto-grow behavior in the event form script

New test file `tests/packingAutogrow.test.js` (jsdom unit tests against the rendered `views/admin/eventForm.ejs`).

- rendered new-event form (`event: null`, `packingItems: []`) + type first non-empty character into the last of the 3 blank rows and dispatch `input`
  - → the count of inputs named `packing_items[]` inside `.packing-fields` becomes 4
  - → the 4th row is a `div.packing-row` appended after the previous last row, containing exactly one text input with `name="packing_items[]"`, empty `value`, `maxlength="200"`, placeholder `Add a new packing item`
  - → the new row contains **no** input named `packing_item_ids[]`
- form + set a value and dispatch `input` on each successive last row, three times in a row
  - → row counts go 3 → 4 → 5 → 6 (exactly one append per fill, no over-growth)
- form + set text in a blank row that is **not** the last row (last row still empty) and dispatch `input`
  - → row count is unchanged (no append)
- form + set the last row's value to `''` and dispatch `input`
  - → row count is unchanged
- form + set the last row's value to `"   "` (whitespace only) and dispatch `input`
  - → row count is unchanged (trimmed-empty counts as empty)
- rendered edit-style form with 47 saved `packingItems` (with ids) + the 3 blank rows, then type into the last blank row
  - → row count stays at 50 (auto-append stops at the server cap of 50)

### Task 2 - Server round-trips any number of submitted rows

Extend `tests/api.test.js` using the existing `createTravelEvent` / `putTravelEvent` / `loginAsAdmin` / `itemsOf` / `eventIdByTitle` helpers.

- `createTravelEvent` with 6 non-empty `packing_items[]` values
  - → response 302 with `location: /admin`
  - → DB holds exactly 6 items in submission order, all with `packed = 0`
- `createTravelEvent` with `packing_items[]` values `['A', '', 'B', '   ']`
  - → DB holds exactly 2 items with labels `A` and `B` (blank/whitespace rows dropped)
- `putTravelEvent` on an event that has 2 items, submitting those 2 ids plus 5 non-empty labels and 3 empty `packing_items[]` entries
  - → DB holds exactly 5 items; the 2 updated items keep their original ids

### Task 3 - Served pages ship the auto-grow script

- as admin, `GET /admin/events/new`
  - → HTML contains the string `initPackingAutogrow` (the named function marker inside the inline script)
  - → HTML still contains exactly 3 blank `packing_items[]` rows (initial render unchanged; regression guard)
- as admin, `GET /admin/events/:id/edit` for a Travel event with saved items
  - → HTML contains `initPackingAutogrow`
  - → HTML contains each saved item's label as an input `value` and its hidden `packing_item_ids[]` input

## Bootstrap

No new app or scaffolding — existing repo, one new dev dependency:

```bash
npm install --save-dev jsdom@29.1.1
npm run lint && npm run format && npm test
```

## Technical Context

- **jsdom 29.1.1** — devDependency for DOM simulation in tests; engines `^20.19.0 || ^22.13.0 || >=24.0.0`. Deliberately **not** the latest jsdom 30.1.3, whose engines (`^22.22.2 || ^24.15.0 || >=26.0.0`) drop Node 20, which AGENTS.md documents as the runtime floor. 29.1.1 has no API impact on this usage (`JSDOM`, `runScripts`, `Event`).
- Repo is CommonJS (`package.json:26` `"type": "commonjs"`); tests run via `node --test tests/**/*.test.js`.
- Views live at **`/app/views`**, not `src/views` — `src/index.js:21` sets `app.set('views', path.join(__dirname, '..', 'views'))`. The AGENTS.md layout diagram is stale on this point.
- `views/admin/eventForm.ejs`: inline script at lines 169–182; packing block at lines 265–284 — saved-rows loop renders hidden `packing_item_ids[]` only when the id is present, then the fixed 3-blank-row loop (`blank < 3`, line 278). Keep the 3-blank loop; do not add a `<template>` prototype.
- Server (unchanged): `parsePackingItems` skips `trim()===''` labels (`src/routes/admin.js:519-533`); `validatePackingItems` caps 50 rows / 200 chars (`src/routes/admin.js:547-579`); `syncPackingItems` inserts id-less rows, updates kept ids, deletes rows whose id is absent (`src/routes/admin.js:587-611`).
- Test helpers in `tests/api.test.js`: `request()`, `loginAsAdmin()`, `extractCsrf()`, `parseCookies()`, `formBody()`, `createTravelEvent()` (~lines 570–587), `putTravelEvent()` (~lines 589–606), `itemsOf()`, `eventIdByTitle()`; `process.env.DB_FILE` must be set to a throwaway file (e.g. `data/test-api.db`) **before** `require('../src/index')`.
- In `tests/packingAutogrow.test.js`: render the view with `ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'eventForm.ejs'), { event: null, errors: [], categories: VALID_CATEGORIES, csrfToken: 'test', packingItems: [...] })`. Include paths resolve relative to the template file; the two includes are `../partials/favicon` (static HTML) and `../partials/logo` (guards `logoLinkUrl` with `typeof`, so omitting it is safe) — those five locals are the only ones `eventForm.ejs` reads. Construct `new JSDOM(html, { runScripts: 'dangerously' })`, wait for the window `load` event (the existing script initializes via `window.onload`), then set `input.value` and dispatch `new window.Event('input', { bubbles: true })`. Read this file with `fs`, not via HTTP — no login/CSRF plumbing needed for the unit tests.
- The appended-row marker: the function must be named **`initPackingAutogrow`** — Task 3 asserts this name appears in the served HTML.
- ESLint (`eslint src/`) and Prettier (`src/**/*.js`) do not cover `.ejs`, so the inline script is not auto-linted/formatted; mirror the surrounding inline style (ES5 `var`, function declarations).

## Notes

- Manual smoke check after implementation: open the Travel event form in a real browser and confirm paste and IME-composition also grow the list — real browsers fire `input` for both; jsdom covers them by proxy (value set + `input` dispatch).
- Growth is intentionally capped at 50 to mirror `validatePackingItems`; if the cap ever changes, update both places (client constant and server validator).
- Typing into one of the original 3 blank rows grows nothing until the **last** blank row is touched — that is the chosen "keep one empty row at the end" rule, not a bug.
- The hint copy ("Add an item by filling a blank row…") stays as-is; auto-grow does not change the authoring model.
