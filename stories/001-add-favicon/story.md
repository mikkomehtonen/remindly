# Add Calendar Favicon

## Context

The app currently has no favicon, so browsers display a default icon in the tab. Adding a recognizable calendar favicon served as a static SVG file improves the user experience and brand identity at zero runtime cost.

## Out of Scope

- Multi-size ICO/PNG favicons or `apple-touch-icon` — single SVG is sufficient for modern browsers.
- Web manifest (`site.webmanifest`) or PWA metadata.

## Implementation approach

1. Create a `public/` directory at the project root and place an `favicon.svg` file inside it. The SVG will depict a simple calendar icon (page with header bar and day grid) using the app's brand green `#6a9e7e` and neutral tones.
2. Register `express.static(path.join(__dirname, '..', 'public'))` in `src/index.js` **before** the `apiKeyGuard` middleware so the favicon is served without requiring an API key. Static file serving should be early in the middleware stack but after session/cookie setup so that future static assets could benefit from session context if needed.
3. Add `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` to the `<head>` of `views/layout.ejs` so all rendered pages reference the favicon.

The favicon is a standalone file loaded by URL, not embedded as a data URI — matching the explicit requirement.

## Tasks

### Task 1 - Create favicon SVG file

- `public/favicon.svg` exists on disk
  - → file contains valid SVG XML with a calendar icon
  - → viewBox is set (e.g. `0 0 32 32`) for scaling
  - → primary fill uses `#6a9e7e` (brand green)

### Task 2 - Serve static files from public directory

- Express app has `express.static` middleware mounted
  - → `GET /favicon.svg` returns 200 with `Content-Type: image/svg+xml`
  - → static middleware is registered before `apiKeyGuard` so no API key is required for `/favicon.svg`
  - → existing routes (`/`, `/api/events`, `/admin/*`) continue to work unchanged

### Task 3 - Reference favicon in layout

- `views/layout.ejs` contains `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` inside `<head>`
  - → rendered HTML of any page includes the favicon link tag
  - → `<link>` tag appears after `<meta charset>` and `<meta viewport>` tags

## Notes

- SVG favicons are supported in all modern browsers (Chrome, Firefox, Safari 15+, Edge). No fallback ICO is required for the target audience.
- The `express.static` middleware placement before `apiKeyGuard` ensures the favicon loads on the public homepage without authentication, while admin pages (which already require session) also benefit.
