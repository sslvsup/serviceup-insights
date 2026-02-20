/**
 * seedFromGsheet.ts — One-time: import Google Sheet CSV data
 *
 * Usage:
 *   npx tsx src/scripts/seedFromGsheet.ts
 *
 * The script reads a CSV file with columns: request_id, invoice_url, clickable_invoice_url
 * (exported from the Google Sheet 1OW3BqToe_gM0fJmsBsTC_1nI5dFhEwWja5p_JcCtfHg)
 * and inserts rows into parsed_invoices with parse_status = 'pending'.
 *
 * The batchRunner will then pick them up and process them.
 */
import 'dotenv/config';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { getPrisma } from '../db/prisma';
import { config } from '../config/env';
import { logger } from '../utils/logger';

interface GsheetRow {
  request_id: string;
  invoice_url: string;
  clickable_invoice_url?: string;
}

async function seedFromGsheet() {
  const csvPath = path.resolve(config.seed.gsheetCsvPath);

  if (!fs.existsSync(csvPath)) {
    logger.error(`CSV file not found: ${csvPath}`);
    logger.info('Please export the Google Sheet as CSV and place it at the path specified by GSHEET_CSV_PATH');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as GsheetRow[];

  logger.info(`Parsed ${rows.length} rows from CSV`);

  const prisma = getPrisma();
  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  for (const row of rows) {
    const requestId = parseInt(row.request_id, 10);
    const pdfUrl = row.invoice_url || row.clickable_invoice_url || '';

    if (!requestId || isNaN(requestId) || !pdfUrl || !pdfUrl.startsWith('http')) {
      invalid++;
      continue;
    }

    // Check if already exists
    const existing = await prisma.parsedInvoice.findFirst({
      where: { requestId, pdfUrl },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.parsedInvoice.create({
      data: {
        requestId,
        pdfUrl,
        parseStatus: 'pending',
        extractedData: {},
      },
    });
    inserted++;
  }

  logger.info('Seed complete', { inserted, skipped, invalid, total: rows.length });
  logger.info(`Next step: run 'npx tsx src/scripts/backfill.ts' to process the pending invoices`);
}

seedFromGsheet()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
