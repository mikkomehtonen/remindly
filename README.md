# Remindly

Event reminder application with a public API and admin UI.

## Setup

```bash
cp .env.example .env   # edit with your credentials
npm install
npm start
```

## Environment Variables

| Variable        | Purpose                                    |
|-----------------|--------------------------------------------|
| `ADMIN_USERNAME`| Admin login username                       |
| `ADMIN_PASSWORD`| Admin login password (hashed at boot)      |
| `API_KEYS`      | Comma-separated valid API keys             |
| `PORT`          | Server port (default 3000)                 |
| `NODE_ENV`      | `development` or `production`              |
| `LOGO_LINK_URL` | Optional. URL the header logo links to; if unset, logo is shown without a link |

## Running

```bash
npm start          # Start server
npm run lint       # Lint code
npm run format     # Format code
npm test           # Run tests
```

## API

### GET /api/events

Requires `x-api-key` header.

**Query parameters:**
- `date` — YYYY-MM-DD date
- `alias` — `today`, `tomorrow`, or `next_week`
- `category` — One of: Birthday, Name Day, Flag Day, Holiday, Anniversary

**Single-day response:**
```json
{
  "date": "2026-05-30",
  "events": [
    { "id": 1, "title": "Event name", "description": null, "category": "Birthday" }
  ]
}
```

**Next-week response:**
```json
{
  "startDate": "2026-06-08",
  "endDate": "2026-06-14",
  "events": [...]
}
```

### Admin routes

| Path                      | Description          |
|---------------------------|----------------------|
| GET /admin/login          | Login form           |
| POST /admin/login         | Authenticate         |
| POST /admin/logout        | Logout               |
| GET /admin                | Dashboard            |
| GET /admin/events/new     | New event form       |
| POST /admin/events        | Create event         |
| GET /admin/events/:id/edit| Edit event form      |
| PUT /admin/events/:id     | Update event         |
| DELETE /admin/events/:id  | Delete event         |
