# Make /api/events endpoint public

## Context

The `/api/events` endpoint currently requires an `x-api-key` header for all requests. However, the same data is publicly accessible through the web UI without any authentication. For consistency and ease of use for third-party integrations, the `/api/events` endpoint should be made publicly accessible without requiring an API key.

## Out of Scope

- Making other `/api/` endpoints public.
- Adding any new authentication methods.
- Modifying the structure of the `/api/events` response.

## Implementation approach

1. Modify `src/middleware/apiKey.js` to check the request path. If the path is `/api/events`, the middleware should call `next()` immediately without validating the `x-api-key` header.
2. Update the Swagger documentation in `src/routes/public.js` for the `/api/events` endpoint to remove the `ApiKeyAuth` security requirement.
3. Update `README.md` to reflect that the `/api/events` endpoint is public.

## Tasks

### Task 1 - Update apiKeyGuard to allow /api/events
- GET /api/events without header
  - → 200 OK
- GET /api/events with invalid header
  - → 200 OK
- GET /api/any-other-route without header
  - → 401 Unauthorized

### Task 2 - Update Swagger documentation
- GET /api/events
  - → Swagger UI shows no security requirement for this endpoint.

### Task 3 - Update README documentation
- README.md
  - → "Requires `x-api-key` header" note updated or clarified.

## Bootstrap

No new dependencies are required for this task.

## Technical Context

- `src/middleware/apiKey.js`: Current implementation uses `req.path.startsWith('/api/')` to apply the guard. We will add a specific exclusion for `/api/events`.
- `src/routes/public.js`: The Swagger definition for `/api/events` includes `security: - ApiKeyAuth: []`. This needs to be removed.

## Notes

- Ensure that the `apiKeyGuard` still blocks all other `/api/` routes.
- The `x-api-key` header is still required for other potential future `/api/` routes.


