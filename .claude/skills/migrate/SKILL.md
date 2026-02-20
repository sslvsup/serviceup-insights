# /migrate

Create a new Prisma database migration.

Usage: `/migrate <name>`
Example: `/migrate add_fleet_id_index`

## Steps

1. Review `prisma/schema.prisma` to understand the pending changes.
2. Run the migration:
   ```bash
   npm run db:migrate:dev -- --name $ARGUMENTS
   ```
3. Read the generated migration file in `prisma/migrations/` and confirm the SQL looks correct.
4. If the migration touches `invoice_embeddings` or vector columns, verify the raw SQL uses `::vector` casts — Prisma does not handle the `vector` type natively.
5. Run `npx tsc --noEmit` to confirm no type regressions from Prisma client regeneration.

## Rules
- Migration name must be snake_case and descriptive (e.g. `add_labor_rate_index`, not `update1`)
- Never use `npm run db:push` — it skips migration history
- If the migration fails halfway, check `prisma/migrations` for a partial file and clean it up before retrying
