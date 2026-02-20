# Architecture — ServiceUp Insights

## Overview

ServiceUp Insights is a standalone TypeScript/Node.js microservice that:
1. Ingests shop invoice PDFs via Gemini LLM into a structured PostgreSQL database
2. Computes fleet analytics metrics and cross-fleet benchmarks
3. Generates AI-powered insights (LLM-as-analyst + LLM-as-judge pipeline)
4. Serves the insights as self-contained HTML widgets embeddable in sa_portal via `<iframe>`

**Stack:** Node 22 · TypeScript 5 · Express · Prisma ORM · PostgreSQL 16 + pgvector · Gemini 2.5 Flash · LangChain · Firebase Admin · node-cron

---

## System Diagram

```
sa_portal (Next.js)
  │
  │  <iframe src="https://insights.serviceup.com/embed/dashboard?token=...">
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│                  serviceup-insights (port 4050)          │
│                                                         │
│  /embed/dashboard     ◄── JWT embed token auth          │
│  /embed/widget/:type  ◄── (fleetId baked into token)    │
│                                                         │
│  /api/v1/widgets      ◄── API key auth (x-api-key)      │
│  /api/v1/metrics      ◄── (for sa_portal backend)       │
│  /api/v1/embed-token  ◄── issues short-lived JWTs       │
│  /api/v1/health                                         │
└────────────┬────────────────────────────────────────────┘
             │
    ┌────────▼─────────┐     ┌─────────────────┐
    │   PostgreSQL 16   │     │  Gemini 2.5 Flash│
    │   + pgvector      │     │  (LLM + embeds) │
    │   port 5433       │     └─────────────────┘
    └──────────────────┘
             ▲
    ┌────────┴─────────────────────┐
    │     Nightly Pipeline (cron)   │
    │     11:00 PM UTC              │
    │                              │
    │  1. Fetch new invoices        │
    │     (Metabase → BigQuery)     │
    │  2. Download PDFs             │
    │     (Firebase Storage)        │
    │  3. Parse with Gemini LLM     │
    │  4. Embed for pgvector        │
    │  5. Generate insights         │
    │  6. Cache in insight_cache    │
    └──────────────────────────────┘
```

---

## Layer Breakdown

### 1. Ingestion (`src/ingestion/`)

| File | Responsibility |
|------|----------------|
| `mainDbClient.ts` | Metabase API → BigQuery proxy; fetches new `service_requests` rows |
| `pdfFetcher.ts` | Downloads PDFs from Firebase Storage URLs or plain HTTP; 30s timeout |
| `schema.ts` | Zod schema defining the LLM output shape (invoices, services, line items) |
| `pdfParser.ts` | Gemini `withStructuredOutput` 3-turn conversation; manual Zod default normalization |
| `normalizer.ts` | Maps parsed LLM result → Prisma upsert (ParsedInvoice + services + line items) |
| `embedder.ts` | text-embedding-004 → `$executeRaw` INSERT into `invoice_embeddings` (768-dim vector) |
| `batchRunner.ts` | Sequential processing with 1s LLM rate-limit delay; `processPendingInvoices()` |

**PDF parsing flow:**
```
PDF URL → base64 → Gemini 3-turn chat → Zod parse → manual normalize defaults → DB upsert → embed
```

**Important:** LangChain's `withStructuredOutput` does not apply Zod `.default()` values.
The result is manually normalized in `pdfParser.ts` after every `invoke()`.

---

### 2. Metrics (`src/metrics/metrics.ts`)

All analytics queries in one file. Each function takes `(fleetId, since)` and returns
a typed array via Prisma `$queryRaw`. Functions used by both the REST API and the intelligence layer.

Key query groups:
- **Spend:** `getTotalSpend`, `getSpendByShop`, `getMonthlySpend`
- **Labor:** `getAvgLaborRateByShop`, `getLaborRateBenchmark`
- **Parts:** `getTopReplacedParts`, `getPartCostBenchmark`
- **Anomalies:** `getAnomalies` (invoices > 2σ above fleet mean)
- **Benchmarks:** `getFleetPercentiles` (window functions across all fleets)
- **Summary:** `getFleetSummary`, `getVehicleRepairFrequency`, `getCostBreakdown`

---

### 3. Intelligence (`src/intelligence/`)

