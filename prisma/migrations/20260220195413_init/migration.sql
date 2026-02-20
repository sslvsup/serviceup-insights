-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "parsed_invoices" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "shop_id" INTEGER,
    "vehicle_id" INTEGER,
    "fleet_id" INTEGER,
    "pdf_url" TEXT NOT NULL,
    "pdf_type" VARCHAR(50),
    "parse_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "invoice_date" DATE,
    "grand_total_cents" INTEGER,
    "labor_total_cents" INTEGER,
    "parts_total_cents" INTEGER,
    "tax_amount_cents" INTEGER,
    "pdf_shop_name" VARCHAR(500),
    "pdf_vin" VARCHAR(20),
    "payment_terms" VARCHAR(100),
    "extracted_data" JSONB NOT NULL DEFAULT '{}',
    "parse_meta" JSONB,
    "raw_llm_response" JSONB,
    "raw_extracted_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parsed_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parsed_invoice_services" (
    "id" SERIAL NOT NULL,
    "parsed_invoice_id" INTEGER NOT NULL,
    "service_name" VARCHAR(500),
    "service_data" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parsed_invoice_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parsed_invoice_line_items" (
    "id" SERIAL NOT NULL,
    "parsed_invoice_id" INTEGER NOT NULL,
    "parsed_service_id" INTEGER,
    "item_type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER,
    "total_price_cents" INTEGER,
    "item_data" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parsed_invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_cache" (
    "id" SERIAL NOT NULL,
    "fleet_id" INTEGER,
    "shop_id" INTEGER,
    "insight_type" VARCHAR(100) NOT NULL,
    "insight_key" VARCHAR(255),
    "title" VARCHAR(500) NOT NULL,
    "summary" TEXT NOT NULL,
    "detail_json" JSONB NOT NULL,
    "widget_type" VARCHAR(50),
    "widget_config" JSONB,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 3,
    "audience" VARCHAR(50) NOT NULL DEFAULT 'all',
    "generated_by_model" VARCHAR(100),
    "savings_estimate_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_embeddings" (
    "id" SERIAL NOT NULL,
    "parsed_invoice_id" INTEGER NOT NULL,
    "chunk_type" VARCHAR(50) NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_state" (
    "id" SERIAL NOT NULL,
    "pipeline_name" VARCHAR(50) NOT NULL,
    "last_success_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" VARCHAR(20),
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parsed_invoices_request_id_idx" ON "parsed_invoices"("request_id");

-- CreateIndex
CREATE INDEX "parsed_invoices_shop_id_idx" ON "parsed_invoices"("shop_id");

-- CreateIndex
CREATE INDEX "parsed_invoices_fleet_id_idx" ON "parsed_invoices"("fleet_id");

-- CreateIndex
CREATE INDEX "parsed_invoices_parse_status_idx" ON "parsed_invoices"("parse_status");

-- CreateIndex
CREATE INDEX "parsed_invoices_invoice_date_idx" ON "parsed_invoices"("invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "parsed_invoices_request_id_pdf_url_key" ON "parsed_invoices"("request_id", "pdf_url");

-- CreateIndex
CREATE INDEX "parsed_invoice_services_parsed_invoice_id_idx" ON "parsed_invoice_services"("parsed_invoice_id");

-- CreateIndex
CREATE INDEX "parsed_invoice_line_items_parsed_invoice_id_idx" ON "parsed_invoice_line_items"("parsed_invoice_id");

-- CreateIndex
CREATE INDEX "parsed_invoice_line_items_item_type_idx" ON "parsed_invoice_line_items"("item_type");

-- CreateIndex
CREATE INDEX "parsed_invoice_line_items_name_idx" ON "parsed_invoice_line_items"("name");

-- CreateIndex
CREATE UNIQUE INDEX "insight_cache_insight_key_key" ON "insight_cache"("insight_key");

-- CreateIndex
CREATE INDEX "insight_cache_fleet_id_idx" ON "insight_cache"("fleet_id");

-- CreateIndex
CREATE INDEX "insight_cache_insight_type_idx" ON "insight_cache"("insight_type");

-- CreateIndex
CREATE INDEX "invoice_embeddings_parsed_invoice_id_idx" ON "invoice_embeddings"("parsed_invoice_id");

-- CreateIndex
CREATE INDEX "invoice_embeddings_chunk_type_idx" ON "invoice_embeddings"("chunk_type");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_state_pipeline_name_key" ON "pipeline_state"("pipeline_name");

-- AddForeignKey
ALTER TABLE "parsed_invoice_services" ADD CONSTRAINT "parsed_invoice_services_parsed_invoice_id_fkey" FOREIGN KEY ("parsed_invoice_id") REFERENCES "parsed_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parsed_invoice_line_items" ADD CONSTRAINT "parsed_invoice_line_items_parsed_invoice_id_fkey" FOREIGN KEY ("parsed_invoice_id") REFERENCES "parsed_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parsed_invoice_line_items" ADD CONSTRAINT "parsed_invoice_line_items_parsed_service_id_fkey" FOREIGN KEY ("parsed_service_id") REFERENCES "parsed_invoice_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_embeddings" ADD CONSTRAINT "invoice_embeddings_parsed_invoice_id_fkey" FOREIGN KEY ("parsed_invoice_id") REFERENCES "parsed_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
