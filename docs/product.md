# Remindly

A lightweight event reminder app for tracking birthdays, name days, holidays, anniversaries, and flag days. Provides a public API for querying events by date and an admin UI for managing them.

## Features

- **Calendar Favicon** — SVG calendar icon served at `/favicon.svg` and referenced in all pages ([story](stories/001-add-favicon/story.md))
- **Weekday Labels on Week Views** — Two-letter weekday abbreviation (Mo, Tu, etc.) shown next to dates in "This Week" and "Next Week" HTML views ([story](stories/002-weekday-labels-week-views/story.md))
- **"Other" Event Category** — New "Other" category added to the predefined category list, allowing admins to file events that don't match Birthday, Name Day, Flag Day, Holiday, or Anniversary ([story](stories/003-add-other-category/story.md))
- **Health Check API** — Unauthenticated `GET /health` readiness endpoint that probes the SQLite database with `SELECT 1` and returns a minimal `{"status":"ok"}` (200) or `{"status":"error"}` (503) JSON response, documented in Swagger ([story](stories/004-add-health-check/story.md))
- **Logo in Page Title** — Calendar favicon (`/favicon.svg`) shown to the left of the title text on all header-bearing pages (public home, admin dashboard, event form); the logo links to the URL in `LOGO_LINK_URL` when set, otherwise appears as a plain image ([story](stories/005-add-logo-to-title/story.md))
- **Public Event API** — The `/api/events` endpoint is publicly accessible without an API key ([story](stories/006-public-event-api/story.md))
- **"Travel" Event Category** — New "Travel" category added to the predefined category list, allowing admins to file trips and commutes that don't match Birthday, Name Day, Flag Day, Holiday, Anniversary, or Other; the DB `CHECK` constraint is now derived from the shared `VALID_CATEGORIES` list so category changes no longer require DDL edits ([story](stories/007-add-travel-category/story.md))
- **Travel Packing List** — Admins attach a list of things to take along to a Travel event; on the public page each item renders as a checkbox, ticked items move to the end of the list and are shown faded and struck-through, and unticking puts them back. Items are added, renamed, or removed from the event form; packed state is stored server-side and shared by all visitors ([story](stories/008-travel-packing-list/story.md))
- **Packing List Auto-Grow** — in the admin event form, typing in the last empty packing-item row of a Travel event automatically appends a new empty text field, so lists of any size up to the existing 50-item cap can be authored without saving and reopening the event ([story](stories/009-packing-list-autogrow/story.md))

## Non-Goals

- Multi-user accounts or user management UI — admin credentials are environment-only.
- API key management UI — keys are environment-only.
- PWA metadata or multi-format favicon bundles.

## Known Limitations

- Admin is a single built-in user defined via environment variables; no user registration or password reset flow exists.
- API keys are static and managed outside the application; no rotation or revocation UI.
- Packing-list tick state is stored once per item and shared by everyone who visits the deployment; there is no per-person packing progress, and packed items are not auto-reset.
