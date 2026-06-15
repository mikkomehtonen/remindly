# Remindly

A lightweight event reminder app for tracking birthdays, name days, holidays, anniversaries, and flag days. Provides a public API for querying events by date and an admin UI for managing them.

## Features

- **Calendar Favicon** — SVG calendar icon served at `/favicon.svg` and referenced in all pages ([story](stories/001-add-favicon/story.md))
- **Weekday Labels on Week Views** — Two-letter weekday abbreviation (Mo, Tu, etc.) shown next to dates in "This Week" and "Next Week" HTML views ([story](stories/002-weekday-labels-week-views/story.md))
- **"Other" Event Category** — New "Other" category added to the predefined category list, allowing admins to file events that don't match Birthday, Name Day, Flag Day, Holiday, or Anniversary ([story](stories/003-add-other-category/story.md))

## Non-Goals

- Multi-user accounts or user management UI — admin credentials are environment-only.
- API key management UI — keys are environment-only.
- PWA metadata or multi-format favicon bundles.

## Known Limitations

- Admin is a single built-in user defined via environment variables; no user registration or password reset flow exists.
- API keys are static and managed outside the application; no rotation or revocation UI.
