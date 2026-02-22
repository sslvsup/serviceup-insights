import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrisma } from '../db/prisma';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let _genai: GoogleGenerativeAI | undefined;

function getGenai() {
  if (!_genai) {
    _genai = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return _genai;
}

async function getEmbedding(text: string): Promise<number[]> {
  const genai = getGenai();
  const model = genai.getGenerativeModel({ model: config.gemini.embeddingModel });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

function vectorToSql(embedding: number[]): string {
  const expectedDims = config.gemini.embeddingDimensions;
  if (embedding.length !== expectedDims) {
    throw new Error(
      `Embedding dimension mismatch: got ${embedding.length}, expected ${expectedDims}. ` +
      `Check GEMINI_EMBEDDING_MODEL and GEMINI_EMBEDDING_DIMENSIONS config.`,
    );
  }
  return `[${embedding.join(',')}]`;
}

/**
 * Embed the full invoice text and store in invoice_embeddings.
 */
export async function embedInvoice(
  invoiceId: number,
  rawText: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const prisma = getPrisma();

  // Check if already embedded
  const existing = await prisma.invoiceEmbedding.findFirst({
    where: { parsedInvoiceId: invoiceId, chunkType: 'full_document' },
  });
  if (existing) return false;

  const text = rawText.slice(0, 8000); // limit to avoid token limits
  const embedding = await getEmbedding(text);
  const vectorStr = vectorToSql(embedding);

  await prisma.$executeRaw`
    INSERT INTO invoice_embeddings (parsed_invoice_id, chunk_type, chunk_text, embedding, metadata)
    VALUES (${invoiceId}, 'full_document', ${text}, ${vectorStr}::vector, ${JSON.stringify(metadata)}::jsonb)
    ON CONFLICT DO NOTHING
  `;

  logger.debug('Embedded full document', { invoiceId });
  return true;
}

/**
 * Embed a service correction string (complaint+cause+correction) for semantic search.
 */
export async function embedServiceCorrection(
  invoiceId: number,
  correction: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const prisma = getPrisma();
  const text = correction.slice(0, 4000);
  const embedding = await getEmbedding(text);
  const vectorStr = vectorToSql(embedding);

  await prisma.$executeRaw`
    INSERT INTO invoice_embeddings (parsed_invoice_id, chunk_type, chunk_text, embedding, metadata)
    VALUES (${invoiceId}, 'service_correction', ${text}, ${vectorStr}::vector, ${JSON.stringify(metadata)}::jsonb)
  `;

  logger.debug('Embedded service correction', { invoiceId });
}

/**
 * Embed all relevant text from a parsed invoice.
 * Called after normalizeAndStore() completes.
 * Returns the number of embeddings created.
 */
export async function embedInvoiceData(
  invoiceId: number,
  fleetId: number | null | undefined,
  shopId: number | null | undefined,
  rawText: string,
  services: Array<{ complaint?: string | null; cause?: string | null; correction?: string | null; service_name?: string | null }>,
): Promise<{ fullDocEmbedded: boolean; correctionCount: number; skippedCount: number }> {
  const baseMetadata = {
    fleet_id: fleetId ?? null,
    shop_id: shopId ?? null,
    invoice_id: invoiceId,
  };

  let fullDocEmbedded = false;
  let correctionCount = 0;
  let skippedCount = 0;

  // Embed full document
  if (rawText.trim().length > 20) {
    fullDocEmbedded = await embedInvoice(invoiceId, rawText, baseMetadata);
  }

  // Embed each service correction
  for (const service of services) {
    const parts = [service.complaint, service.cause, service.correction].filter(Boolean);
    if (parts.length > 0) {
      const correctionText = parts.join('\n');
      await embedServiceCorrection(invoiceId, correctionText, {
        ...baseMetadata,
        service_name: service.service_name ?? 'Unknown Service',
      });
      correctionCount++;
    } else {
      skippedCount++;
    }
  }

  if (skippedCount > 0) {
    logger.debug('Skipped embedding services with no complaint/cause/correction', {
      invoiceId,
      skippedCount,
      embeddedCount: correctionCount,
    });
  }

  return { fullDocEmbedded, correctionCount, skippedCount };
}
