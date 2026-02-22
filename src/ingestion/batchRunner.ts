import { getPrisma } from '../db/prisma';
import { fetchPdf } from './pdfFetcher';
import { parseInvoicePdf } from './pdfParser';
import { normalizeAndStore, InvoiceRecord } from './normalizer';
import { embedInvoiceData } from './embedder';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const DELAY_MS = 1000; // 1s delay between LLM calls to respect rate limits

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a rate limit (429) error from Gemini.
 */
function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('rate limit');
  }
  return false;
}

interface BatchItem {
  requestId: number;
  pdfUrl: string;
  shopId?: number | null;
  vehicleId?: number | null;
  fleetId?: number | null;
  shopName?: string | null;
  vehicleVin?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
}

interface BatchResult {
  requestId: number;
  invoiceId?: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

/**
 * Process a single invoice: fetch PDF → parse with LLM → normalize → store → embed.
 * Retries on rate limit errors using maxRetries from config.
 */
export async function processOne(item: BatchItem): Promise<BatchResult> {
  const prisma = getPrisma();
  const { requestId, pdfUrl } = item;
  const maxRetries = config.processing.maxRetries;

  // Check if already successfully processed
  const existing = await prisma.parsedInvoice.findFirst({
    where: { requestId, pdfUrl, parseStatus: 'completed' },
  });
  if (existing) {
    logger.debug('Skipping already processed invoice', { requestId });
    return { requestId, invoiceId: existing.id, status: 'skipped' };
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 1. Fetch PDF
      logger.info('Fetching PDF', { requestId, pdfUrl: pdfUrl.slice(0, 80), attempt: attempt > 0 ? attempt : undefined });
      const pdfBase64 = await fetchPdf(pdfUrl);

      // 2. Parse with Gemini (Flash, with Pro fallback for low-confidence parses)
      const { result, elapsedMs, model } = await parseInvoicePdf(pdfBase64);

      // 3. Normalize + store
      const record: InvoiceRecord = {
        requestId,
        shopId: item.shopId,
        vehicleId: item.vehicleId,
        fleetId: item.fleetId,
        pdfUrl,
        shopName: item.shopName,
        vehicleVin: item.vehicleVin,
        vehicleMake: item.vehicleMake,
        vehicleModel: item.vehicleModel,
        vehicleYear: item.vehicleYear,
        llmModel: model,
        elapsedMs,
      };
      const invoiceId = await normalizeAndStore(record, result);

      // 4. Embed for pgvector — wrapped in try-catch so embedding failures
      // don't mark a successfully parsed invoice as failed
      if (result.raw_text && config.gemini.apiKey) {
        try {
          const embedResult = await embedInvoiceData(
            invoiceId,
            item.fleetId,
            item.shopId,
            result.raw_text,
            result.services,
          );
          logger.debug('Embedding complete', {
            invoiceId,
            fullDocEmbedded: embedResult.fullDocEmbedded,
            corrections: embedResult.correctionCount,
            skipped: embedResult.skippedCount,
          });
        } catch (embedErr) {
          logger.error('Embedding failed (invoice parse still succeeded)', {
            invoiceId,
            requestId,
            error: embedErr instanceof Error ? embedErr.message : String(embedErr),
          });
        }
      }

      return { requestId, invoiceId, status: 'success' };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Retry on rate limit errors with exponential backoff
      if (isRateLimitError(err) && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        logger.warn('Rate limited by Gemini API, backing off', {
          requestId,
          attempt: attempt + 1,
          maxRetries,
          backoffMs,
        });
        await sleep(backoffMs);
        continue;
      }

      // Non-retryable error or max retries exhausted
      break;
    }
  }

  const message = lastError ? lastError.message : 'Unknown error';
  logger.error('Failed to process invoice', { requestId, error: message });

  // Mark as failed in DB
  await prisma.parsedInvoice.upsert({
    where: { requestId_pdfUrl: { requestId, pdfUrl } },
    create: {
      requestId,
      shopId: item.shopId,
      vehicleId: item.vehicleId,
      fleetId: item.fleetId,
      pdfUrl,
      parseStatus: 'failed',
      extractedData: {},
      parseMeta: { error: message, parsed_at: new Date().toISOString() },
    },
    update: {
      parseStatus: 'failed',
      parseMeta: { error: message, parsed_at: new Date().toISOString() },
      updatedAt: new Date(),
    },
  });

  return { requestId, status: 'failed', error: message };
}

/**
 * Process a batch of invoices sequentially (with rate-limit delay between each).
 */
export async function processBatch(items: BatchItem[]): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const item of items) {
    const result = await processOne(item);
    results.push(result);

    if (result.status !== 'skipped') {
      await sleep(DELAY_MS);
    }
  }

  return results;
}

/**
 * Process all pending invoices from the parsed_invoices table.
 * Used by the nightly pipeline after new rows have been inserted.
 */
export async function processPendingInvoices(): Promise<{ processed: number; failed: number; skipped: number }> {
  const prisma = getPrisma();
  const batchSize = config.processing.batchSize;

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  while (true) {
    // Always fetch from offset 0 — processed items leave the 'pending' set naturally,
    // so incrementing an offset would skip remaining pending rows.
    const pending = await prisma.parsedInvoice.findMany({
      where: { parseStatus: 'pending' },
      take: batchSize,
      select: {
        requestId: true,
        pdfUrl: true,
        shopId: true,
        vehicleId: true,
        fleetId: true,
        pdfShopName: true,
        pdfVin: true,
      },
    });

    if (pending.length === 0) break;

    const items: BatchItem[] = pending.map((p) => ({
      requestId: p.requestId,
      pdfUrl: p.pdfUrl,
      shopId: p.shopId,
      vehicleId: p.vehicleId,
      fleetId: p.fleetId,
      shopName: p.pdfShopName,
      vehicleVin: p.pdfVin,
    }));

    const results = await processBatch(items);

    for (const r of results) {
      if (r.status === 'success') processed++;
      else if (r.status === 'failed') failed++;
      else skipped++;
    }

    logger.info('Batch progress', { processed, failed, skipped });
  }

  return { processed, failed, skipped };
}
