# Logo in Page Title

## Context

The app's header shows only a text title ("Remindly" on the public home page, "Dashboard" on the admin dashboard, "Dashboard / Edit Event" on the event form). The calendar favicon (`/favicon.svg`, already served via `express.static`) is visible only as a browser tab icon. Adding the logo image to the left of the title text gives every header-bearing page a visual brand identity, and making the logo a configurable link (via `LOGO_LINK_URL`) lets the deployer point it at any destination.

## Out of Scope

- `views/layout.ejs` — contains `<h1>Remindly</h1>` but is dead code (no `res.render()` call references it; every view is standalone). Intentionally left unchanged.
- `views/admin/login.ejs` and `views/error.ejs` — centered card layouts with no `<header>` element. Intentionally excluded.
- URL scheme validation on `LOGO_LINK_URL` (e.g. blocking `javascript:` URIs). The value is deployer-controlled via environment, not user input, so the risk is self-inflicted only.
- A new static asset. The logo reuses the existing `/favicon.svg` served by `express.static`.
- Making the logo image itself configurable. The source is hardcoded to `/favicon.svg`.

## Implementation approach

### Passing the link URL to views

Add a `res.locals` middleware in `src/index.js` that reads `process.env.LOGO_LINK_URL` on every request and exposes it to all EJS views as `logoLinkUrl`:

```js
app.use((req, res, next) => {
  res.locals.logoLinkUrl = process.env.LOGO_LINK_URL || '';
  next();
});
```

Place this **after** `app.use('/admin', csrfProtection)` and the `express.static` line, and **before** `app.use(apiKeyGuard)` so it runs before any route handler or guard that might short-circuit. `res.locals` is automatically merged into every `res.render()` call by Express, so no route handler needs to change.

`res.locals` (per-request) is chosen over `app.locals` (set once at boot) so tests can flip `process.env.LOGO_LINK_URL` between requests without rebooting the server.

### EJS template changes (3 views)

Each view's `<h1>` gets the logo image prepended before the existing title text. When `logoLinkUrl` is truthy, the `<img>` is wrapped in an `<a>`; otherwise it is a bare `<img>`:

```ejs
<h1>
  <% if (typeof logoLinkUrl !== 'undefined' && logoLinkUrl) { %>
    <a href="<%= logoLinkUrl %>" class="logo-link"><img src="/favicon.svg" alt="Remindly" class="logo"></a>
  <% } else { %>
    <img src="/favicon.svg" alt="Remindly" class="logo">
  <% } %>ExistingTitleText</h1>
```

The `typeof logoLinkUrl !== 'undefined'` guard matches the existing defensive pattern used elsewhere in the views (e.g. `typeof title !== 'undefined'`, `typeof activeNav !== 'undefined'`). EJS `<%= %>` auto-escapes the URL, preventing attribute injection. EJS `<% %>` control-flow tags produce **no output**, so the rendered HTML contains only the chosen branch's markup followed immediately by the title text — place `ExistingTitleText` on the same line as the closing `%>` so it sits directly before `</h1>` (e.g. `Remindly</h1>` in the rendered output).

Files to change:

1. **`views/public/index.ejs`** — `<h1>Remindly</h1>` becomes the logo block followed by `Remindly`.
2. **`views/admin/dashboard.ejs`** — `<h1>Dashboard</h1>` becomes the logo block followed by `Dashboard`. The header uses `display: flex; align-items: center`; the logo sits inline inside the h1 flex item, so no flex change is needed.
3. **`views/admin/eventForm.ejs`** — `<h1><a href="/admin">Dashboard</a> / …</h1>` becomes the logo block followed by the existing `<a href="/admin">Dashboard</a> / …` content. This view already styles `header a { text-decoration: none; }`, so the logo link inherits no underline; the `.logo-link` rule below is redundant here but added for consistency.

### CSS (added to each view's inline `<style>` block)

Add near the existing `header h1` rule in each of the 3 views:

```css
.logo {
  height: 1.25em;
  width: 1.25em;
  vertical-align: middle;
  margin-right: 0.25em;
}
.logo-link {
  text-decoration: none;
}
```

`1.25em` scales relative to the h1 font-size (`1.75rem` → ~35px), sitting within the `line-height: 1.2` line box. `vertical-align: middle` aligns the image with the text baseline.

### Environment variable documentation

