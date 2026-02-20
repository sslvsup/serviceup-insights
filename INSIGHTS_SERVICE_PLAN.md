# ServiceUp Insights Service — Implementation Plan (v3)

## Executive Summary

Build a **separate TypeScript service** (`serviceup-insights`) that extracts rich structured data from shop invoice/estimate PDFs (~9,000+ existing across 50+ fleets, ~600 new/day), stores it in a hybrid PostgreSQL + JSONB datastore with pgvector for semantic search, and surfaces LLM-generated pre-computed insight widgets — including **cross-fleet benchmarks** — as **self-contained iframe embeds** in the **sa_portal** (app.serviceup) fleet manager portal. The sa_portal integration is a single `<iframe>` tag — the insights service owns both the data and the rendered UI.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Architecture Decision Record: Why This Stack](#2-architecture-decision-record)
3. [Phase 1: PDF-to-Structured-Data Pipeline](#3-phase-1-pdf-to-structured-data-pipeline)
4. [Data Model: Hybrid PostgreSQL + JSONB + pgvector](#4-data-model-hybrid-postgresql--jsonb--pgvector)
5. [Phase 2: Metrics Module & RAG Retrieval](#5-phase-2-metrics-module--rag-retrieval)
6. [Phase 3: LLM-Powered Insights Engine](#6-phase-3-llm-powered-insights-engine)
7. [Phase 4: Embeddable Widgets + sa_portal Integration](#7-phase-4-embeddable-widgets--sa_portal-integration)
8. [Phase 5: Nightly Continuous Pipeline](#8-phase-5-nightly-continuous-pipeline)
9. [Tech Stack & Project Setup](#9-tech-stack--project-setup)
10. [Existing Codebase Integration Points](#10-existing-codebase-integration-points)
11. [Step-by-Step Build Instructions (Phase 1)](#11-step-by-step-build-instructions-phase-1)
12. [Appendix A: Zod Schema](#appendix-a-zod-schema)
13. [Appendix B: System Prompt](#appendix-b-system-prompt)
14. [Future Roadmap (v2+)](#future-roadmap-v2)

---

## 1. Architecture Overview

The system is self-contained: `serviceup-insights` owns **both the backend AND the frontend rendering**. The sa_portal integration is a single iframe per widget — no React components, no API clients, no dependencies to install in the main repo.

**Stack: just 2 services** — PostgreSQL (with pgvector) and the insights TypeScript service. No Cube, no Chroma, no Python sidecars.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  sa_portal (app.serviceup) — Fleet Manager Portal                       │
│                                                                         │
│  /insights page (minimal — just iframes)                                │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  <iframe src="https://insights.serviceup.com/embed/dashboard      │ │
│  │          ?fleetId=123&token=abc" />                                │ │
│  │                                                                    │ │
│  │  OR individual widgets:                                            │ │
│  │                                                                    │ │
│  │  <iframe src=".../embed/widget/parts-trend?fleetId=123" />        │ │
│  │  <iframe src=".../embed/widget/labor-rates?fleetId=123" />        │ │
│  │  <iframe src=".../embed/widget/shop-comparison?fleetId=123" />    │ │
│  │  <iframe src=".../embed/widget/narrative?fleetId=123" />          │ │
│  │  ...                                                               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                          │ iframe src                                    │
└──────────────────────────┼──────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     serviceup-insights (NEW REPO)                       │
│                     Serves BOTH data + rendered UI                       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  EMBED LAYER (serves fully-rendered HTML widgets)                 │   │
│  │                                                                   │   │
│  │  GET /embed/dashboard?fleetId=X&token=T  → full grid of widgets  │   │
│  │  GET /embed/widget/:type?fleetId=X&token=T → single widget HTML  │   │
│  │                                                                   │   │
│  │  Each response is a complete HTML page:                           │   │
│  │  - Inline CSS (MUI-compatible theme or standalone)                │   │
│  │  - Chart.js rendered client-side                                  │   │
│  │  - Self-contained — no external dependencies for the consumer     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  metrics.ts (typed query module — replaces Cube)                  │   │
│  │                                                                   │   │
│  │  getAvgLaborRateByShop(fleetId, period)                          │   │
│  │  getPartsCostTrend(fleetId, period)                               │   │
│  │  getTopReplacedParts(fleetId, limit)                              │   │
│  │  getCostBreakdown(fleetId, period)                                │   │
│  │  getAnomalies(fleetId, stddevThreshold)                           │   │
│  │  ...                                                              │   │
│  │                                                                   │   │
│  │  Direct Prisma queries — fully typed, no YAML, no extra service   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  LLM Insights Engine (Gemini / Claude)                            │   │
│  │                                                                   │   │
│  │  Consumes: metrics from metrics.ts + RAG context from pgvector   │   │
│  │  Generates: narratives, anomaly alerts, recommendations           │   │
│  │  Stores: pre-computed widgets in insight_cache                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  JSON API (internal — used by embed layer, not by sa_portal)     │   │
│  │  GET  /api/v1/widgets?fleetId=X&period=90d     → JSON            │   │
│  │  GET  /api/v1/health                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               │                                          │
│                               ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL + JSONB + pgvector (SINGLE DATA STORE)                │   │
│  │                                                                   │   │
│  │  Relational data:                                                 │   │
│  │    parsed_invoices, parsed_invoice_line_items,                    │   │
│  │    parsed_invoice_services, insight_cache                         │   │
│  │                                                                   │   │
│  │  Vector embeddings (pgvector):                                    │   │
│  │    invoice_embeddings table                                       │   │
│  │    - embedding VECTOR(768)  (Gemini text-embedding-004)           │   │
│  │    - JOIN-able with parsed_invoices for fleet/shop filtering      │   │
│  │    - Cosine similarity search: ORDER BY embedding <=> query_vec   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Main App Data (via Metabase API → BigQuery Stitch replica)       │   │
│  │  requests, shops, vehicles, fleets, fleetVehicles                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### How it all connects

1. **PDF Ingestion Pipeline**: Downloads PDFs from Firebase Storage, sends them to Gemini 2.5 Flash for extraction, stores structured output in PostgreSQL (JSONB) and embeds invoice text as vectors via pgvector — all in the same database.
2. **metrics.ts**: A typed TypeScript module with functions like `getAvgLaborRateByShop()` that run direct Prisma queries against PostgreSQL. No YAML config, no extra service — just functions. This replaces the Cube semantic layer.
3. **pgvector**: Stores vector embeddings of invoice text (corrections, complaints, notes) in an `invoice_embeddings` table. When the LLM generates insights, we run a cosine similarity query JOINed with fleet/shop filters to retrieve relevant context — all in a single SQL query.
4. **LLM Insights Engine**: Consumes pre-computed metrics from `metrics.ts` + relevant context from pgvector to generate narrative insights, anomaly alerts, and recommendations. Stores results in `insight_cache`.
5. **Embed Layer**: Reads from `insight_cache` and renders fully self-contained HTML pages — complete with inline CSS, charts, and data. Each widget is a standalone HTML page served at a URL.
6. **sa_portal**: Drops iframes pointing at the embed URLs. Zero React components, zero API clients, zero npm dependencies from the insights service. One `<iframe>` tag per widget.

---

## 2. Architecture Decision Record

### Why PostgreSQL + JSONB (not pure relational, not MongoDB, not pure document store)

**The problem**: Shop invoice PDFs are wildly varied. One shop has 3 data fields, another has 40. A pure relational schema with 60+ nullable columns is 80% NULLs. A pure document store (MongoDB) makes cross-invoice analytics harder (aggregations, GROUP BY, JOINs).

**The solution**: Hybrid. A thin relational skeleton for fields we *know* we'll query frequently (request_id, shop_id, fleet_id, grand_total, item_type, unit_price) combined with JSONB columns for everything sparse and shop-specific.

**Why not MongoDB**: We need relational aggregations ("average alternator price across shops"), foreign-key links back to main app entities (request_id, shop_id, fleet_id), and the team already runs PostgreSQL. MongoDB would add infrastructure complexity with no clear upside.

**Why not pure relational**: Too rigid for sparse, varied data. Every new field from a new shop format would require a migration. JSONB absorbs new fields naturally.

### Why a typed metrics module (not Cube Core or any semantic layer)

**The problem Cube solves**: When an LLM generates raw SQL at runtime, it can hallucinate column names, misdefine metrics, or write incorrect JOINs. A semantic layer constrains what the LLM can query.

**Why that doesn't apply to us**: Our LLM never generates SQL. Our architecture is: (1) our TypeScript code runs pre-written queries via Prisma, (2) feeds the results as context into an LLM prompt, (3) the LLM generates prose narratives and insights. The "hallucinated SQL" risk doesn't exist because the LLM never touches the database.

**The solution**: A simple `metrics.ts` module with typed functions like `getAvgLaborRateByShop(fleetId, period)`. Same metric definitions, no YAML config, no extra Docker container, no REST API hop. Fully type-safe with Prisma. If the schema changes, update one function — same effort as updating a Cube YAML file, but without the indirection.

**What we evaluated**: Cube Core (Apache 2.0), dbt MetricFlow (requires dbt project), Wren AI (full product, not a library). All designed for the "LLM generates queries at runtime" pattern. We don't have that pattern.

### Why pgvector (not Chroma or a separate vector DB)

**The problem**: The LLM needs relevant context when generating insights — actual invoice text, correction descriptions, technician notes. We need semantic search to retrieve the most relevant documents.

**The solution**: pgvector — a PostgreSQL extension that adds vector similarity search. Our vectors live in the same database as our relational data.

**Why not Chroma**: Chroma adds another Docker container, another data store to sync, another client library. At our scale (~150-10K invoices), pgvector performance is sub-100ms. More importantly, pgvector lets us JOIN vector similarity results with relational filters in a single SQL query: "find semantically similar invoices *for this specific fleet*" is one query, not a metadata filter on a separate system.

**Why not Qdrant / Weaviate / Pinecone**: Same argument — all add infrastructure for a problem PostgreSQL can solve natively at our scale. If we grow to millions of documents, we can migrate. For now, fewer moving parts wins.

### What we explicitly chose NOT to use

- **Cube Core / dbt MetricFlow / Wren AI**: Semantic layers solve "LLM generates SQL at runtime." Our LLM generates prose from pre-fetched data. No runtime SQL generation = no need for a semantic layer.
- **Chroma / Qdrant / Weaviate**: Separate vector DBs add infrastructure. pgvector gives us vectors + relational JOINs in one system at our scale.
- **Vanna AI**: Text-to-SQL via natural language is out of scope. The goal is pre-computed insight widgets, not an ad-hoc query interface.
- **Pinecone / managed vector DBs**: Unnecessary cost and vendor lock-in at this scale.

---

## 3. Phase 1: PDF-to-Structured-Data Pipeline

### 3.1 Input: Invoice Volume

**Current scale**: ~9,000+ invoices already in the system, with ~600 new invoices arriving per day (~18,000/month, ~220,000/year).

**Seed data** (for initial development/testing): A Google Sheet (`1OW3BqToe_gM0fJmsBsTC_1nI5dFhEwWja5p_JcCtfHg`) with ~219 rows (~150+ with actual PDF links) for bootstrapping.

**Ongoing source**: The main ServiceUp `requests` table (accessed via Metabase API → BigQuery Stitch replica), which holds all invoice PDF URLs. The nightly pipeline (Phase 5) queries this for any new requests with PDF URLs not yet parsed.

- **Columns** (Google Sheet): `request_id`, `invoice_url`, `clickable_invoice_url`
- **URL pattern**: `https://firebasestorage.googleapis.com/v0/b/serviceupios.appspot.com/o/request-data%2F...`

### 3.2 PDF Format Diversity (from sample analysis)

We analyzed multiple PDFs and found **significant variation**:

**PDF Type A — Simple Mobile Shop (e.g., Modern Mobile Tire)**
- Single-page, minimal line items
- Fields: Shop info, invoice #, RO #, vehicle (make/model/year/VIN), odometer, single labor line, shop supplies fee, subtotal + tax + grand total, approval timestamp

**PDF Type B — Commercial Fleet Service (e.g., Pacific Fleet Services)**
- Multi-page, complex
- Fields: Shop info, bill-to/ship-to/remit-to addresses, invoice #, SO #, PO #, terms (Net 30), due date, vehicle (unit #/VIN/plate/mileage), complaint/cause/correction structure per service, labor hours + rate per job, individual part numbers + costs, shop supplies, discount/fee percentages, detailed work descriptions with completion dates, warranty text

**Other expected variations**: tire shops (per-tire pricing), body shops (paint hours, materials), general repair (diagnostic fees, fluid charges), dealer service departments (OEM parts with markup).

### 3.3 The LLM Parsing Approach

Following the **exact pattern** of the existing CCC PDF parser (`/backend/src/cccPdfProcessor/`):

1. Use **Gemini 2.5 Flash** with `temperature: 0` and **structured output via Zod schema**
2. Use a **3-turn conversation**: system prompt → sample PDF → target PDF
3. Use a **comprehensive Zod schema** that captures ALL possible fields (fields can be null/optional)
4. Store the `createdByLlmModel` on every record for traceability
5. **After parsing**: embed text content (corrections, complaints, notes, raw_text) into pgvector for future semantic retrieval

### 3.4 The System Prompt Strategy

Unlike CCC (which is one specific format), shop invoices are wildly varied. The system prompt must:

1. Explain that the PDF is a shop repair invoice/estimate (could be any format)
2. Instruct the LLM to extract EVERY piece of data it can find
3. Map it to a predefined schema with many optional fields
4. Be explicit about: "If a field is not present in the PDF, set it to null. If a field exists but you're uncertain, extract your best interpretation and set the confidence field."
5. Provide 2-3 sample PDFs of different formats in the few-shot context to demonstrate variety

---

## 4. Data Model: Hybrid PostgreSQL + JSONB

The key design insight: **relational columns for what you query across invoices, JSONB for everything else.**

### 4.1 Schema

```sql
-- ============================================================
-- parsed_invoices: One row per PDF
-- Thin relational core + fat JSONB for sparse document data
-- ============================================================
CREATE TABLE parsed_invoices (
  id                    SERIAL PRIMARY KEY,

  -- Relational core (always present, heavily queried, JOIN keys)
  request_id            INTEGER NOT NULL,
  shop_id               INTEGER,
  vehicle_id            INTEGER,
  fleet_id              INTEGER,
  pdf_url               TEXT NOT NULL,
  pdf_type              VARCHAR(50),             -- 'invoice', 'estimate', 'work_order'
  parse_status          VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- Promoted fields: we KNOW we'll filter/aggregate on these
  invoice_date          DATE,
  grand_total_cents     INTEGER,
  labor_total_cents     INTEGER,
  parts_total_cents     INTEGER,
  tax_amount_cents      INTEGER,
  pdf_shop_name         VARCHAR(500),
  pdf_vin               VARCHAR(20),
  payment_terms         VARCHAR(100),

  -- THE BIG ONE: entire LLM extraction lives here
  -- Contains: all document IDs, dates, shop info, customer info,
  -- vehicle info, financial totals, approval info, warranty text,
  -- notes, and ANY other data the LLM found.
  extracted_data        JSONB NOT NULL DEFAULT '{}',

  -- Parser metadata
  parse_meta            JSONB,
  -- Contains: { llm_model, prompt_tokens, response_tokens,
  --             elapsed_ms, confidence, parse_error, parsed_at }

  -- Raw fallbacks (zero data loss guarantee)
  raw_extracted_text    TEXT,                    -- full text from PDF
  raw_llm_response      JSONB,                  -- complete LLM output

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(request_id, pdf_url)
);

-- ============================================================
-- parsed_invoice_line_items: Individual parts, labor, fees
-- Relational because cross-invoice analytics ARE the use case
-- ============================================================
CREATE TABLE parsed_invoice_line_items (
  id                    SERIAL PRIMARY KEY,
  parsed_invoice_id     INTEGER NOT NULL REFERENCES parsed_invoices(id) ON DELETE CASCADE,
  parsed_service_id     INTEGER REFERENCES parsed_invoice_services(id) ON DELETE CASCADE,

  -- Core queryable fields (relational)
  item_type             VARCHAR(50) NOT NULL,    -- 'labor', 'part', 'fee', 'shop_supply',
                                                  -- 'tire', 'fluid', 'filter', 'sublet',
                                                  -- 'discount', 'misc', 'unknown'
  name                  VARCHAR(500) NOT NULL,
  quantity              DECIMAL(8,2) DEFAULT 1,
  unit_price_cents      INTEGER,
  total_price_cents     INTEGER,

  -- Type-specific data lives in JSONB (sparse, varies by item_type)
  item_data             JSONB NOT NULL DEFAULT '{}',
  -- For a part:  { "part_number": "8400251", "brand": "Denso", "is_oem": true,
  --               "is_aftermarket": false, "is_used": false, "source": "OEM dealer" }
  -- For labor:   { "hours": 2.0, "rate_per_hour": 155.00, "type": "mechanical",
  --               "technician": "Joe M.", "completion_date": "2026-02-17" }
  -- For a tire:  { "size": "265/70R17", "brand": "Michelin", "model": "Defender",
  --               "position": "LF" }
  -- For fluid:   { "type": "engine_oil", "quantity": 6, "unit": "quarts",
  --               "brand": "Mobil 1", "weight": "5W-30" }
  -- For sublet:  { "vendor": "Joe's Alignment", "description": "4-wheel alignment" }

  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- parsed_invoice_services: Job/complaint groupings (optional)
-- Only populated when the PDF groups work into named services
-- ============================================================
CREATE TABLE parsed_invoice_services (
  id                    SERIAL PRIMARY KEY,
  parsed_invoice_id     INTEGER NOT NULL REFERENCES parsed_invoices(id) ON DELETE CASCADE,

  -- Core queryable field
  service_name          VARCHAR(500),

  -- Everything else in JSONB (complaint, cause, correction, approval, etc.)
  service_data          JSONB NOT NULL DEFAULT '{}',
  -- Contains: { "complaint": "...", "cause": "...", "correction": "...",
  --             "is_approved": true, "completion_date": "2026-02-13",
  --             "service_code": "ALT-001", "subtotal": 570.38 }

  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- insight_cache: Pre-computed insights, ready to serve as widgets
-- ============================================================
CREATE TABLE insight_cache (
  id                    SERIAL PRIMARY KEY,

  fleet_id              INTEGER,                 -- null = global insight
  shop_id               INTEGER,                 -- null = cross-shop insight

  insight_type          VARCHAR(100) NOT NULL,
  insight_key           VARCHAR(255),            -- unique key for dedup

  title                 VARCHAR(500) NOT NULL,
  summary               TEXT NOT NULL,
  detail_json           JSONB NOT NULL,          -- structured data for chart rendering

  widget_type           VARCHAR(50),             -- 'chart_line', 'chart_bar', 'chart_pie',
                                                  -- 'chart_area', 'stat_card', 'table',
                                                  -- 'narrative', 'alert', 'comparison_table'
  widget_config         JSONB,                   -- rendering config (colors, labels, axes)

  valid_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until           TIMESTAMPTZ,

  priority              INTEGER DEFAULT 3,       -- 1=urgent, 5=low (matches API contract)
  audience              VARCHAR(50) DEFAULT 'all',  -- 'executive', 'operations', 'compliance', 'all'
                                                     -- v2: filter widgets by role
  generated_by_model    VARCHAR(100),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(insight_key)
);

-- ============================================================
-- invoice_embeddings: pgvector embeddings for semantic search
-- Vectors live alongside relational data — one DB, one query
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE invoice_embeddings (
  id                    SERIAL PRIMARY KEY,
  parsed_invoice_id     INTEGER NOT NULL REFERENCES parsed_invoices(id) ON DELETE CASCADE,
  chunk_type            VARCHAR(50) NOT NULL,    -- 'full_document', 'service_correction'
  chunk_text            TEXT NOT NULL,            -- the text that was embedded
  embedding             VECTOR(768) NOT NULL,    -- text-embedding-004 produces 768-dim vectors
  metadata              JSONB DEFAULT '{}',       -- { fleet_id, shop_id, service_name, ... }
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_invoices_request_id ON parsed_invoices(request_id);
CREATE INDEX idx_invoices_shop_id ON parsed_invoices(shop_id);
CREATE INDEX idx_invoices_fleet_id ON parsed_invoices(fleet_id);
CREATE INDEX idx_invoices_status ON parsed_invoices(parse_status);
CREATE INDEX idx_invoices_date ON parsed_invoices(invoice_date);
CREATE INDEX idx_invoices_extracted ON parsed_invoices USING GIN (extracted_data);

CREATE INDEX idx_items_invoice_id ON parsed_invoice_line_items(parsed_invoice_id);
CREATE INDEX idx_items_type ON parsed_invoice_line_items(item_type);
CREATE INDEX idx_items_name ON parsed_invoice_line_items(name);
CREATE INDEX idx_items_data ON parsed_invoice_line_items USING GIN (item_data);

CREATE INDEX idx_services_invoice_id ON parsed_invoice_services(parsed_invoice_id);

CREATE INDEX idx_cache_fleet ON insight_cache(fleet_id);
CREATE INDEX idx_cache_type ON insight_cache(insight_type);
CREATE INDEX idx_cache_key ON insight_cache(insight_key);

CREATE INDEX idx_embeddings_invoice ON invoice_embeddings(parsed_invoice_id);
CREATE INDEX idx_embeddings_type ON invoice_embeddings(chunk_type);
-- HNSW index: no need to retrain as data grows (unlike IVFFlat)
-- Optimal for our scale (9K+ docs growing to 200K+/year)
CREATE INDEX idx_embeddings_vector ON invoice_embeddings USING hnsw (embedding vector_cosine_ops);
```

### 4.2 Design Principles

1. **Zero data loss**: `extracted_data` JSONB absorbs everything the LLM extracts. No separate "extras" table needed — unexpected fields just land in the JSON naturally. `raw_llm_response` stores the complete LLM output as an ultimate fallback.

2. **No migrations for new fields**: When a new shop format has a `bay_number` or `epa_license`, it appears in `extracted_data` or `item_data` JSONB automatically. No schema change needed.

3. **Promote fields as patterns emerge**: Start with JSONB. After 6 months, if you constantly filter on `labor_hours`, promote it to a real column and backfill. This is the hybrid advantage: start flexible, harden incrementally.

4. **Line items stay relational**: Because "average alternator price across shops" = `SELECT name, AVG(unit_price_cents) FROM parsed_invoice_line_items WHERE item_type = 'part' GROUP BY name`. This is SQL's strength.

5. **Linkable to main DB**: `request_id`, `shop_id`, `vehicle_id`, `fleet_id` link back to the main ServiceUp database.

---

## 5. Phase 2: Metrics Module + Vector Embeddings

### 5.1 Typed Metrics Module (`src/metrics/`)

Instead of a separate semantic layer service, all metric queries are direct Prisma calls wrapped in typed, tested functions. This approach:
- Zero extra infrastructure (no Cube container, no YAML models)
- Full TypeScript type safety — the compiler catches bad field names, not a runtime API
- Easy to unit test with a seeded DB
- Easy to extend: just add a function

```typescript
// src/metrics/metrics.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Spending ───────────────────────────────────────────────
export async function getTotalSpend(fleetId: number, since: Date) {
  const result = await prisma.parsed_invoices.aggregate({
    _sum: { grand_total_cents: true },
    where: { fleet_id: fleetId, invoice_date: { gte: since }, parse_status: 'completed' },
  });
  return (result._sum.grand_total_cents ?? 0) / 100;
}

export async function getSpendByShop(fleetId: number, since: Date) {
  const rows = await prisma.$queryRaw<{ shop_name: string; total: number }[]>`
    SELECT pdf_shop_name AS shop_name, SUM(grand_total_cents) / 100.0 AS total
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId} AND invoice_date >= ${since} AND parse_status = 'completed'
    GROUP BY pdf_shop_name
    ORDER BY total DESC
  `;
  return rows;
}

// ── Labor ──────────────────────────────────────────────────
export async function getAvgLaborRateByShop(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ shop_name: string; avg_rate: number }[]>`
    SELECT pi.pdf_shop_name AS shop_name,
           AVG((li.item_data->>'rate_per_hour')::numeric) AS avg_rate
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND pi.invoice_date >= ${since}
      AND li.item_type = 'labor'
      AND li.item_data->>'rate_per_hour' IS NOT NULL
    GROUP BY pi.pdf_shop_name
    ORDER BY avg_rate DESC
  `;
}

// ── Parts ──────────────────────────────────────────────────
export async function getTopReplacedParts(fleetId: number, since: Date, limit = 10) {
  return prisma.$queryRaw<{ name: string; count: number; avg_cost: number }[]>`
    SELECT li.name, COUNT(*)::int AS count,
           AVG(li.unit_price_cents) / 100.0 AS avg_cost
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND pi.invoice_date >= ${since}
      AND li.item_type = 'part'
    GROUP BY li.name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

export async function getPartPriceTrend(fleetId: number, partName: string, since: Date) {
  return prisma.$queryRaw<{ month: string; avg_price: number; count: number }[]>`
    SELECT TO_CHAR(pi.invoice_date, 'YYYY-MM') AS month,
           AVG(li.unit_price_cents) / 100.0 AS avg_price,
           COUNT(*)::int AS count
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND pi.invoice_date >= ${since}
      AND li.item_type = 'part'
      AND li.name ILIKE ${'%' + partName + '%'}
    GROUP BY month
    ORDER BY month
  `;
}

// ── Cost Breakdown ─────────────────────────────────────────
export async function getCostBreakdown(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ category: string; total: number }[]>`
    SELECT
      CASE
        WHEN item_type = 'labor' THEN 'Labor'
        WHEN item_type = 'part' THEN 'Parts'
        WHEN item_type IN ('fee', 'shop_supply', 'hazmat', 'environmental') THEN 'Fees'
        ELSE 'Other'
      END AS category,
      SUM(total_price_cents) / 100.0 AS total
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId} AND pi.invoice_date >= ${since}
    GROUP BY category
    ORDER BY total DESC
  `;
}

// ── Anomalies ──────────────────────────────────────────────
export async function getAnomalies(fleetId: number, since: Date, stddevThreshold = 2) {
  return prisma.$queryRaw<{ invoice_id: number; name: string; price: number; avg: number; stddev: number }[]>`
    WITH stats AS (
      SELECT li.name,
             AVG(li.unit_price_cents) AS avg_price,
             STDDEV(li.unit_price_cents) AS stddev_price
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE pi.fleet_id = ${fleetId} AND pi.invoice_date >= ${since} AND li.item_type = 'part'
      GROUP BY li.name HAVING COUNT(*) >= 3
    )
    SELECT li.parsed_invoice_id AS invoice_id, li.name,
           li.unit_price_cents / 100.0 AS price,
           s.avg_price / 100.0 AS avg,
           s.stddev_price / 100.0 AS stddev
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    JOIN stats s ON li.name = s.name
    WHERE pi.fleet_id = ${fleetId}
      AND ABS(li.unit_price_cents - s.avg_price) > ${stddevThreshold} * s.stddev_price
    ORDER BY ABS(li.unit_price_cents - s.avg_price) DESC
    LIMIT 20
  `;
}

// ── Vehicle Health ─────────────────────────────────────────
export async function getVehicleRepairFrequency(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ vin: string; unit: string; repair_count: number; total_spend: number }[]>`
    SELECT pdf_vin AS vin,
           extracted_data->>'vehicle_unit' AS unit,
           COUNT(*)::int AS repair_count,
           SUM(grand_total_cents) / 100.0 AS total_spend
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId} AND invoice_date >= ${since} AND parse_status = 'completed'
    GROUP BY pdf_vin, extracted_data->>'vehicle_unit'
    ORDER BY repair_count DESC
  `;
}
// ── Cross-Fleet Benchmarks (50+ fleets) ────────────────────
// Anonymized percentiles across ALL fleets on the platform.
// The fleet manager sees where they stand; they never see other fleets' data.

export async function getFleetPercentiles(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    metric: string; fleet_value: number;
    p25: number; p50: number; p75: number; percentile_rank: number;
  }[]>`
    WITH fleet_metrics AS (
      SELECT fleet_id,
             AVG(grand_total_cents) / 100.0 AS avg_invoice_total,
             SUM(labor_total_cents) / 100.0 / NULLIF(COUNT(*), 0) AS avg_labor_per_invoice,
             SUM(parts_total_cents) / 100.0 / NULLIF(COUNT(*), 0) AS avg_parts_per_invoice
      FROM parsed_invoices
      WHERE invoice_date >= ${since} AND parse_status = 'completed'
      GROUP BY fleet_id
    ),
    percentiles AS (
      SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY avg_invoice_total) AS p25_total,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY avg_invoice_total) AS p50_total,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY avg_invoice_total) AS p75_total
      FROM fleet_metrics
    )
    SELECT
      'avg_invoice_total' AS metric,
      fm.avg_invoice_total AS fleet_value,
      p.p25_total AS p25, p.p50_total AS p50, p.p75_total AS p75,
      PERCENT_RANK() OVER (ORDER BY fm.avg_invoice_total) AS percentile_rank
    FROM fleet_metrics fm, percentiles p
    WHERE fm.fleet_id = ${fleetId}
  `;
}

export async function getLaborRateBenchmark(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    fleet_avg_rate: number; platform_avg_rate: number;
    platform_p25: number; platform_p75: number; pct_diff: number;
  }[]>`
    WITH fleet_rates AS (
      SELECT pi.fleet_id,
             AVG((li.item_data->>'rate_per_hour')::numeric) AS avg_rate
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE li.item_type = 'labor'
        AND li.item_data->>'rate_per_hour' IS NOT NULL
        AND pi.invoice_date >= ${since}
      GROUP BY pi.fleet_id
    )
    SELECT
      f.avg_rate AS fleet_avg_rate,
      AVG(a.avg_rate) AS platform_avg_rate,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY a.avg_rate) AS platform_p25,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY a.avg_rate) AS platform_p75,
      ((f.avg_rate - AVG(a.avg_rate)) / NULLIF(AVG(a.avg_rate), 0) * 100) AS pct_diff
    FROM fleet_rates f, fleet_rates a
    WHERE f.fleet_id = ${fleetId}
    GROUP BY f.avg_rate
  `;
}

export async function getPartCostBenchmark(fleetId: number, partName: string, since: Date) {
  return prisma.$queryRaw<{
    fleet_avg_cost: number; platform_avg_cost: number;
    pct_diff: number; fleet_count: number;
  }[]>`
    SELECT
      AVG(CASE WHEN pi.fleet_id = ${fleetId} THEN li.unit_price_cents END) / 100.0 AS fleet_avg_cost,
      AVG(li.unit_price_cents) / 100.0 AS platform_avg_cost,
      ((AVG(CASE WHEN pi.fleet_id = ${fleetId} THEN li.unit_price_cents END) - AVG(li.unit_price_cents))
        / NULLIF(AVG(li.unit_price_cents), 0) * 100) AS pct_diff,
      COUNT(DISTINCT pi.fleet_id)::int AS fleet_count
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE li.item_type = 'part'
      AND li.name ILIKE ${'%' + partName + '%'}
      AND pi.invoice_date >= ${since}
  `;
}
```

Each function is focused, composable, and easy to test. The insight engine (Phase 3) calls these functions to gather data before prompting the LLM.

### 5.2 pgvector — Semantic Search in PostgreSQL

Vectors live in the `invoice_embeddings` table (see Section 4 data model). During PDF ingestion, the raw text and service corrections are embedded and stored right next to the relational data.

**Embedding during ingestion** (`src/ingestion/embedder.ts`):

```typescript
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const prisma = new PrismaClient();
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const embedModel = genai.getGenerativeModel({ model: 'text-embedding-004' });

export async function embedInvoice(invoiceId: number, rawText: string, metadata: Record<string, any>) {
  const result = await embedModel.embedContent(rawText);
  const embedding = result.embedding.values;  // number[] of length 768

  await prisma.$executeRaw`
    INSERT INTO invoice_embeddings (parsed_invoice_id, chunk_type, chunk_text, embedding, metadata)
    VALUES (${invoiceId}, 'full_document', ${rawText}, ${embedding}::vector, ${metadata}::jsonb)
  `;
}

export async function embedServiceCorrection(
  invoiceId: number, serviceId: number, correction: string, metadata: Record<string, any>
) {
  const result = await embedModel.embedContent(correction);
  const embedding = result.embedding.values;

  await prisma.$executeRaw`
    INSERT INTO invoice_embeddings (parsed_invoice_id, chunk_type, chunk_text, embedding, metadata)
    VALUES (${invoiceId}, 'service_correction', ${correction}, ${embedding}::vector, ${metadata}::jsonb)
  `;
}
```

**Similarity search for insight generation** (`src/intelligence/vectorRetriever.ts`):

```typescript
export async function findSimilarInvoices(query: string, fleetId: number, limit = 10) {
  const result = await embedModel.embedContent(query);
  const queryVec = result.embedding.values;

  // pgvector + relational JOIN in a single query — this is the advantage
  return prisma.$queryRaw<{ invoice_id: number; chunk_text: string; similarity: number }[]>`
    SELECT e.parsed_invoice_id AS invoice_id,
           e.chunk_text,
           1 - (e.embedding <=> ${queryVec}::vector) AS similarity
    FROM invoice_embeddings e
    JOIN parsed_invoices pi ON e.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
    ORDER BY e.embedding <=> ${queryVec}::vector
    LIMIT ${limit}
  `;
}
```

The key advantage over a separate vector DB: filtering by `fleet_id`, `shop_id`, `invoice_date`, or any relational column is a standard SQL `WHERE` clause in the same query — no separate metadata filtering system.

---

## 6. Phase 3: LLM-Powered Insights Engine

### 6.1 Insight Generation Pipeline

The insights engine combines fleet-specific metrics, cross-fleet benchmarks, semantic context, and external safety data, then filters through a quality gate before caching:

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ metrics.ts    │ │ benchmarks   │ │ pgvector     │ │ NHTSA        │
│ (fleet-level) │ │ (cross-fleet)│ │ (semantic)   │ │ (recalls)    │
│               │ │              │ │              │ │              │
│ getAvgLabor() │ │ getFleet     │ │ findSimilar()│ │ checkRecalls │
│ getTopParts() │ │ Percentiles()│ │ → repair ctx │ │ → open       │
│ getAnomalies()│ │ getLaborRate  │ │ → corrections│ │   recalls    │
│ getCostBreak()│ │ Benchmark()  │ │              │ │   by VIN     │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │                 │
       └────────────────┴────────────────┴─────────────────┘
                                │
                                ▼
                  ┌──────────────────────────┐
                  │  LLM (Gemini 2.5 Flash)  │
                  │  Generate N candidates   │
                  │  with savings estimates, │
                  │  counterfactual framing, │
                  │  + benchmark comparisons │
                  └──────────┬───────────────┘
                             ▼
                  ┌──────────────────────────┐
                  │  LLM-as-Judge            │
                  │  (quality gate)          │
                  │                          │
                  │  Filter: non-obvious,    │
                  │  actionable, high-conf,  │
                  │  non-redundant           │
                  └──────────┬───────────────┘
                             ▼
                  ┌──────────────────────────┐
                  │  insight_cache table      │
                  │  (ready to serve as       │
                  │   iframe widgets)        │
                  └──────────────────────────┘
```

### 6.2 Insight Types

| Insight Type | Data Sources | Widget Type | Example |
|---|---|---|---|
| Parts price trend | `getPartPriceTrend()` | Line chart | "Brake pad costs increased 15% in Q4" |
| Shop rate comparison | `getAvgLaborRateByShop()` | Bar chart | "Routing to Shop B could save ~$3,600/yr on labor" |
| Anomaly alert | `getAnomalies()` + pgvector context | Alert card | "RO #112766 alternator $260 — 40% above fleet avg" |
| Top replaced parts | `getTopReplacedParts()` | Table | "Top 5: Brake pads, oil filters, alternators..." |
| Cost breakdown | `getCostBreakdown()` | Pie chart | "62% labor, 28% parts, 10% fees" |
| Vehicle health | `getVehicleRepairFrequency()` | Stat card | "Unit DORS103: 4 repairs in 3 months" |
| Narrative summary | Multiple metrics + pgvector | Rich text | "This month: $45K spend, tire costs spiked 20%..." |
| Seasonal pattern | `getPartPriceTrend()` by month | Area chart | "Brake repairs peak Oct-Nov" |
| Shop recommendation | `getSpendByShop()` + per-part costs | Comparison table | "If last 6 alternator jobs went to Shop B → saved $1,840" |
| **NHTSA recall alert** | NHTSA API + VIN match | Alert card (P1) | "Unit DORS103 has open recall #21V-XXX for brake master cylinder" |
| **Cross-fleet benchmark** | `getFleetPercentiles()` + `getLaborRateBenchmark()` | Stat card / bar chart | "Your avg labor rate is in the 78th percentile across 50+ fleets" |
| **Part cost benchmark** | `getPartCostBenchmark()` | Comparison table | "You pay 23% above platform avg for alternators ($340 vs $276)" |

### 6.3 LLM Insight Prompt Pattern

```
You are a fleet maintenance analytics expert. Generate {N} actionable insights.

FLEET: {fleet_name} ({vehicle_count} vehicles, {shop_count} shops)
PERIOD: {start_date} to {end_date}

METRICS (from typed queries):
{metrics_json}

RELEVANT REPAIR CONTEXT (from semantic search):
{pgvector_retrieved_docs}

CROSS-FLEET BENCHMARKS (anonymized, 50+ fleets on platform):
{benchmark_data}

NHTSA RECALL ALERTS (if any):
{nhtsa_recall_data}

RULES:
1. Every shop comparison MUST include a counterfactual savings calculation.
   Example: "If your last 6 alternator jobs had gone to Shop B instead of Shop A,
   you would have saved $1,840." Calculate real dollar amounts from the data.
2. Frame insights as forward-looking recommendations, not just observations.
   BAD: "Shop A charges 15% more than Shop B."
   GOOD: "Routing alternator jobs to Shop B could save ~$300/job. Based on your
   current volume, that's ~$3,600/year."
3. When cross-fleet benchmarks are available, always tell the fleet manager where they
   stand relative to the platform. "Your labor costs are in the 78th percentile" is
   more actionable than "your labor costs are $165/hr."
4. If NHTSA recalls match any vehicles in the fleet, flag them as priority 1.
5. For anomaly alerts, explain the likely cause based on repair context.

For each insight, return JSON:
{
  "title": "short, actionable — max 10 words",
  "summary": "2-3 sentences explaining the insight AND what to do about it",
  "savings_estimate_cents": null | number,  // estimated annual savings if acted upon
  "widget_type": "chart_line | chart_bar | chart_pie | stat_card | table | narrative | alert",
  "detail_json": { ... structured data for rendering ... },
  "priority": 1-5 (1 = most urgent),
  "audience": "executive | operations | compliance | all"
}
```

### 6.4 LLM-as-Judge Quality Filter

Before caching, every batch of generated insights goes through a second LLM pass that acts as a quality gate. This is a cheap call (evaluating text, not generating from raw data) but dramatically improves signal-to-noise.

```typescript
// src/intelligence/insightJudge.ts

const judgePrompt = `
You are a quality reviewer for fleet maintenance insights. You will receive {N} candidate
insights generated for a fleet manager. Evaluate EACH one and return ONLY those that pass
ALL of these criteria:

1. NON-OBVIOUS: Would not be apparent from a simple table or summary
2. ACTIONABLE: The fleet manager can actually do something concrete about it
3. HIGH-CONFIDENCE: Supported by at least 3 data points (not a fluke)
4. NON-REDUNDANT: Not substantially covered by another insight in this batch
5. SIGNIFICANT: Dollar impact > $100 or safety/compliance impact

For each candidate, return:
{
  "insight_index": number,
  "keep": boolean,
  "reason": "1 sentence explaining why kept or cut"
}

CANDIDATES:
{candidate_insights_json}
`;
```

**Flow**:
1. Insight generator produces N candidate insights (e.g., 15)
2. Judge evaluates all 15 → keeps ~5-8 high-quality insights
3. Only the survivors get upserted into `insight_cache`

This prevents the dashboard from filling up with low-value observations like "you had 42 invoices this month" or redundant variants of the same shop comparison.

### 6.5 NHTSA Recall Enrichment

Before generating insights, cross-reference all fleet VINs against the NHTSA Recalls API (free, public, no auth required). Recall matches become priority-1 compliance alerts.

```typescript
// src/intelligence/nhtsaRecalls.ts

const NHTSA_API = 'https://api.nhtsa.gov/recalls/recallsByVehicle';

export async function checkRecalls(vehicles: { vin: string; make: string; model: string; year: string }[]) {
  const recalls: RecallAlert[] = [];

  for (const v of vehicles) {
    const url = `${NHTSA_API}?make=${v.make}&model=${v.model}&modelYear=${v.year}`;
    const resp = await fetch(url);
    const data = await resp.json();

    for (const recall of data.results) {
      recalls.push({
        vin: v.vin,
        nhtsaCampaignNumber: recall.NHTSACampaignNumber,
        component: recall.Component,
        summary: recall.Summary,
        consequence: recall.Consequence,
        remedy: recall.Remedy,
        manufacturer: recall.Manufacturer,
      });
    }
  }
  return recalls;
}
```

**How it feeds into insights**: Recall data is injected into the LLM prompt as `{nhtsa_recall_data}`. The prompt rules (Section 6.3) instruct the LLM to flag any matching vehicles as priority 1 compliance alerts. Example output: *"Unit DORS103 (2019 Ford Transit) has an open NHTSA recall (#21V-XXX) for brake master cylinder failure. Your recent brake repairs may be related — confirm with your shop."*

Recall checks run once per nightly cycle. Results are cached for 7 days to avoid hammering the API.

---

## 7. Phase 4: Embeddable Widgets + sa_portal Integration

### 7.1 Embed Architecture

The insights service serves **fully-rendered HTML pages** at embed URLs. Each page is self-contained: inline CSS, inline JS, chart rendering, data — everything needed to display the widget. The consumer (sa_portal) just points an iframe at the URL.

**Two embed modes**:

| Mode | URL | Use Case |
|---|---|---|
| Full dashboard | `GET /embed/dashboard?fleetId=X&token=T` | One iframe, all widgets in a responsive grid |
| Single widget | `GET /embed/widget/:type?fleetId=X&token=T` | One iframe per widget, position however you want |

### 7.2 Embed URLs

```
# Full dashboard (all widgets for a fleet)
/embed/dashboard?fleetId=123&period=90d&token=abc123

# Individual widgets
/embed/widget/parts-trend?fleetId=123&token=abc123
/embed/widget/labor-rates?fleetId=123&token=abc123
/embed/widget/shop-comparison?fleetId=123&token=abc123
/embed/widget/narrative-summary?fleetId=123&token=abc123
/embed/widget/anomaly-alerts?fleetId=123&token=abc123
/embed/widget/top-parts?fleetId=123&token=abc123
/embed/widget/vehicle-health?fleetId=123&token=abc123
/embed/widget/cost-breakdown?fleetId=123&token=abc123
/embed/widget/fleet-benchmark?fleetId=123&token=abc123

# Optional query params (all widgets)
&period=30d|90d|180d|365d      # time range (default: 90d)
&theme=light|dark               # match sa_portal theme
&shopId=456                     # filter to specific shop
```

### 7.3 What Each Embed Response Looks Like

Each `/embed/widget/:type` URL returns a complete HTML page:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* Self-contained CSS — no external stylesheets */
    /* MUI-compatible design tokens (colors, fonts, spacing) */
    body { margin: 0; font-family: 'Inter', sans-serif; background: transparent; }
    .widget { padding: 16px; border-radius: 8px; }
    .widget-title { font-size: 14px; font-weight: 600; color: #1a1a1a; }
    .widget-summary { font-size: 13px; color: #666; margin-top: 4px; }
    /* Chart styles, table styles, alert styles, etc. */
  </style>
</head>
<body>
  <div class="widget" data-type="parts-trend" data-fleet-id="123">
    <div class="widget-title">Brake Pad Costs Up 15%</div>
    <div class="widget-summary">Average cost increased from $42 to $48 over the last 90 days across 3 shops.</div>
    <canvas id="chart"></canvas>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script>
    // Chart.js rendering with pre-baked data from insight_cache
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: /* server-injected JSON from insight_cache.detail_json */,
      options: { /* pre-configured */ }
    });
  </script>
</body>
</html>
```

### 7.4 Auth: Embed Tokens

The sa_portal backend generates short-lived embed tokens that the insights service validates. This prevents unauthorized access to fleet data.

```typescript
// sa_portal backend (or shared auth service) generates token:
const token = jwt.sign(
  { fleetId: 123, exp: Math.floor(Date.now() / 1000) + 3600 },  // 1hr TTL
  SHARED_EMBED_SECRET
);

// insights service validates on every /embed/* request:
app.use('/embed', (req, res, next) => {
  const { token } = req.query;
  const payload = jwt.verify(token, SHARED_EMBED_SECRET);
  req.fleetId = payload.fleetId;
  next();
});
```

**Alternative (simpler for v1)**: Use a shared API key in the token param. Less secure, but faster to ship. Upgrade to JWT later.

### 7.5 sa_portal Changes (in main repo) — Minimal

The whole point of the iframe approach: **minimal changes to sa_portal**.

```
sa_portal changes:
├── app/(authenticated)/insights/page.tsx    ← NEW (just iframes)
├── .env                                      ← add NEXT_PUBLIC_INSIGHTS_URL
└── sidebar nav                               ← add "Insights" link
```

That's it. No new API clients, no new npm packages, no shared types.

**The insights page** (`portals/apps/sa_portal/app/(authenticated)/insights/page.tsx`):

```tsx
// Option A: Full dashboard embed (one iframe, simplest)
export default function InsightsPage() {
  const fleetId = useCurrentFleet();  // however sa_portal gets the fleet context
  const token = useEmbedToken(fleetId);  // fetch from sa_portal backend
  const baseUrl = process.env.NEXT_PUBLIC_INSIGHTS_URL;

  return (
    <iframe
      src={`${baseUrl}/embed/dashboard?fleetId=${fleetId}&token=${token}`}
      style={{ width: '100%', height: '100vh', border: 'none' }}
      title="Fleet Insights"
    />
  );
}

// Option B: Individual widget iframes (more control over layout)
export default function InsightsPage() {
  const fleetId = useCurrentFleet();
  const token = useEmbedToken(fleetId);
  const baseUrl = process.env.NEXT_PUBLIC_INSIGHTS_URL;
  const widgetUrl = (type: string) =>
    `${baseUrl}/embed/widget/${type}?fleetId=${fleetId}&token=${token}`;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, p: 3 }}>
      <iframe src={widgetUrl('parts-trend')} style={{ height: 300, border: 'none' }} />
      <iframe src={widgetUrl('labor-rates')} style={{ height: 300, border: 'none' }} />
      <iframe src={widgetUrl('shop-comparison')} style={{ height: 300, border: 'none' }} />
      <iframe src={widgetUrl('narrative-summary')} style={{ height: 300, border: 'none' }} />
      <iframe src={widgetUrl('anomaly-alerts')} style={{ height: 300, border: 'none' }} />
      <iframe src={widgetUrl('cost-breakdown')} style={{ height: 300, border: 'none' }} />
    </Box>
  );
}
```

### 7.6 JSON API (Internal)

The JSON API still exists — it's used internally by the embed layer to fetch data. It can also be used directly if someone later wants to build custom frontends.

```typescript
// GET /api/v1/widgets?fleetId={id}&period=90d → JSON array of InsightWidget
interface InsightWidget {
  id: string;
  type: 'chart_line' | 'chart_bar' | 'chart_pie' | 'chart_area'
      | 'stat_card' | 'table' | 'narrative' | 'alert' | 'comparison_table';
  title: string;
  summary: string;
  priority: number;
  config: {
    data: any[];
    xKey?: string;
    yKey?: string;
    labels?: string[];
    colors?: string[];
    columns?: { key: string; label: string }[];
  };
  generatedAt: string;
}

// GET /api/v1/metrics?fleetId={id}&type={spend|labor|parts|anomalies}&period=90d
// GET /api/v1/health
```

---

## 8. Phase 5: Pipeline Architecture

The service has **two pipeline modes**: an initial backfill (run once) and a nightly incremental pipeline (runs daily). Both share the same ingestion/insight code — the only difference is which invoices they pull from BigQuery.

### 8.1 Initial Backfill (run once on first deploy)

```
yarn backfill
│
├─▶ 1. FETCH ALL: Query BigQuery for all requests with invoicepdfurl (~26,757 records)
│
├─▶ 2. INGEST IN BATCHES: Process in batches of INSIGHTS_BATCH_SIZE (default 10, configurable)
│      For each batch:
│        a. Download PDFs from Firebase Storage
│        b. Gemini 2.5 Flash structured extraction (temperature: 0, Zod schema)
│        c. Store parsed data in PostgreSQL + embed via pgvector
│        d. Track progress (checkpoint after each batch so it can resume on failure)
│      Estimated time: ~15-20 hours for 26K PDFs (Gemini rate-limited)
│      Can be parallelized by fleet if needed
│
├─▶ 3. ENRICH + INSIGHTS: Same as nightly steps 2-3 below
│
└─▶ 4. LOG: Write backfill completion timestamp to pipeline_state table
```

**Resumability:** The backfill script tracks which request IDs have already been processed. If it crashes at request #8,000, restarting picks up at #8,001. This is critical — you don't want to re-parse 8,000 PDFs because of a transient error.

```typescript
// scripts/backfill.ts
import { getAllInvoices } from '../src/ingestion/mainDbClient';
import { processBatch } from '../src/ingestion/batchRunner';

async function backfill() {
  const allInvoices = await getAllInvoices();
  const alreadyParsed = await getAlreadyParsedRequestIds(); // SELECT request_id FROM parsed_invoices
  const remaining = allInvoices.filter(inv => !alreadyParsed.has(inv.id));

  console.log(`Backfill: ${remaining.length} invoices remaining (${alreadyParsed.size} already done)`);

  const batchSize = parseInt(process.env.INSIGHTS_BATCH_SIZE || '10');
  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize);
    await processBatch(batch);
    console.log(`Progress: ${Math.min(i + batchSize, remaining.length)}/${remaining.length}`);
  }
}
```

### 8.2 Nightly Incremental Pipeline (11pm UTC daily)

```
CRON (11pm UTC nightly)
│
├─▶ 1. INGEST: Query BigQuery for new requests with PDF URLs since last successful run
│      For each: download PDF → Gemini extraction → store in PostgreSQL + embed via pgvector
│      (~600 new invoices/day — takes ~30-45 min)
│
├─▶ 2. ENRICH:
│      a. Check NHTSA Recalls API for all active fleet VINs (cache 7 days)
│      b. Compute cross-fleet benchmark percentiles (platform-wide aggregates)
│
├─▶ 3. INSIGHTS: For each active fleet:
│      a. Pull fleet-specific metrics via metrics.ts functions
│      b. Pull cross-fleet benchmarks (percentiles, rate comparisons)
│      c. Retrieve semantic context via pgvector similarity search
│      d. Inject NHTSA recall data for fleet vehicles
│      e. Generate N candidate insights (Gemini 2.5 Flash) with savings estimates
│      f. Run LLM-as-judge quality filter → keep only high-quality insights
│      g. Store survivors in insight_cache (upsert by insight_key)
│
├─▶ 4. CLEANUP: Expire old insights (valid_until < now)
│
└─▶ 5. CHECKPOINT: Update pipeline_state with last_successful_run timestamp
```

### 8.3 Pipeline State Tracking

```sql
-- Tracks pipeline execution state for incremental processing
CREATE TABLE pipeline_state (
  id              SERIAL PRIMARY KEY,
  pipeline_name   VARCHAR(50) UNIQUE NOT NULL,   -- 'nightly_ingest', 'backfill'
  last_success_at TIMESTAMPTZ,                    -- watermark for incremental queries
  last_run_at     TIMESTAMPTZ,
  last_status     VARCHAR(20),                    -- 'success', 'failed', 'running'
  records_processed INTEGER DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO pipeline_state (pipeline_name) VALUES ('nightly_ingest'), ('backfill');
```

The nightly pipeline reads `last_success_at` from `pipeline_state` to determine the watermark for `getNewInvoicesSince()`. This means if a nightly run fails, the next run picks up everything since the last *successful* run — no data loss.

### Connecting to Main App Data

**Decision: Query via Metabase API** — Metabase proxies native SQL to BigQuery (`stitch__serviceup__prod_us` dataset, Stitch replica of main DB, ~2 min sync lag).

**Why this approach:**
- The main ServiceUp production DB is already replicated to BigQuery via Stitch, with near real-time sync
- The insights service cannot access BigQuery directly (no GCP service account available from the deployment environment)
- Metabase is already connected to BigQuery (database ID: 34) and accessible via API token
- No load on the production PostgreSQL database whatsoever
- No new users/grants needed on the production database
- Metabase acts as a network proxy — the SQL queries are the same BigQuery SQL, just routed through Metabase's `/api/dataset` endpoint

**Verified data availability** (as of 2026-02-20):
- `stitch__serviceup__prod_us.requests` — 92,732 rows, 26,757 with `invoicepdfurl`
- `stitch__serviceup__prod_us.shops` — shop names, fleet associations
- `stitch__serviceup__prod_us.vehicles` — VIN, make, model, year (for NHTSA recalls)
- `stitch__serviceup__prod_us.fleets` — fleet names
- `stitch__serviceup__prod_us.fleetVehicles` — fleet-to-vehicle mapping

> **Note:** Stitch lowercases all column names (e.g., `invoicePdfUrl` → `invoicepdfurl`, `shopId` → `shopid`).

**Setup:** Just two env vars — the Metabase URL and API token.

```bash
METABASE_URL=https://<your-metabase-instance>
METABASE_API_KEY=<your-api-token>
METABASE_DATABASE_ID=34                    # BigQuery connection in Metabase
```

**Sample fetcher code:**

```typescript
// src/ingestion/mainDbClient.ts
import axios from 'axios';

const METABASE_URL = process.env.METABASE_URL!;
const METABASE_API_KEY = process.env.METABASE_API_KEY!;
const METABASE_DB_ID = parseInt(process.env.METABASE_DATABASE_ID || '34');
const DATASET = 'stitch__serviceup__prod_us';

interface MetabaseQueryResult {
  data: {
    rows: any[][];
    cols: { name: string }[];
  };
}

/**
 * Execute a native SQL query via Metabase API → BigQuery.
 */
async function queryViaMetabase(sql: string): Promise<Record<string, any>[]> {
  const response = await axios.post<MetabaseQueryResult>(
    `${METABASE_URL}/api/dataset`,
    {
      database: METABASE_DB_ID,
      type: 'native',
      native: { query: sql },
    },
    {
      headers: { 'x-api-key': METABASE_API_KEY },
      timeout: 120_000, // 2 min timeout for large queries
    }
  );

  const { cols, rows } = response.data.data;
  const colNames = cols.map(c => c.name);
  return rows.map(row =>
    Object.fromEntries(colNames.map((name, i) => [name, row[i]]))
  );
}

/**
 * Fetch new requests with invoice PDFs since the given timestamp.
 * Used by the nightly incremental pipeline.
 */
export async function getNewInvoicesSince(since: Date) {
  const sinceStr = since.toISOString();
  return queryViaMetabase(`
    SELECT r.id, r.invoicepdfurl, r.shopid, r.vehicleid, r.fleetid, r.createdat, r.status,
           s.name AS shop_name,
           v.vin, v.make, v.model, v.year AS vehicle_year,
           f.name AS fleet_name
    FROM \`${DATASET}.requests\` r
    LEFT JOIN \`${DATASET}.shops\` s ON r.shopid = s.id
    LEFT JOIN \`${DATASET}.vehicles\` v ON r.vehicleid = v.id
    LEFT JOIN \`${DATASET}.fleets\` f ON r.fleetid = f.id
    WHERE r.invoicepdfurl IS NOT NULL
      AND r._sdc_deleted_at IS NULL
      AND r.createdat > '${sinceStr}'
    ORDER BY r.createdat ASC
  `);
}

/**
 * Fetch ALL requests with invoice PDFs.
 * Used by the one-time initial backfill only.
 * Note: ~26,757 rows — Metabase handles this fine via native query.
 */
export async function getAllInvoices() {
  return queryViaMetabase(`
    SELECT r.id, r.invoicepdfurl, r.shopid, r.vehicleid, r.fleetid, r.createdat, r.status,
           s.name AS shop_name,
           v.vin, v.make, v.model, v.year AS vehicle_year,
           f.name AS fleet_name
    FROM \`${DATASET}.requests\` r
    LEFT JOIN \`${DATASET}.shops\` s ON r.shopid = s.id
    LEFT JOIN \`${DATASET}.vehicles\` v ON r.vehicleid = v.id
    LEFT JOIN \`${DATASET}.fleets\` f ON r.fleetid = f.id
    WHERE r.invoicepdfurl IS NOT NULL
      AND r._sdc_deleted_at IS NULL
    ORDER BY r.createdat ASC
  `);
}

/**
 * Fetch all fleet vehicles with VINs for NHTSA recall checks.
 */
export async function getFleetVehicles(fleetId: number) {
  return queryViaMetabase(`
    SELECT v.id, v.vin, v.make, v.model, v.year AS vehicle_year
    FROM \`${DATASET}.fleetVehicles\` fv
    JOIN \`${DATASET}.vehicles\` v ON fv.vehicleid = v.id
    WHERE fv.fleetid = ${fleetId}
      AND v.vin IS NOT NULL
  `);
}
```

**What the pipeline reads (via Metabase → BigQuery):**

| Table | Columns Used | Purpose |
|-------|-------------|---------|
| `requests` | `id`, `invoicepdfurl`, `shopid`, `vehicleid`, `fleetid`, `createdat`, `status` | PDF URLs + request metadata |
| `shops` | `id`, `name` | Shop names for insights |
| `vehicles` | `id`, `vin`, `make`, `model`, `year` | VIN decoding + NHTSA recalls |
| `fleets` | `id`, `name` | Fleet scoping |
| `fleetVehicles` | `fleetid`, `vehicleid` | Fleet-to-vehicle mapping |

**Future upgrade path:** If direct BigQuery or PG connectivity becomes available, swap the `queryViaMetabase()` implementation in `mainDbClient.ts` — the exported function signatures stay the same, no callers need to change.

---

## 9. Tech Stack & Project Setup

### 9.1 Repo Structure

```
serviceup-insights/
├── package.json
├── tsconfig.json
├── .env.example
├── Dockerfile
├── docker-compose.yml              # PostgreSQL (pgvector) + insights service
│
├── prisma/
│   └── schema.prisma               # Insights DB schema
│
├── src/                             # Main TypeScript service
│   ├── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   └── prisma.ts
│   ├── ingestion/
│   │   ├── mainDbClient.ts          # Metabase API client — queries Stitch replica via Metabase
│   │   ├── pdfFetcher.ts            # Download from Firebase
│   │   ├── pdfParser.ts             # Gemini + Zod structured extraction
│   │   ├── schema.ts                # Zod output schema
│   │   ├── systemPrompt.ts          # LLM system prompt
│   │   ├── normalizer.ts            # LLM output → DB rows
│   │   ├── embedder.ts              # pgvector: embed parsed text
│   │   └── batchRunner.ts           # Orchestrate batch processing
│   ├── metrics/
│   │   └── metrics.ts               # Typed Prisma metric functions
│   ├── intelligence/
│   │   ├── vectorRetriever.ts       # pgvector similarity search
│   │   ├── nhtsaRecalls.ts          # NHTSA Recalls API integration
│   │   ├── benchmarks.ts            # Cross-fleet benchmark aggregation
│   │   ├── llmAnalyzer.ts           # LLM insight generation
│   │   ├── insightJudge.ts          # LLM-as-judge quality filter
│   │   └── insightPrompts.ts        # Prompt templates
│   ├── embed/                           # Embed layer (serves rendered HTML widgets)
│   │   ├── routes/
│   │   │   ├── dashboard.ts         # GET /embed/dashboard — full grid page
│   │   │   └── widget.ts            # GET /embed/widget/:type — single widget
│   │   ├── templates/
│   │   │   ├── layout.ts            # Base HTML shell (head, styles, scripts)
│   │   │   ├── chartWidget.ts       # Chart.js line/bar/pie/area template
│   │   │   ├── statCard.ts          # Stat card template
│   │   │   ├── tableWidget.ts       # Table template
│   │   │   ├── narrativeWidget.ts   # Rich text narrative template
│   │   │   ├── alertWidget.ts       # Anomaly alert template
│   │   │   └── dashboardGrid.ts     # Full dashboard grid layout
│   │   ├── styles/
│   │   │   └── theme.ts             # Inline CSS (MUI-compatible tokens)
│   │   └── auth/
│   │       └── embedToken.ts        # JWT validation for embed requests
│   ├── api/
│   │   ├── server.ts                # Express HTTP server (serves /embed + /api)
│   │   ├── routes/
│   │   │   ├── widgets.ts           # GET /api/v1/widgets (JSON)
│   │   │   ├── metrics.ts           # GET /api/v1/metrics (calls metrics.ts module)
│   │   │   └── health.ts
│   │   └── middleware/
│   │       └── auth.ts
│   ├── jobs/
│   │   ├── nightlyPipeline.ts
│   │   └── scheduler.ts
│   └── scripts/
│       ├── seedFromGsheet.ts         # One-time: import Google Sheet
│       └── backfill.ts               # One-time: parse all historical PDFs
│
├── test/
│   └── ...
└── README.md
```

### 9.2 Dependencies

```json
{
  "dependencies": {
    "@langchain/google-genai": "latest",
    "@langchain/core": "latest",
    "zod": "^3.x",
    "@prisma/client": "^6.x",
    "express": "^4.x",
    "jsonwebtoken": "^9.x",
    "@google/generative-ai": "latest",
    "pgvector": "^0.2.x",
    "firebase-admin": "^12.x",
    "node-cron": "^3.x",
    "dotenv": "^16.x",
    "axios": "^1.x",
    "csv-parse": "^5.x",
    "winston": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "prisma": "^6.x",
    "tsx": "^4.x",
    "@types/express": "^4.x",
    "@types/node": "latest",
    "vitest": "^2.x"
  }
}
```

### 9.3 docker-compose.yml (2 services)

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16          # PostgreSQL 16 with pgvector pre-installed
    environment:
      POSTGRES_DB: serviceup_insights
      POSTGRES_USER: insights
      POSTGRES_PASSWORD: insights
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  insights:
    build: .
    ports: ["4050:4050"]
    environment:
      DATABASE_URL: postgresql://insights:insights@postgres:5432/serviceup_insights
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      EMBED_SECRET: ${EMBED_SECRET}
    depends_on: [postgres]

volumes:
  pgdata:
```

### 9.4 Environment Variables

```bash
# Insights DB
DATABASE_URL=postgresql://insights:insights@localhost:5432/serviceup_insights

# Metabase API — proxies to BigQuery (Stitch replica of main DB)
# See "Connecting to Main App Data" section for details
METABASE_URL=https://<your-metabase-instance>
METABASE_API_KEY=<your-api-token>
METABASE_DATABASE_ID=34

# Firebase
FIREBASE_SERVICE_ACCOUNT_KEY=<json>
FIREBASE_STORAGE_BUCKET=serviceupios.appspot.com

# Gemini
GEMINI_API_KEY=...

# API + Embed
PORT=4050
API_KEY=...
EMBED_SECRET=...                    # shared with sa_portal for JWT embed tokens

# Processing
INSIGHTS_BATCH_SIZE=10
INSIGHTS_MAX_RETRIES=3
```

---

## 10. Existing Codebase Integration Points

### 10.1 What to Read from the Main ServiceUp DB

```sql
SELECT
  r.id as request_id,
  r."shopId" as shop_id,
  r."vehicleId" as vehicle_id,
  r."fleetId" as fleet_id,
  r."invoicePdfUrl",
  r."advisorsEstimatePdfUrl",
  r."advisorsInvoicePdfUrl",
  r."shopWorkOrderPdfUrl",
  r.status,
  r."totalPrice",
  r."paidAt",
  r."closedAt",
  s.name as shop_name,
  v.vin,
  v.make as vehicle_make,
  v.model as vehicle_model,
  v.year as vehicle_year
FROM requests r
LEFT JOIN shops s ON r."shopId" = s.id
LEFT JOIN vehicles v ON r."vehicleId" = v.id
WHERE (
  r."invoicePdfUrl" IS NOT NULL
  OR r."advisorsEstimatePdfUrl" IS NOT NULL
  OR r."shopWorkOrderPdfUrl" IS NOT NULL
)
```

### 10.2 Existing Patterns to Follow

| Pattern | Source in Main Repo | Apply To |
|---|---|---|
| LLM PDF parsing (Gemini + Zod) | `backend/src/cccPdfProcessor/llm/GeminiPdfParser.ts` | PDF parsing pipeline |
| Structured output schema | `backend/src/cccPdfProcessor/llm/structuredOutputSchema.ts` | Zod schema design |
| Firebase Storage download | `backend/src/pdf/pdf.service.ts` (`getPdfFromUrl`) | PDF fetching |
| BullMQ job processing | `backend/src/cccPdfProcessor/cccPdfParser.processor.ts` | Job orchestration pattern |
| Insights API design | `backend/src/insights/insights.controller.ts` | API endpoint patterns |
| Metabase embed pattern | `portals/apps/sa_portal/app/(authenticated)/(dashboard)/page.tsx` | iframe embed reference |

### 10.3 Firebase Storage Access

PDFs are in Firebase Cloud Storage bucket `serviceupios.appspot.com`:
```
https://firebasestorage.googleapis.com/v0/b/serviceupios.appspot.com/o/request-data%2F{guid}%2F...?alt=media&token=...
```

The insights service needs a Firebase service account key (same as the backend uses).

---

## 11. Step-by-Step Build Instructions (Phase 1)

**Phase 1 scope: Run the initial backfill to parse all ~26,757 existing invoices (via Metabase API → BigQuery) into structured data + pgvector embeddings. The Google Sheet (~150 PDFs) is used for development/testing only. The nightly pipeline (Phase 5) handles the ongoing ~600/day volume.**

### Step 1: Project Scaffolding
1. Initialize a new TypeScript Node.js project with `package.json`
2. Set up Prisma with PostgreSQL
3. Create the database schema (tables from Section 4)
4. Set up `tsx` for running TypeScript directly
5. Set up `docker-compose.yml` with PostgreSQL (pgvector)

### Step 2: Google Sheet Import Script (`scripts/seedFromGsheet.ts`)
1. Export the Google Sheet as CSV
2. Parse CSV to extract `request_id` and `invoice_url` pairs
3. For each row with a URL, query via Metabase API (BigQuery Stitch replica) to get `shop_id`, `vehicle_id`, `fleet_id`, shop name, vehicle info
4. Insert into `parsed_invoices` table with `parse_status = 'pending'`

### Step 3: PDF Fetcher (`src/ingestion/pdfFetcher.ts`)
1. Initialize Firebase Admin SDK with service account
2. Given a Firebase Storage URL, download the PDF as a Buffer
3. Convert to base64 for LLM API
4. Handle errors (404, auth failures, corrupt PDFs)

### Step 4: Zod Schema (`src/ingestion/schema.ts`)
1. Define comprehensive Zod schema (see Appendix A)
2. All fields optional except `is_valid_invoice: boolean`
3. Include `extras` array catch-all
4. Include `raw_text` field for full text extraction

### Step 5: System Prompt (`src/ingestion/systemPrompt.ts`)
1. Write detailed system prompt (see Appendix B)
2. Include 2-3 sample PDFs of different formats for few-shot context
3. Specify edge cases: multi-page, handwritten, watermarks

### Step 6: LLM Parser (`src/ingestion/pdfParser.ts`)
1. Initialize `ChatGoogleGenerativeAI` with `gemini-2.5-flash`, `temperature: 0`
2. Use `.withStructuredOutput(zodSchema)`
3. Build 3-turn conversation (system → sample PDF → target PDF)
4. Log token counts, elapsed time, confidence

### Step 7: Normalizer + pgvector Embedder (`src/ingestion/normalizer.ts`, `embedder.ts`)
1. Map Zod-validated LLM output to database inserts:
   - `parsed_invoices` record (promoted fields + full LLM output as `extracted_data` JSONB)
   - `parsed_invoice_services` records: iterate `services[]` array, store each as a row with `service_data` JSONB
   - `parsed_invoice_line_items` records: iterate `services[].line_items[]`, store each as a row with:
     - `parsed_service_id` = the parent service's DB id
     - Core fields (`item_type`, `name`, `quantity`, `unit_price_cents`, `total_price_cents`)
     - Everything else → `item_data` JSONB (Zod field names map 1:1 to JSONB keys, e.g. `hours`, `rate_per_hour`, `is_oem`)
   - If the LLM returns line items NOT nested under a service, create a default "General Service" parent
2. Convert dollar amounts to cents (multiply by 100, round to integer)
3. Embed `raw_text` + service corrections via pgvector (see `embedder.ts` in Section 5.2)

### Step 8: Batch Runner (`src/ingestion/batchRunner.ts`)
1. Query `parsed_invoices` where `parse_status = 'pending'`
2. Process in batches of `INSIGHTS_BATCH_SIZE` (default 10)
3. For each: fetch PDF → parse with LLM → normalize → store in PG + embed via pgvector
4. Update `parse_status` to `completed` or `failed`
5. Log progress and metrics
6. 1-second delay between LLM calls to respect rate limits

### Step 9: Run the Batch
```bash
# Start infrastructure
docker compose up -d postgres

# Set up the database
npx prisma migrate dev

# Import the Google Sheet data
npx tsx src/scripts/seedFromGsheet.ts

# Run the parser
npx tsx src/ingestion/batchRunner.ts
```

### Step 10: Verify & Analyze
1. Query the database to verify structured data quality
2. Spot-check JSONB fields: `SELECT extracted_data FROM parsed_invoices LIMIT 5`
3. Check `parse_status = 'failed'` rows and review errors
4. Sample-check a few invoices against original PDFs
5. Test pgvector retrieval: `SELECT chunk_text FROM invoice_embeddings ORDER BY embedding <=> '[query_vector]' LIMIT 5`

---

## Appendix A: Zod Schema

```typescript
import { z } from 'zod';

const lineItemSchema = z.object({
  item_type: z.enum([
    'labor', 'part', 'fee', 'shop_supply', 'hazmat', 'environmental',
    'sublet', 'tire', 'fluid', 'filter', 'discount', 'tax', 'misc', 'unknown'
  ]),
  name: z.string(),
  description: z.string().nullable().optional(),

  // Pricing (always extract if present)
  quantity: z.number().default(1),
  unit_price: z.number().nullable().optional(),
  total_price: z.number().nullable().optional(),

  // Type-specific fields (all go into item_data JSONB)
  part_number: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),             // stored as item_data.brand in JSONB
  is_oem: z.boolean().nullable().optional(),            // stored as item_data.is_oem in JSONB
  is_aftermarket: z.boolean().nullable().optional(),   // stored as item_data.is_aftermarket in JSONB
  is_used: z.boolean().nullable().optional(),          // stored as item_data.is_used in JSONB
  is_remanufactured: z.boolean().nullable().optional(),
  source: z.string().nullable().optional(),             // stored as item_data.source in JSONB

  hours: z.number().nullable().optional(),             // stored as item_data.hours in JSONB
  rate_per_hour: z.number().nullable().optional(),     // stored as item_data.rate_per_hour in JSONB
  labor_type: z.string().nullable().optional(),
  technician: z.string().nullable().optional(),         // stored as item_data.technician in JSONB

  tire_size: z.string().nullable().optional(),
  tire_brand: z.string().nullable().optional(),
  tire_model: z.string().nullable().optional(),
  tire_position: z.string().nullable().optional(),

  fluid_type: z.string().nullable().optional(),
  fluid_quantity: z.number().nullable().optional(),
  fluid_unit: z.string().nullable().optional(),

  operation_type: z.string().nullable().optional(),
  repair_area: z.string().nullable().optional(),

  is_sublet: z.boolean().default(false),
  sublet_vendor: z.string().nullable().optional(),

  sort_order: z.number().default(0),
});

const serviceSchema = z.object({
  service_name: z.string().nullable().optional(),
  service_description: z.string().nullable().optional(),
  service_code: z.string().nullable().optional(),
  complaint: z.string().nullable().optional(),
  cause: z.string().nullable().optional(),
  correction: z.string().nullable().optional(),
  is_approved: z.boolean().nullable().optional(),
  is_recommended: z.boolean().nullable().optional(),
  is_declined: z.boolean().nullable().optional(),
  completion_date: z.string().nullable().optional(),
  service_subtotal: z.number().nullable().optional(),
  line_items: z.array(lineItemSchema).default([]),
  sort_order: z.number().default(0),
});

const extraFieldSchema = z.object({
  field_name: z.string(),
  field_value: z.string(),
  field_category: z.enum(['shop', 'vehicle', 'customer', 'financial', 'service', 'misc']).default('misc'),
  source_location: z.string().nullable().optional(),
});

export const invoiceParseSchema = z.object({
  is_valid_invoice: z.boolean(),
  parse_confidence: z.number().min(0).max(1),

  // Document IDs
  invoice_number: z.string().nullable().optional(),
  work_order_number: z.string().nullable().optional(),
  repair_order_number: z.string().nullable().optional(),
  purchase_order_number: z.string().nullable().optional(),
  estimate_number: z.string().nullable().optional(),
  authorization_number: z.string().nullable().optional(),

  // Dates (ISO format)
  invoice_date: z.string().nullable().optional(),
  estimate_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  promise_date: z.string().nullable().optional(),
  date_in: z.string().nullable().optional(),
  date_out: z.string().nullable().optional(),

  // Shop
  shop_name: z.string().nullable().optional(),
  shop_address: z.string().nullable().optional(),
  shop_city: z.string().nullable().optional(),
  shop_state: z.string().nullable().optional(),
  shop_zip: z.string().nullable().optional(),
  shop_phone: z.string().nullable().optional(),
  shop_email: z.string().nullable().optional(),
  shop_website: z.string().nullable().optional(),

  // Customer
  customer_name: z.string().nullable().optional(),
  customer_address: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  bill_to_name: z.string().nullable().optional(),
  bill_to_address: z.string().nullable().optional(),
  ship_to_name: z.string().nullable().optional(),
  ship_to_address: z.string().nullable().optional(),
  remit_to_name: z.string().nullable().optional(),
  remit_to_address: z.string().nullable().optional(),

  // Vehicle
  vin: z.string().nullable().optional(),
  vehicle_year: z.string().nullable().optional(),
  vehicle_make: z.string().nullable().optional(),
  vehicle_model: z.string().nullable().optional(),
  vehicle_submodel: z.string().nullable().optional(),
  vehicle_engine: z.string().nullable().optional(),
  vehicle_color: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  vehicle_unit: z.string().nullable().optional(),
  mileage_in: z.number().nullable().optional(),
  mileage_out: z.number().nullable().optional(),

  // Financial totals (dollars)
  subtotal: z.number().nullable().optional(),
  labor_total: z.number().nullable().optional(),
  parts_total: z.number().nullable().optional(),
  fees_total: z.number().nullable().optional(),
  shop_supplies: z.number().nullable().optional(),
  hazmat_fees: z.number().nullable().optional(),
  environmental_fees: z.number().nullable().optional(),
  discount_amount: z.number().nullable().optional(),
  discount_percent: z.number().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  tax_rate_percent: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  balance_due: z.number().nullable().optional(),
  amount_paid: z.number().nullable().optional(),

  // Payment
  payment_terms: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),

  // Approval
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  customer_signature_present: z.boolean().default(false),

  // Terms
  warranty_text: z.string().nullable().optional(),
  terms_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),

  // Structured data
  services: z.array(serviceSchema).default([]),

  // Catch-all
  extras: z.array(extraFieldSchema).default([]),

  // Full text backup
  raw_text: z.string(),
});
```

---

## Appendix B: System Prompt

```
You are an expert automotive repair invoice data extraction system. Your job is to extract
EVERY piece of information from repair shop invoice/estimate PDFs into a structured format.

CRITICAL RULES:
1. Extract EVERYTHING. Do not skip any data point, no matter how minor.
2. If a field exists in the PDF but doesn't map to the schema, put it in the "extras" array.
3. If a field is not present in the PDF, set it to null.
4. Dollar amounts should be in dollars (e.g., 155.00 not 15500 cents).
5. Dates should be in ISO format (YYYY-MM-DD).
6. Extract the complete text of the document in "raw_text" as a safety net.
7. Set parse_confidence between 0 and 1 based on how confident you are in the extraction.

UNDERSTANDING INVOICE FORMATS:
- Every shop uses a different PDF format. There is NO standard.
- Some are simple (1 page, 1-2 line items). Others are complex (multi-page, detailed).
- Common patterns include:
  a) Header: shop info, customer info, vehicle info, invoice/RO/WO numbers
  b) Body: services with line items (labor + parts + fees)
  c) Footer: totals, tax, payment terms, signatures, warranty text
- Some shops use complaint/cause/correction format for each service
- Some shops list flat line items without grouping into services

LINE ITEM CLASSIFICATION:
- "labor": Any hourly work charge. Extract hours + rate if available.
- "part": Physical parts being replaced. Look for part numbers.
- "fee": Miscellaneous charges (shop supplies, disposal, admin).
- "shop_supply": Specifically labeled shop supply charges.
- "hazmat": Hazardous material disposal fees.
- "environmental": Environmental compliance fees.
- "sublet": Work sent to another shop/vendor.
- "tire": Tire-specific items. Capture size, brand, model, position if available.
- "fluid": Oils, coolants, brake fluid, etc. Capture type + quantity + unit.
- "filter": Oil, air, cabin, fuel filters.
- "discount": Negative line items reducing the total.
- "tax": Tax line items if broken out separately.
- "misc"/"unknown": Anything that doesn't fit the above categories.

SERVICE GROUPING:
- If the invoice groups work into named services/jobs/complaints, create a service entry
  for each and nest its line items under it.
- If the invoice lists flat line items without grouping, create a single service
  called "General Service" and put all line items under it.
- If complaint/cause/correction fields exist, capture them on the service.

VEHICLE INFO:
- VIN (17-character alphanumeric)
- Year, Make, Model, Submodel, Engine, Color
- License plate (may say "Tag" or "Plate")
- Fleet unit number (may say "Unit #" or "Fleet #")
- Mileage in/out (may say "Odometer")

FINANCIAL FIELDS:
- Look for subtotals, line totals, category totals (labor total, parts total)
- Look for discount amounts or percentages
- Look for tax amounts and tax rates
- Look for grand total, balance due, amount paid
- Look for payment terms (Net 30, Due on Receipt, etc.)

EXTRAS (catch-all):
For ANY data point you find that doesn't map to the schema, add it to extras with:
- field_name: descriptive name (e.g., "technician_id", "bay_number", "tag_number")
- field_value: the extracted value
- field_category: one of 'shop', 'vehicle', 'customer', 'financial', 'service', 'misc'
- source_location: where in the PDF you found it (e.g., "header", "line item 3", "footer")

Examples of extras: technician IDs, bay numbers, tag numbers, custom shop fields,
EPA numbers, license numbers, account numbers, payment references, advisor names, etc.
```

---

## Summary: Build Order

| Phase | Scope | Dependencies | Delivers |
|---|---|---|---|
| **Phase 1** | Parse seed ~150 PDFs → PostgreSQL + pgvector | Gemini API key, Firebase SA key, Metabase API key | Structured queryable dataset + vector embeddings |
| **Phase 2** | Build metrics.ts module + vector retriever | Phase 1 data in DB | Typed metric functions + semantic search |
| **Phase 3** | Build LLM insights engine + NHTSA enrichment + cross-fleet benchmarks + quality gate | Metrics + pgvector + Gemini + NHTSA API | High-quality insights with savings estimates + platform benchmarks |
| **Phase 4** | Embed layer + iframe integration in sa_portal | Insights API running | Fleet managers see widgets via `<iframe>` |
| **Phase 5** | Nightly pipeline (11pm UTC) for ~600 invoices/day | All phases | Self-sustaining system |

**Start with Phase 1.** It produces a standalone, valuable dataset. Each subsequent phase layers on top without requiring changes to previous phases.

---

## Future Roadmap (v2+)

These features are deliberately excluded from v1 but the data model is designed to support them. The `audience` column on `insight_cache` and the volume of data (~9,000+ invoices across 50+ fleets, growing at ~600/day) make all of these feasible once v1 is running.

### Shop Quality Scoring / First-Time Fix Rate
**Priority: High — biggest gap in v1.** The plan compares shops on price but not quality. Track re-repair rate: same vehicle, same system (brakes, electrical, etc.), returning within 30-60 days. *"Shop A charges 8% less on brake jobs, but has a 24% re-repair rate vs. Shop B's 6%. On a cost-per-successful-fix basis, Shop B is actually cheaper."* This is just a SQL query over `parsed_invoices` joining on `vehicle_id` + service category + rolling date window. Add `getFirstTimeFixRate(shopId, serviceCategory)` to metrics.ts and feed into the LLM prompt. This produces insights fleet managers genuinely didn't know.

### Multi-Step Chain-of-Thought Prompting
**Priority: High — directly improves insight quality.** Replace the current single-pass insight prompt with a multi-step approach: (1) **Summarize**: LLM describes exactly what the data shows, no judgment. (2) **Hypothesize**: Generate 3-5 hypotheses about what's driving patterns — "brake costs spiked — could be seasonality, a specific shop, or a vehicle model." (3) **Evaluate & Recommend**: For each hypothesis, check if the data supports it and what to do. (4) **Judge pass** (existing). Use Claude with extended thinking for this since it's nightly batch and latency doesn't matter. Especially powerful for anomaly explanations and compound patterns.

### Association Rule Mining for Predictive Patterns
**Priority: High — upgrades Vehicle Failure Risk Scoring.** Track which repairs tend to co-occur within 90 days on the same vehicle using SQL window functions: *"Vehicles that had water pump replacements have a 68% chance of needing thermostat work within 60 days. Unit DORS103 just had a water pump — consider pre-emptive thermostat inspection."* More powerful than simple frequency heuristics. Still just SQL, no ML pipeline.

### Delta Insights — Period-Over-Period Comparison
**Priority: Medium.** Every nightly run produces a snapshot, but v1 doesn't compare snapshots to each other. The highest-signal insights are often directional. Add a `prev_period_value` column to `insight_cache` and have the LLM explicitly reason about direction and velocity of change. *"Shop A's cost-per-repair increased 18% this quarter even though invoice volume is flat. This is new — it wasn't happening 6 months ago."*

### Insight Feedback Loop
**Priority: Medium — compounds over time.** Add thumbs up/down on each widget via PostMessage from iframe → sa_portal → API call back to insights service. Use feedback to: tune the judge prompt based on what humans found useful, personalize by fleet (some care more about compliance, others cost), and use high-rated insights as few-shot examples in future prompts. Maybe a week of work but value accumulates.

### Push Alerts for High-Priority Insights
**Priority: Medium — high business value, low effort.** Currently everything is pull (fleet manager visits dashboard). For priority-1 insights (NHTSA recalls, major cost anomalies, re-repair patterns), send a nightly email digest or webhook to Slack/Teams. Ensures critical insights get acted on rather than sitting unseen. Lightweight to implement — just a post-cache step in the nightly pipeline.

### External Pricing Benchmarks (Mitchell/Alldata)
**Priority: Low — paid APIs, high value.** Compare what fleets pay against industry-standard labor times and parts pricing. Mitchell1 and Alldata provide standard R&R labor hours by year/make/model. *"Your shop charged 4.5 hours for this job — Mitchell standard is 1.2 hours."* NAPA ProLink / RepairLink APIs offer wholesale parts pricing. These are paid B2B APIs but the insight value is enormous: market-relative benchmarking rather than fleet-relative. Evaluate ROI once v1 is generating revenue.

### Role-Personalized Views
**Priority: Low — build when demand arises.** The `audience` column on `insight_cache` is already in place. Add a `?role=executive|operations|compliance` param to embed URLs that filters which insights render. Executive sees cost trends and savings opportunities. Operations sees vehicle health and shop reliability. Compliance sees NHTSA recalls and documentation gaps.

### Predictive Cost Forecasting
**Priority: Low — needs 12+ months of data.** Once data maturity is there, exponential smoothing in TypeScript (or Prophet if we accept a Python sidecar) can project monthly spend. *"Based on historical patterns, expect ~$28K in maintenance spend next month."* Parked until seasonal patterns are actually observable in the data.