| File | Responsibility |
|------|----------------|
| `llmAnalyzer.ts` | Full insight generation pipeline (metrics → vector → benchmarks → NHTSA → LLM → judge → cache) |
| `insightPrompts.ts` | Prompt builder and `JUDGE_SYSTEM_PROMPT` constant |
| `insightJudge.ts` | LLM-as-judge: evaluates N candidates, keeps those passing 5 quality criteria |
| `benchmarks.ts` | Aggregates `getFleetPercentiles` + `getLaborRateBenchmark` + top part benchmarks |
| `vectorRetriever.ts` | Semantic search via pgvector cosine similarity |
| `nhtsaRecalls.ts` | NHTSA public API; 7-day in-process cache per make/model/year; max 5 parallel requests |

**Insight generation pipeline:**
```
1. Parallel metrics queries (8 functions)
2. pgvector semantic search (top-5 similar invoice chunks)
3. Cross-fleet benchmarks (percentile rank, labor rate, part costs)
4. NHTSA recall check (per VIN, cached 7 days)
5. Gemini generates ≤12 insight candidates (JSON array)
6. Judge LLM filters by: non-obvious, actionable, ≥3 data points, non-redundant, >$100 impact
7. Upsert survivors into insight_cache (48h TTL, keyed by fleet:type:period:date)
```

---

### 4. Embed Layer (`src/embed/`)

Self-contained HTML pages served as iframes. Each page is a complete HTML document with
inline CSS and Chart.js loaded from CDN. No external runtime dependencies.

| Widget Type | Template | Use case |
|-------------|----------|----------|
| `chart_line` / `chart_bar` / `chart_pie` | `chartWidget.ts` | Spend trends, top parts |
| `stat_card` | `statCard.ts` | Single KPI with delta |
| `table` / `comparison_table` | `tableWidget.ts` | Shop comparisons, part costs |
| `narrative` | `narrativeWidget.ts` | Text insights with bullet points |
| `alert` | `alertWidget.ts` | NHTSA recalls, anomalies |

**Auth:** JWT embed tokens issued by `POST /api/v1/embed-token` (API key required).
Token payload contains `{ fleetId, iat, exp }`. Verified by `embedAuthMiddleware`.
Token TTL: 300–86400s (default 3600s). Clamped at server side — never trust client-supplied TTL.

**XSS protection:** All user-controlled strings go through `escapeHtml()`. Chart data is
serialized through `jsonEmbed()` which escapes `<`, `>`, `&` to Unicode escapes.

---

### 5. API Layer (`src/api/`)

```
GET  /api/v1/health               # liveness check — no auth
GET  /api/v1/widgets?fleetId=X    # JSON array of cached insights
POST /api/v1/widgets/generate     # fire-and-forget insight generation
GET  /api/v1/metrics?fleetId=X    # raw metrics JSON
POST /api/v1/embed-token          # { fleetId, ttl } → { token }
```

Auth: `x-api-key` header checked against `API_KEY` env var.
If `API_KEY` is unset, all routes are open (warns to logger on first request).

---

## Database Schema

```
parsed_invoices          Core invoice row (requestId unique + pdfUrl)
  ├── parsed_invoice_services    Service lines (name, complaint, cause, correction)
  │     └── parsed_invoice_line_items   Parts/labor/sublet line items
  └── invoice_embeddings         768-dim pgvector embeddings (HNSW index)

insight_cache            Pre-computed insights (48h TTL, upserted by insightKey)
pipeline_state           Job checkpoint (lastSuccessAt, lastRunAt per pipeline name)
```

