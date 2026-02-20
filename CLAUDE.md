# ServiceUp Insights — Claude Code Instructions

PDF ingestion + LLM analytics service that extracts structured data from shop invoices,
generates AI-powered fleet insights, and serves embeddable iframe widgets for sa_portal.

## Commands

```bash
npm run dev              # tsx watch src/index.ts (port 4050)
npm run build            # tsc → dist/
npm run test             # vitest
npx tsc --noEmit         # type-check only (run this before declaring done)

npm run db:migrate:dev   # create + apply migration (dev)
npm run db:migrate       # deploy migrations (prod)
npm run db:studio        # Prisma Studio GUI at localhost:5555

npm run pipeline         # run nightly pipeline manually
npm run backfill         # resumable backfill of all historic invoices
npm run seed             # import from Google Sheet CSV
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
