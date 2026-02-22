import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import type { ServiceResult, LineItemResult } from './schema';
import { invoiceParseSchema, coerceNulls, InvoiceParseResult } from './schema';
import { INVOICE_SYSTEM_PROMPT, SAMPLE_PDF_MESSAGE, PARSE_REQUEST_MESSAGE } from './systemPrompt';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const MODEL_FLASH = 'gemini-2.5-flash';
const MODEL_PRO = 'gemini-2.5-pro';

// Parses below this threshold are retried with Pro before being stored
const CONFIDENCE_RETRY_THRESHOLD = 0.6;

let _genai: GoogleGenerativeAI | undefined;

function getGenai() {
  if (!_genai) _genai = new GoogleGenerativeAI(config.gemini.apiKey);
  return _genai;
}

function getModel(modelName: string) {
  return getGenai().getGenerativeModel(
    {
      model: modelName,
      systemInstruction: INVOICE_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        // No responseSchema — we let the system prompt guide structure and parse with Zod.
        // Sending responseSchema through LangChain caused consistent JSON truncation at ~16K tokens
        // because the SDK defaulted to a lower output limit in schema mode.
        maxOutputTokens: 65536,
        temperature: 0,
      },
    },
  );
}

async function invokeModel(
  modelName: string,
  pdfBase64: string,
  samplePdfBase64?: string,
): Promise<string> {
  const model = getModel(modelName);

  let history: Content[] = [];

  if (samplePdfBase64) {
    // 3-turn: sample PDF → ack → target PDF
    history = [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: samplePdfBase64 } },
          { text: SAMPLE_PDF_MESSAGE },
        ],
      },
      {
        role: 'model',
        parts: [{ text: 'I have reviewed the sample automotive repair invoice and am ready to extract data from your invoice in the same structured format.' }],
      },
    ];
  }

  const chat = model.startChat({ history });

  // Wrap sendMessage in a timeout to prevent indefinite hangs on slow API responses
  const timeoutMs = config.gemini.llmTimeoutMs;
  const sendPromise = chat.sendMessage([
    { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    { text: PARSE_REQUEST_MESSAGE },
  ]);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini ${modelName} timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  const result = await Promise.race([sendPromise, timeoutPromise]);
  return result.response.text();
}

function parseAndNormalize(jsonText: string): InvoiceParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const preview = jsonText.slice(0, 200);
    logger.error('Failed to parse LLM JSON response', { preview, error: err instanceof Error ? err.message : String(err) });
    throw new Error(`LLM returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Some models occasionally wrap the result in a single-element array
  if (Array.isArray(raw) && raw.length === 1) {
    logger.debug('Unwrapping single-element array from LLM response');
    raw = raw[0];
  }

  // Gemini returns null for absent optional fields; coerce null → undefined so
  // Zod .optional() fields accept them (we don't use .nullable() in the schema).
  const parsed = invoiceParseSchema.parse(coerceNulls(raw));

  // Ensure Zod .default() values are applied (they may not fire when parsing raw LLM output)
  // Also hard-cap raw_text — the LLM ignores maxLength hints
  return {
    ...parsed,
    raw_text: (parsed.raw_text ?? '').slice(0, 8000),
    services: (parsed.services ?? []).map((s: ServiceResult) => ({
      ...s,
      sort_order: s.sort_order ?? 0,
      line_items: (s.line_items ?? []).map((li: LineItemResult) => ({
        ...li,
        quantity: li.quantity ?? 1,
        sort_order: li.sort_order ?? 0,
        is_sublet: li.is_sublet ?? false,
      })),
    })),
    extras: parsed.extras ?? [],
  };
}

/**
 * Parse a single invoice PDF using Gemini 2.5 Flash with JSON output mode.
 * Uses @google/generative-ai directly (not LangChain) to ensure maxOutputTokens
 * is respected — LangChain's withStructuredOutput/response_schema mode was
 * truncating output at ~16K tokens regardless of the maxOutputTokens setting.
 *
 * Falls back to Pro if parse_confidence < 0.6.
 */
export async function parseInvoicePdf(
  pdfBase64: string,
  samplePdfBase64?: string,
): Promise<{ result: InvoiceParseResult; elapsedMs: number; model: string }> {
  const startMs = Date.now();

  logger.debug('Invoking Gemini PDF parser (flash)');

  let jsonText = await invokeModel(MODEL_FLASH, pdfBase64, samplePdfBase64);
  let usedModel = MODEL_FLASH;

  let result = parseAndNormalize(jsonText);

  // Low-confidence parse — retry with Pro before storing potentially bad data.
  // Use 0.5 (schema default) when LLM omits parse_confidence.
  if ((result.parse_confidence ?? 0.5) < CONFIDENCE_RETRY_THRESHOLD) {
    logger.info('Low confidence parse, retrying with Pro', {
      confidence: result.parse_confidence,
      threshold: CONFIDENCE_RETRY_THRESHOLD,
    });
    jsonText = await invokeModel(MODEL_PRO, pdfBase64, samplePdfBase64);
    result = parseAndNormalize(jsonText);
    usedModel = MODEL_PRO;

    // If Pro also returned low confidence, log a warning for human review
    if ((result.parse_confidence ?? 0.5) < CONFIDENCE_RETRY_THRESHOLD) {
      logger.warn('Pro model also returned low confidence — invoice may need manual review', {
        confidence: result.parse_confidence,
        threshold: CONFIDENCE_RETRY_THRESHOLD,
      });
    }
  }

  const elapsedMs = Date.now() - startMs;

  logger.debug('Gemini parse complete', {
    model: usedModel,
    elapsedMs,
    isValid: result.is_valid_invoice,
    confidence: result.parse_confidence,
    serviceCount: result.services?.length ?? 0,
  });

  return { result, elapsedMs, model: usedModel };
}
