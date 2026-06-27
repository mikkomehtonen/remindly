# Remindly

A lightweight event reminder app for tracking birthdays, name days, holidays, anniversaries, and flag days. Provides a public API for querying events by date and an admin UI for managing them.

## Features

- **Calendar Favicon** — SVG calendar icon served at `/favicon.svg` and referenced in all pages ([story](stories/001-add-favicon/story.md))
- **Weekday Labels on Week Views** — Two-letter weekday abbreviation (Mo, Tu, etc.) shown next to dates in "This Week" and "Next Week" HTML views ([story](stories/002-weekday-labels-week-views/story.md))
- **"Other" Event Category** — New "Other" category added to the predefined category list, allowing admins to file events that don't match Birthday, Name Day, Flag Day, Holiday, or Anniversary ([story](stories/003-add-other-category/story.md))
- **Health Check API** — Unauthenticated `GET /health` readiness endpoint that probes the SQLite database with `SELECT 1` and returns a minimal `{"status":"ok"}` (200) or `{"status":"error"}` (503) JSON response, documented in Swagger ([story](stories/004-add-health-check/story.md))
- **Logo in Page Title** — Calendar favicon (`/favicon.svg`) shown to the left of the title text on all header-bearing pages (public home, admin dashboard, event form); the logo links to the URL in `LOGO_LINK_URL` when set, otherwise appears as a plain image ([story](stories/005-add-logo-to-title/story.md))

## Non-Goals

- Multi-user accounts or user management UI — admin credentials are environment-only.
- API key management UI — keys are environment-only.
- PWA metadata or multi-format favicon bundles.

## Known Limitations

- Admin is a single built-in user defined via environment variables; no user registration or password reset flow exists.
- API keys are static and managed outside the application; no rotation or revocation UI.
