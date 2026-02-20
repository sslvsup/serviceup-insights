/**
 * backfill.ts — One-time: parse all historical invoices
 *
 * Usage:
 *   yarn backfill
 *   # or
 *   npx tsx src/scripts/backfill.ts
 *
 * This script:
 * 1. Fetches all requests with invoice PDFs from BigQuery (via Metabase API)
 * 2. For each request not already processed, inserts it with parse_status = 'pending'
 * 3. Processes all pending invoices in batches
 *
 * Resumable: if it crashes at invoice #8,000, restarting picks up at #8,001.
 * Already-completed invoices are skipped automatically.
 */
import 'dotenv/config';
import { getPrisma } from '../db/prisma';
import { getAllInvoices } from '../ingestion/mainDbClient';
import { processOne } from '../ingestion/batchRunner';
import { config } from '../config/env';
import { logger } from '../utils/logger';

async function backfill() {
  const prisma = getPrisma();
  const PIPELINE_NAME = 'backfill';

  await prisma.pipelineState.upsert({
    where: { pipelineName: PIPELINE_NAME },
    create: { pipelineName: PIPELINE_NAME, lastRunAt: new Date(), lastStatus: 'running' },
    update: { lastRunAt: new Date(), lastStatus: 'running', updatedAt: new Date() },
  });

  logger.info('=== Starting backfill ===');

  // Get all invoices from main DB
  logger.info('Fetching all invoices from BigQuery via Metabase...');
  const allInvoices = await getAllInvoices();
  logger.info(`Total invoices in main DB: ${allInvoices.length}`);

  // Get already-processed request IDs
  const processed = await prisma.parsedInvoice.findMany({
    where: { parseStatus: { in: ['completed', 'failed'] } },
    select: { requestId: true },
  });
  const processedIds = new Set(processed.map((p) => p.requestId));

  const remaining = allInvoices.filter((inv) => !processedIds.has(Number(inv.id)));
  logger.info(`Remaining to process: ${remaining.length} (${processedIds.size} already done)`);

  // Insert all remaining as 'pending' first (so progress is visible in DB)
  logger.info('Inserting pending records...');
  let pendingInserted = 0;
  for (const inv of remaining) {
    const requestId = Number(inv.id);
    const pdfUrl = String(inv.invoicepdfurl);
    if (!pdfUrl || !pdfUrl.startsWith('http')) continue;

    await prisma.parsedInvoice.upsert({
      where: { requestId_pdfUrl: { requestId, pdfUrl } },
      create: {
        requestId,
        shopId: inv.shopid ? Number(inv.shopid) : null,
        vehicleId: inv.vehicleid ? Number(inv.vehicleid) : null,
        fleetId: inv.fleetid ? Number(inv.fleetid) : null,
        pdfUrl,
        parseStatus: 'pending',
        pdfShopName: inv.shop_name ? String(inv.shop_name) : null,
        pdfVin: inv.vin ? String(inv.vin) : null,
        extractedData: {},
      },
      update: {},
    });
    pendingInserted++;
  }
  logger.info(`Inserted ${pendingInserted} pending records`);

  // Now process in batches
  const batchSize = config.processing.batchSize;
  let totalProcessed = 0;
  let totalFailed = 0;
  let offset = 0;

  while (true) {
    const pending = await prisma.parsedInvoice.findMany({
      where: { parseStatus: 'pending' },
      take: batchSize,
      skip: offset,
      orderBy: { requestId: 'asc' },
    });

    if (pending.length === 0) break;

    for (const inv of pending) {
      const result = await processOne({
        requestId: inv.requestId,
        pdfUrl: inv.pdfUrl,
        shopId: inv.shopId,
        vehicleId: inv.vehicleId,
        fleetId: inv.fleetId,
        shopName: inv.pdfShopName,
        vehicleVin: inv.pdfVin,
      });

      if (result.status === 'success') totalProcessed++;
      else if (result.status === 'failed') totalFailed++;
    }

    const pct = ((totalProcessed + totalFailed) / pendingInserted * 100).toFixed(1);
    logger.info(`Progress: ${totalProcessed + totalFailed}/${pendingInserted} (${pct}%) — success: ${totalProcessed}, failed: ${totalFailed}`);

    // Update progress
    await prisma.pipelineState.update({
      where: { pipelineName: PIPELINE_NAME },
      data: {
        recordsProcessed: totalProcessed,
        metadata: { processed: totalProcessed, failed: totalFailed, total: pendingInserted } as object,
        updatedAt: new Date(),
      },
    });

    offset += batchSize;
  }

  await prisma.pipelineState.update({
    where: { pipelineName: PIPELINE_NAME },
    data: {
      lastSuccessAt: new Date(),
      lastStatus: 'success',
      recordsProcessed: totalProcessed,
      metadata: { processed: totalProcessed, failed: totalFailed, total: pendingInserted } as object,
      updatedAt: new Date(),
    },
  });

  logger.info('=== Backfill complete ===', {
    total: pendingInserted,
    processed: totalProcessed,
    failed: totalFailed,
  });
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Backfill failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
