---
sessionID: ses_190355eb1ffe3flyPIPiwK9jIE
baseMessageCount: 0
updatedAt: 2026-05-28T18:21:22.004Z
---

# Create an app that offers an API that can be used to query about
important events happening today, tomorrow or next week, e.g. birth days,
name days, flag days etc. Event has a short description (e.g. Marco's birthday)
and an optional longer description (e.g. why this day is a flag day).

The app needs to have an admin web UI for creating and updating events.

## Current spec

The app will be a Node.js + Express + SQLite web service. It provides a public JSON API for querying daily events by any date or aliases (today, tomorrow, next_week). API keys are validated from a comma-separated environment variable. Events have short and optional long descriptions, five fixed categories (Birthday, Name Day, Flag Day, Holiday, Anniversary), and support both annually recurring (stored as month/day) and one-time fixed-date events. There is a server-rendered public frontend page and an admin web UI (EJS/Pug), with simple username/password login for a single built-in admin account configured via environment variables. Admin UI provides CRUD for events only. Targeting a single country/region. All key architectural and scope decisions are resolved.

## Q&A history

Q: Should events be recurring annually (e.g., birthdays and name days repeat every year) or one-time fixed dates only?
A: Both recurring and one-time events

Q: Is this app targeting a specific country/region (name days and flag days vary by location), and should the admin UI require user login?
A: Single country/region with login required

Q: Should the public event-query API be completely open to anyone, or require API keys or user authentication?
A: Requires API keys

Q: Should there also be a public frontend page showing today's events (like a calendar widget), or is the app purely the API plus the admin UI?
A: API + admin UI + a simple public frontend page

Q: Should the admin UI also let logged-in admins generate and manage their own API keys, or are keys handled outside the app (e.g., manually or by a super-admin)?
A: No key management in the app — keys handled externally

Q: Should events have fixed categories (e.g., Birthday, Name Day, Flag Day) that API consumers can filter by, or just a free-text title with no category system?
A: Fixed categories for filtering

Q: How should admin authentication work? A simple username/password login form, or OAuth with a provider like Google or GitHub?
A: Simple username/password (self-contained)

Q: Should the app support multiple admin accounts (user management page), or just a single built-in admin user?
A: Single built-in admin account

Q: Do you have a preferred tech stack (e.g., Node.js/Express + SQLite, Python/Flask, Go), or should I choose a pragmatic, simple default?
A: Node.js + Express + SQLite

Q: Should the API accept any arbitrary date query, or only the three presets: today, tomorrow, and next week?
A: Any arbitrary date (with presets as aliases)

Q: How should externally managed API keys be configured in the app? A comma-separated list in an environment variable, or validated against a simple database table seeded at setup?
A: Environment variable (comma-separated keys)

Q: How should the single admin username and password be set? Environment variables at deploy time, or hardcoded with a required change on first use?
A: Environment variables

Q: Which fixed event categories should be built in? The obvious ones are Birthday, Name Day, and Flag Day — do you need any others (e.g., Holiday, Anniversary, Historical)?
A: Birthday, Name Day, Flag Day, Holiday, Anniversary

Q: Should the public frontend page and admin UI be server-rendered HTML (e.g., EJS templates) or a static HTML page (public) + simple server-rendered forms (admin)?
A: Server-rendered EJS/Pug for both
