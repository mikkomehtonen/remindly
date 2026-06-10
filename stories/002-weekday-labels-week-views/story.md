# Weekday Labels on Week Views

## Context

In the "This Week" and "Next Week" views, dates are displayed as bare YYYY-MM-DD strings (e.g. `2026-06-20`). Without opening a calendar, it is hard to tell whether that date is a Monday, Thursday, or Saturday. Adding a two-letter weekday abbreviation next to each date removes this friction.

## Out of Scope

- Weekday labels on single-day views ("Today" / "Tomorrow") — the heading already identifies the day.
- Changes to the JSON API (`GET /api/events`) — consumer can derive the weekday client-side.
- Localized weekday names — English two-letter abbreviations only (Mo, Tu, We, Th, Fr, Sa, Su).

## Implementation approach

1. Add a `WEEKDAY_ABBREVS` constant and a `formatDateWithWeekday(date)` helper to `src/utils/dateMath.js`. The function returns `"YYYY-MM-DD Dd"` where `Dd` is the two-letter English abbreviation derived from `date.getDay()`. Mapping: 0→Su, 1→Mo, 2→Tu, 3→We, 4→Th, 5→Fr, 6→Sa.
2. Add an optional `includeWeekday` parameter (default `false`) to `queryEvents()` in `src/routes/public.js`. When `true`, line 260 uses `formatDateWithWeekday` instead of `formatDate` for the event's `displayDate` field. The `_sortDate` is still stripped from the final object regardless.
3. In the HTML route handler (`GET /`), when `alias` is `this_week` or `next_week`:
   - Call `queryEvents(db, startDate, endDate, null, true)` to get weekday-enriched `displayDate` values.
   - Format the heading date range using `formatDateWithWeekday` for both start and end dates.
4. The JSON API route handler always calls `queryEvents` without the `includeWeekday` flag (defaults to `false`) and uses `formatDate` for envelope dates — unchanged from current behaviour.

Format rule: `"YYYY-MM-DD Dd"` — date string followed by a space and the two-letter abbreviation (e.g. `2026-06-20 Sa`).

## Tasks

### Task 1 - Add `formatDateWithWeekday` to dateMath.js

- `formatDateWithWeekday` function exists in `src/utils/dateMath.js` and is exported
  - → `formatDateWithWeekday(new Date(2026, 5, 20))` returns `'2026-06-20 Sa'` (Saturday)
  - → `formatDateWithWeekday(new Date(2026, 0, 5))` returns `'2026-01-05 Mo'` (Monday)
  - → `formatDateWithWeekday(new Date(2026, 11, 27))` returns `'2026-12-27 Su'` (Sunday)
- `WEEKDAY_ABBREVS` constant is a frozen array of 7 strings `['Su','Mo','Tu','We','Th','Fr','Sa']`
- existing `formatDate` behaviour is unchanged

### Task 2 - Use `formatDateWithWeekday` in week-view HTML rendering

- `queryEvents` accepts optional 5th parameter `includeWeekday` (default `false`)
  - → when `true`, event `displayDate` is produced by `formatDateWithWeekday` instead of `formatDate`
  - → when `false` (or omitted), event `displayDate` is produced by `formatDate` — current behaviour unchanged
- HTML route handler (`GET /`) with `alias=this_week`
  - → `queryEvents` called with `includeWeekday=true`
  - → heading reads `"Events for YYYY-MM-DD Dd to YYYY-MM-DD Dd"` (e.g. `"Events for 2026-06-16 Mo to 2026-06-22 Su"`)
  - → each event card's displayDate shows `"YYYY-MM-DD Dd"` format
- HTML route handler (`GET /`) with `alias=next_week`
  - → `queryEvents` called with `includeWeekday=true`
  - → heading reads `"Events for YYYY-MM-DD Dd to YYYY-MM-DD Dd"`
  - → each event card's displayDate shows `"YYYY-MM-DD Dd"` format
- HTML route handler with `alias=today` or `alias=tomorrow`
  - → `queryEvents` called without `includeWeekday` (defaults to `false`)
  - → heading and displayDate format unchanged (YYYY-MM-DD only, no weekday)
- JSON API (`GET /api/events`) for any alias
  - → `queryEvents` called without `includeWeekday` (defaults to `false`)
  - → `displayDate` on events remains `"YYYY-MM-DD"` format — no weekday abbreviation
  - → `startDate` / `endDate` in range envelope remain `"YYYY-MM-DD"` format

## Notes

- The two-letter abbreviations follow ISO weekday numbering (Monday=1) in display order but the internal mapping uses JavaScript's `getDay()` (0=Sunday), hence the constant order is `['Su','Mo','Tu','We','Th','Fr','Sa']`.
- The space between date and abbreviation matches the user's expectation of a compact but readable label.