- **`.env.example`** — append `LOGO_LINK_URL=https://example.com` as a new line.
- **`README.md`** — add a row to the Environment Variables table: `| \`LOGO_LINK_URL\` | Optional. URL the header logo links to; if unset, logo is shown without a link |`.
- **`AGENTS.md`** — add a row to the Environment Variables table: `| \`LOGO_LINK_URL\` | Optional. URL the header logo links to; if unset, logo is shown without a link |`.

### Test placement

Add tests to `tests/api.test.js`:

1. Add `process.env.LOGO_LINK_URL = 'https://example.com';` to the existing `before()` hook inside `describe('API integration', …)` (alongside the other `process.env` assignments, before `server = require('../src/index')`).
2. Add a new `describe('Logo in page title', …)` subdescribe **inside** `describe('API integration', …)` so it reuses the already-booted test server on port 9999. Admin-authenticated tests call the existing `loginAsAdmin()` helper in a `before` hook.
3. The "unset" test temporarily `delete`s `process.env.LOGO_LINK_URL` and restores it in a `finally` block so subsequent tests still see the set value.

## Tasks

### Task 1 - Logo image with env-driven link in page titles

- `LOGO_LINK_URL` set to `https://example.com` + `GET /`
  - → HTTP 200
  - → body contains `<img src="/favicon.svg"` (logo image present)
  - → body contains `href="https://example.com"` (logo wrapped in link to LOGO_LINK_URL)
  - → body contains `Remindly</h1>` (title text unchanged, immediately before closing tag)
- `LOGO_LINK_URL` unset (deleted from env) + `GET /`
  - → HTTP 200
  - → body contains `<img src="/favicon.svg"` (logo image still present)
  - → body does NOT contain `href="https://example.com"` (logo is a plain image, not a link)
  - → body contains `Remindly</h1>` (title text unchanged)
- `LOGO_LINK_URL` set + authenticated `GET /admin`
  - → HTTP 200
  - → body contains `<img src="/favicon.svg"` (logo on dashboard header)
  - → body contains `href="https://example.com"` (logo is a link)
  - → body contains `Dashboard</h1>` (title text unchanged, immediately before closing tag)
- `LOGO_LINK_URL` set + authenticated `GET /admin/events/new`
  - → HTTP 200
  - → body contains `<img src="/favicon.svg"` (logo on event form header)
  - → body contains `href="https://example.com"` (logo is a link)
- `LOGO_LINK_URL` set + `GET /` (regression guard)
  - → body still contains `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` (favicon link tag unaffected)
  - → body still contains `Events for` (page content unaffected)

## Bootstrap

This feature adds no new app, service, or package and introduces no new dependencies — Express and EJS are already in `package.json`. To reach a working dev environment with tests passing:

```bash
cp .env.example .env   # then fill in ADMIN_USERNAME, ADMIN_PASSWORD, API_KEYS, PORT, NODE_ENV, LOGO_LINK_URL
npm install
npm run lint && npm run format && npm test
```

## Technical Context

No new packages are introduced. Relevant existing dependencies (from `package.json`, already pinned):

- `express` `^5.2.1` — `res.locals` is merged into every `res.render()` call automatically; no explicit passing needed.
- `ejs` `^6.0.1` — `<%= %>` auto-escapes `logoLinkUrl` in the `href` attribute; `<%- %>` (unescaped) is not used.

`/favicon.svg` is already served by `app.use(express.static(path.join(__dirname, '..', 'public')))` in `src/index.js`, so `<img src="/favicon.svg">` resolves without any new static route or asset. The SVG has `viewBox="0 0 32 32"` and scales cleanly to the CSS `1.25em` size.

## Notes

- `LOGO_LINK_URL` is **optional**. When unset or set to an empty string, `process.env.LOGO_LINK_URL || ''` yields `''`, which is falsy in the EJS conditional, so the logo renders as a bare `<img>` without a link. Both `undefined` (unset) and `''` (empty) produce identical behavior.
- The `res.locals` middleware reads `process.env.LOGO_LINK_URL` per-request, so changing the env var at runtime takes effect on the next request without a restart.
- `views/layout.ejs` is dead code (no `res.render()` call references it) and is intentionally left unchanged.
- `views/admin/login.ejs` and `views/error.ejs` are centered card layouts with no `<header>` and are intentionally excluded.
- The logo `alt` text is `"Remindly"` (the brand name) on all pages, including the admin dashboard whose title text is "Dashboard". The logo represents the brand, not the page title.