**pgvector:** `invoice_embeddings.embedding` is `vector(768)` (text-embedding-004).
HNSW index: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`.
Prisma uses `Unsupported("vector(768)")` — all operations via `$queryRaw` / `$executeRaw`.

---

## Authentication Model

| Surface | Mechanism | Notes |
|---------|-----------|-------|
| `/api/v1/*` | `x-api-key` header | Shared secret, sa_portal backend → insights |
| `/embed/*` | JWT query param `?token=` | Short-lived, fleetId-scoped, issued by API |
| Internal jobs | None | Run in-process, no network auth |

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | ✅ | — | Must use port 5433 locally |
| `GEMINI_API_KEY` | ✅ | — | From `serviceupaistudio` GCP project |
| `EMBED_SECRET` | ✅ | placeholder | JWT signing secret — **change in prod** |
| `API_KEY` | ✅ | — | Unset = open (logs warning) |
| `SERVICE_ACCOUNT_JSON_BASE64` | — | — | Firebase service account (base64 JSON). Not needed locally if using ADC |
| `STORAGE_BUCKET` | — | serviceupios.appspot.com | |
| `METABASE_URL` | — | — | Omit to skip nightly ingest |
| `METABASE_API_KEY` | — | — | |
| `METABASE_DATABASE_ID` | — | 34 | BigQuery dataset ID in Metabase |
| `PORT` | — | 4050 | |
| `INSIGHTS_BATCH_SIZE` | — | 10 | PDFs processed per batch |

**Firebase credential resolution order** (first match wins):
1. `SERVICE_ACCOUNT_JSON_BASE64` — base64-encoded JSON (Doppler/prod convention)
2. `FIREBASE_SERVICE_ACCOUNT_KEY` — raw inline JSON
3. `FIREBASE_SERVICE_ACCOUNT_KEY_PATH` — path to local JSON file
4. Application Default Credentials — `gcloud auth application-default login` (local dev) or workload identity (Cloud Run)

---

## Local Development

### First-time setup

```bash
# 1. Authenticate with GCP (gives Firebase Storage read access via ADC)
gcloud auth application-default login
# → log in with your serviceup Google account

# 2. Start local Postgres on port 5433
docker compose up postgres -d

# 3. Create .env with minimum required vars
echo "DATABASE_URL=postgresql://insights:insights@localhost:5433/serviceup_insights" > .env
echo "GEMINI_API_KEY=<your key from serviceupaistudio>" >> .env

# 4. Run migrations and start
npm run db:migrate:dev
npm run dev
# → http://localhost:4050

# 5. Smoke test
curl localhost:4050/api/v1/health
```

**Or with Doppler** (once `serviceup-insights/dev` config is created):
```bash
doppler run -- npm run dev
```

### What does and doesn't auto-run

**The server does NOT process PDFs on startup.** The nightly cron runs at 11pm UTC only.

| Command | Effect | Cost |
|---------|--------|------|
| `npm run dev` | Starts server only | Free |
| `npm run backfill -- --limit 10` | Parses 10 invoices — safe for testing | ~$0.01 |
| `npm run backfill` | Parses all ~9,000 historic invoices | ~$5–10 |
| `npm run pipeline` | Ingest new + generate insights (no bulk parsing) | Low |
| `POST /api/v1/widgets/generate` | Insights for one fleet (no PDF parsing) | Low |

### End-to-end test run

```bash
# Parse 10 invoices to exercise the full pipeline
npm run backfill -- --limit 10

# Inspect results in Prisma Studio
npm run db:studio   # → localhost:5555, check parsed_invoices table

# Generate insights for a fleet that has parsed invoices
curl -X POST "localhost:4050/api/v1/widgets/generate?fleetId=<id>" \
  -H "x-api-key: <API_KEY>"

# View widgets as JSON
curl "localhost:4050/api/v1/widgets?fleetId=<id>" \
  -H "x-api-key: <API_KEY>"
```

---

## Deployment

```bash
# Full Docker stack (local)
docker compose up -d
docker compose logs -f insights

# Production
docker compose -f docker-compose.yml up -d
```

Multi-stage Dockerfile: builder (node:22-alpine, compiles TS) → runtime (prod deps only, ~200MB).
Container: port 4050, restarts unless-stopped, waits for postgres healthcheck.

**Production Firebase auth:** When deployed (e.g. Cloud Run / "nano banana"), the platform generates
a service account automatically. DevOps grants that service account `Storage Object Viewer` on the
`serviceupios.appspot.com` bucket, and the app picks it up via Application Default Credentials —
no `SERVICE_ACCOUNT_JSON_BASE64` needed in prod either.

---

## Data Flow: End-to-End

```
Metabase/BigQuery          Firebase Storage
(service_requests)         (PDFs)
        │                      │
        └──── mainDbClient ────┘
                   │
              pdfFetcher (30s timeout)
                   │
              pdfParser (Gemini 2.5 Flash, structured output)
                   │
              normalizer → parsed_invoices + services + line_items
                   │
              embedder → invoice_embeddings (pgvector 768-dim)
                   │
              llmAnalyzer:
                ├── metrics queries (8 parallel)
                ├── vector retrieval (pgvector cosine)
                ├── benchmarks (window functions)
                ├── NHTSA recalls (cached API)
                ├── Gemini generates candidates
                ├── Judge LLM filters candidates
                └── insight_cache upsert (48h TTL)
                         │
                    embed routes → HTML widgets → <iframe> in sa_portal
```
