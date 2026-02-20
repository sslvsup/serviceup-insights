import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrisma } from '../db/prisma';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// gemini-embedding-001 is available via v1beta and produces 768-dim vectors (matches our vector(768) schema)
// text-embedding-004 is not enabled for the serviceupaistudio project
const EMBED_MODEL = 'gemini-embedding-001';

let _genai: GoogleGenerativeAI | undefined;

function getGenai() {
  if (!_genai) {
    _genai = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return _genai;
}

async function getEmbedding(text: string): Promise<number[]> {
  const genai = getGenai();
  const model = genai.getGenerativeModel({ model: EMBED_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

function vectorToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Embed the full invoice text and store in invoice_embeddings.
 */
export async function embedInvoice(
  invoiceId: number,
  rawText: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const prisma = getPrisma();

  // Check if already embedded
  const existing = await prisma.invoiceEmbedding.findFirst({
    where: { parsedInvoiceId: invoiceId, chunkType: 'full_document' },
  });
  if (existing) return;

  const text = rawText.slice(0, 8000); // limit to avoid token limits
  const embedding = await getEmbedding(text);
  const vectorStr = vectorToSql(embedding);

  await prisma.$executeRaw`
    INSERT INTO invoice_embeddings (parsed_invoice_id, chunk_type, chunk_text, embedding, metadata)
    VALUES (${invoiceId}, 'full_document', ${text}, ${vectorStr}::vector, ${JSON.stringify(metadata)}::jsonb)
    ON CONFLICT DO NOTHING
  `;

  logger.debug('Embedded full document', { invoiceId });
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
 */
export async function embedInvoiceData(
  invoiceId: number,
  fleetId: number | null | undefined,
  shopId: number | null | undefined,
  rawText: string,
  services: Array<{ complaint?: string | null; cause?: string | null; correction?: string | null; service_name?: string | null }>,
): Promise<void> {
  const baseMetadata = {
    fleet_id: fleetId ?? null,
    shop_id: shopId ?? null,
    invoice_id: invoiceId,
  };

  // Embed full document
  if (rawText.trim().length > 20) {
    await embedInvoice(invoiceId, rawText, baseMetadata);
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
    }
  }
}
