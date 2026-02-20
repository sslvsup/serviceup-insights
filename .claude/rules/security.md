# Security Rules

## Input & Output

- All user-controlled strings rendered into HTML MUST go through `escapeHtml()` from `src/embed/templates/layout.ts`
- Chart/JSON data embedded in `<script>` tags MUST go through `jsonEmbed()` (escapes `<`, `>`, `&`)
- All query params that become integers: use `parseInt(val, 10)` then check `isNaN()`
- Validate request bodies with Zod schemas — do not trust raw `req.body` shapes

## Authentication

- Embed JWT tokens are short-lived (300–86400s). Never extend TTL beyond 86400s.
- `fleetId` in query string MUST match the `fleetId` claim in the JWT — checked in `embedAuthMiddleware`
- `API_KEY` must be set in production. If unset, all `/api/v1` routes are open (a warning is logged)
- `EMBED_SECRET` must not be the default placeholder in production

## Secrets & Environment

- Never log env vars, tokens, or API keys — not even partial values
- Never hardcode credentials, even for tests
- Never commit `.env` — it is gitignored. Use `.env.example` for documentation.
- New secrets go in `src/config/env.ts` with `required()` and must appear in `.env.example`

## CORS

- Allowed origins: `*.serviceup.com` + `https://app.serviceup.com` + `ALLOWED_ORIGINS` env var
- `X-Frame-Options: ALLOW-FROM` is only removed for `/embed/*` routes — all other routes block iframe embedding
- Do not echo arbitrary `Origin` headers

## Dependencies

- Before adding a new npm dependency, check it is actively maintained and has no known critical CVEs
- Prefer packages with zero transitive dependencies for security-sensitive code paths
