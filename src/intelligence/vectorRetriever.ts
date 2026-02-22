import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrisma } from '../db/prisma';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let _genai: GoogleGenerativeAI | undefined;

function getGenai() {
  if (!_genai) _genai = new GoogleGenerativeAI(config.gemini.apiKey);
  return _genai;
}

async function getEmbedding(text: string): Promise<number[]> {
  const model = getGenai().getGenerativeModel({ model: config.gemini.embeddingModel });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export interface SimilarInvoiceResult {
  invoice_id: number;
  chunk_text: string;
  similarity: number;
  fleet_id: number | null;
  shop_name: string | null;
}

/**
 * Find semantically similar invoice chunks for a given fleet.
 * Uses pgvector cosine similarity JOIN-ed with relational filters.
 */
export async function findSimilarInvoices(
  query: string,
  fleetId: number,
  limit = 10,
): Promise<SimilarInvoiceResult[]> {
  if (!config.gemini.apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping vector search');
    return [];
  }

  const embedding = await getEmbedding(query);
  const vectorStr = `[${embedding.join(',')}]`;
  const prisma = getPrisma();

  return prisma.$queryRaw<SimilarInvoiceResult[]>`
    SELECT e.parsed_invoice_id AS invoice_id,
           e.chunk_text,
           1 - (e.embedding <=> ${vectorStr}::vector) AS similarity,
           pi.fleet_id,
           pi.pdf_shop_name AS shop_name
    FROM invoice_embeddings e
    JOIN parsed_invoices pi ON e.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
    ORDER BY e.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;
}

/**
 * Find similar service corrections across all fleets (for cross-fleet context).
 */
export async function findSimilarCorrections(
  query: string,
  limit = 10,
): Promise<SimilarInvoiceResult[]> {
  if (!config.gemini.apiKey) return [];

  const embedding = await getEmbedding(query);
  const vectorStr = `[${embedding.join(',')}]`;
  const prisma = getPrisma();

  return prisma.$queryRaw<SimilarInvoiceResult[]>`
    SELECT e.parsed_invoice_id AS invoice_id,
           e.chunk_text,
           1 - (e.embedding <=> ${vectorStr}::vector) AS similarity,
           pi.fleet_id,
           pi.pdf_shop_name AS shop_name
    FROM invoice_embeddings e
    JOIN parsed_invoices pi ON e.parsed_invoice_id = pi.id
    WHERE e.chunk_type = 'service_correction'
    ORDER BY e.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;
}
