# ServiceUp Insights — Claude Code Instructions

PDF ingestion + LLM analytics service that extracts structured data from shop invoices,
generates AI-powered fleet insights, and serves embeddable iframe widgets for sa_portal.

## Local Dev Setup (first time)

```bash
# 1. Authenticate with GCP — gives Firebase Storage read access via ADC
gcloud auth application-default login
# → browser opens, log in with your serviceup Google account

# 2. Start local Postgres (port 5433)
docker compose up postgres -d

# 3. Run migrations
npm run db:migrate:dev

# 4. Start the server
npm run dev
# → http://localhost:4050

# 5. Smoke test
curl localhost:4050/api/v1/health
```

**Minimum `.env` for local dev:**
```
DATABASE_URL=postgresql://insights:insights@localhost:5433/serviceup_insights
GEMINI_API_KEY=<key from serviceupaistudio AI Studio project>
```
Firebase Storage works automatically via `gcloud auth application-default login` — no key file needed.

**Or with Doppler** (once `serviceup-insights/dev` config exists):
```bash
doppler run -- npm run dev
```

## Commands

```bash
npm run dev              # tsx watch src/index.ts (port 4050)
npm run build            # tsc → dist/
npm run test             # vitest
npx tsc --noEmit         # type-check only (run this before declaring done)

npm run db:migrate:dev   # create + apply migration (dev)
npm run db:migrate       # deploy migrations (prod)
npm run db:studio        # Prisma Studio GUI at localhost:5555

npm run pipeline         # run nightly pipeline manually (no PDF parsing)
npm run backfill         # full backfill — ALL ~9,000 historic invoices
npm run backfill -- --limit 10   # TEST MODE — process only 10 invoices
npm run seed             # import from Google Sheet CSV
```

## What Triggers PDF Processing

**The server does NOT auto-process PDFs on startup.** The nightly cron fires at 11pm UTC only.

| Trigger | What it does |
|---------|-------------|
| `npm run backfill -- --limit 10` | Safe test — parse 10 invoices end-to-end |
| `npm run backfill` | Full run — all ~9,000 historic invoices (costs $) |
| `npm run pipeline` | Nightly job — ingest new + generate insights (no bulk parsing) |
| `POST /api/v1/widgets/generate?fleetId=X` | Generate insights for one fleet (no PDF parsing) |

## End-to-End Test Workflow (first run)

```bash
# 1. Bring up DB + server
docker compose up postgres -d
npm run db:migrate:dev
npm run dev

# 2. Parse 10 invoices to verify the pipeline works
npm run backfill -- --limit 10

# 3. Check the DB has parsed records
npm run db:studio   # open Prisma Studio → inspect parsed_invoices table

# 4. Trigger insight generation for a fleet that has parsed invoices
curl -X POST "localhost:4050/api/v1/widgets/generate?fleetId=<id>" \
  -H "x-api-key: <API_KEY>"

# 5. View the embed dashboard
curl "localhost:4050/embed/dashboard?fleetId=<id>&token=<embed_token>"
```

## Architecture (5 layers)

```
src/
  ingestion/     PDF fetch → Gemini parse → normalize → DB + pgvector embed
  metrics/       Typed $queryRaw functions against parsed_invoices
  intelligence/  LLM insight generation + judge filter + NHTSA recalls + benchmarks
  embed/         Self-contained HTML widget/dashboard routes (iframe-served)
  api/           REST API (/api/v1/*) — JSON widgets, metrics, embed-token issuance
  jobs/          Nightly cron pipeline (11pm UTC)
```

**Key files:**
- `src/index.ts` — startup, DB connect, scheduler init, graceful shutdown
- `src/config/env.ts` — all env vars (add new ones here)
- `src/ingestion/schema.ts` — Zod schema for LLM output (source of truth for invoice shape)
- `src/metrics/metrics.ts` — all analytics queries (add new metrics here)
- `prisma/schema.prisma` — DB models + pgvector extension

## Gemini Model Strategy

PDF parsing uses **Flash first, Pro fallback**:
- `gemini-2.5-flash` — used for all parses (fast, cheap)
- `gemini-2.5-pro` — automatic fallback when `parse_confidence < 0.6` (blurry scans etc.)
- `llm_model` column on `parsed_invoices` records which model was actually used
- API key comes from the `serviceupaistudio` GCP project

## Critical Gotchas

**Port 5433:** PostgreSQL runs on `5433:5432` (not 5432 — the main serviceup project owns that).
`DATABASE_URL` must use port `5433` in local `.env`.

**LangChain + Zod defaults:** `withStructuredOutput(schema)` does NOT apply Zod `.default()` values.
Always manually normalize the result after invoke (see `pdfParser.ts` for the pattern).

**Pending-set pagination:** Never use `skip: offset` with `offset += batchSize` on a filtered set
that shrinks as items are processed — you'll skip rows. Always re-query from `skip: 0`
(processed items leave the filter naturally).

**pgvector raw SQL:** Prisma does not support the `vector` type natively. All embedding reads/writes
use `$executeRaw` / `$queryRaw` with `::vector` casts. Never use Prisma model methods for
`invoice_embeddings`.

## Code Conventions

- `parseInt` always takes radix: `parseInt(str, 10)`
- Never `console.log` — use `logger` from `src/utils/logger.ts`
- All user-controlled strings rendered in HTML templates must go through `escapeHtml()` from `src/embed/templates/layout.ts`
- No `!` non-null assertions — use explicit guards (`if (!x) return`)
- No `any` types — if unavoidable use `unknown` and narrow
- New env vars: add to `src/config/env.ts` AND `.env.example`

## Before Declaring Done

```bash
npx tsc --noEmit   # must be zero errors
```

Verify: no `console.log` left, no `!` assertions added, no new env vars missing from `.env.example`.

## Testing

Framework: **vitest** — `npm test` or `npx vitest run path/to/file.test.ts`.
Test files live alongside source as `*.test.ts` or in `src/__tests__/`.

## Database

Always use `npm run db:migrate:dev` (not `db:push`) for schema changes — it creates a migration file.
`db:push` is only for rapid local prototyping before a migration is written.

After adding a model, run `npm run db:generate` to regenerate the Prisma client.

## Modular Rules

See `.claude/rules/` for detailed conventions:
- `security.md` — auth, CORS, input validation, secrets
- `database.md` — Prisma patterns, raw SQL, pgvector, migrations
