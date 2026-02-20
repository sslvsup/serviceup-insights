import 'dotenv/config';
import { getPrisma } from '../db/prisma';
import { getNewInvoicesSince, getActiveFleetIds } from '../ingestion/mainDbClient';
import { processOne } from '../ingestion/batchRunner';
import { generateAndCacheInsights } from '../intelligence/llmAnalyzer';
import { logger } from '../utils/logger';
import { config } from '../config/env';

const PIPELINE_NAME = 'nightly_ingest';

async function getLastSuccessAt(): Promise<Date> {
  const prisma = getPrisma();
  const state = await prisma.pipelineState.findUnique({
    where: { pipelineName: PIPELINE_NAME },
  });
  // Default: 48 hours ago if never run
  return state?.lastSuccessAt ?? new Date(Date.now() - 48 * 60 * 60 * 1000);
}

async function updatePipelineState(status: 'running' | 'success' | 'failed', meta: Record<string, unknown> = {}) {
  const prisma = getPrisma();
  await prisma.pipelineState.upsert({
    where: { pipelineName: PIPELINE_NAME },
    create: {
      pipelineName: PIPELINE_NAME,
      lastRunAt: new Date(),
      lastStatus: status,
      ...(status === 'success' ? { lastSuccessAt: new Date() } : {}),
      metadata: meta as object,
    },
    update: {
      lastRunAt: new Date(),
      lastStatus: status,
      ...(status === 'success' ? { lastSuccessAt: new Date() } : {}),
      metadata: meta as object,
      updatedAt: new Date(),
    },
  });
}

/**
 * Run the nightly pipeline:
 * 1. Ingest new invoices from BigQuery (via Metabase)
 * 2. Parse them with Gemini
 * 3. Generate insights for all active fleets
 * 4. Expire stale insights
 */
export async function runNightlyPipeline(): Promise<void> {
  logger.info('=== Nightly pipeline starting ===');

  await updatePipelineState('running');

  try {
    const lastSuccessAt = await getLastSuccessAt();
    logger.info('Fetching new invoices', { since: lastSuccessAt.toISOString() });

    // ── Step 1: Ingest new invoices ────────────────────────────────────────
    let ingestCount = 0;
    let ingestFailed = 0;

    if (config.metabase.url && config.metabase.apiKey) {
      const newInvoices = await getNewInvoicesSince(lastSuccessAt);
      logger.info(`Found ${newInvoices.length} new invoices to process`);

      for (const inv of newInvoices) {
        const result = await processOne({
          requestId: Number(inv.id),
          pdfUrl: String(inv.invoicepdfurl),
          shopId: inv.shopid ? Number(inv.shopid) : null,
          vehicleId: inv.vehicleid ? Number(inv.vehicleid) : null,
          fleetId: inv.fleetid ? Number(inv.fleetid) : null,
          shopName: inv.shop_name ? String(inv.shop_name) : null,
          vehicleVin: inv.vin ? String(inv.vin) : null,
          vehicleMake: inv.make ? String(inv.make) : null,
          vehicleModel: inv.model ? String(inv.model) : null,
          vehicleYear: inv.vehicle_year ? String(inv.vehicle_year) : null,
        });

        if (result.status === 'success') ingestCount++;
        else if (result.status === 'failed') ingestFailed++;
      }

      logger.info('Ingest complete', { processed: ingestCount, failed: ingestFailed });
    } else {
      logger.warn('Metabase not configured — skipping new invoice ingestion');
    }

    // ── Step 2: Generate insights for all active fleets ────────────────────
    const prisma = getPrisma();

    // Get fleets that have parsed invoices
    const fleetRows = await prisma.parsedInvoice.groupBy({
      by: ['fleetId'],
      where: { fleetId: { not: null }, parseStatus: 'completed' },
    });
    const fleetIds = fleetRows.map((r) => r.fleetId!).filter(Boolean);

    logger.info(`Generating insights for ${fleetIds.length} fleets`);

    let insightCount = 0;
    for (const fleetId of fleetIds) {
      try {
        const cached = await generateAndCacheInsights(fleetId, '90d');
        insightCount += cached;
        logger.info(`Fleet ${fleetId}: ${cached} insights cached`);
      } catch (err) {
        logger.error('Failed to generate insights for fleet', {
          fleetId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 3: Expire stale insights ─────────────────────────────────────
    const expired = await prisma.insightCache.deleteMany({
      where: { validUntil: { lt: new Date() } },
    });
    logger.info('Expired stale insights', { count: expired.count });

    // ── Step 4: Checkpoint ────────────────────────────────────────────────
    await updatePipelineState('success', {
      invoices_ingested: ingestCount,
      ingestion_failed: ingestFailed,
      insights_cached: insightCount,
      fleets_processed: fleetIds.length,
      expired_insights: expired.count,
    });

    logger.info('=== Nightly pipeline complete ===', {
      invoices: ingestCount,
      insights: insightCount,
    });
  } catch (err) {
    logger.error('Nightly pipeline failed', { error: err instanceof Error ? err.message : String(err) });
    await updatePipelineState('failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// Allow running directly: npx tsx src/jobs/nightlyPipeline.ts
if (require.main === module) {
  runNightlyPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Pipeline failed', err);
      process.exit(1);
    });
}
