import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../config/env';
import { invoiceParseSchema, InvoiceParseResult } from './schema';
import { INVOICE_SYSTEM_PROMPT, SAMPLE_PDF_MESSAGE, PARSE_REQUEST_MESSAGE } from './systemPrompt';
import { logger } from '../utils/logger';

const MODEL_FLASH = 'gemini-2.5-flash';
const MODEL_PRO = 'gemini-2.5-pro';

// Parses below this threshold are retried with Pro before being stored
const CONFIDENCE_RETRY_THRESHOLD = 0.6;

let _llmFlash: ReturnType<typeof buildLlm> | undefined;
let _llmPro: ReturnType<typeof buildLlm> | undefined;

function buildLlm(model: string) {
  const base = new ChatGoogleGenerativeAI({
    model,
    temperature: 0,
    apiKey: config.gemini.apiKey,
  });
  return base.withStructuredOutput(invoiceParseSchema);
}

function getLlm(model: 'flash' | 'pro') {
  if (model === 'pro') {
    if (!_llmPro) _llmPro = buildLlm(MODEL_PRO);
    return _llmPro;
  }
  if (!_llmFlash) _llmFlash = buildLlm(MODEL_FLASH);
  return _llmFlash;
}

/**
 * Parse a single invoice PDF using Gemini 2.5 Flash with structured output.
 * Follows the 3-turn conversation pattern from the CCC PDF parser.
 *
 * @param pdfBase64 - The target PDF as a base64 string
 * @param samplePdfBase64 - Optional sample PDF for few-shot context
 */
export async function parseInvoicePdf(
  pdfBase64: string,
  samplePdfBase64?: string,
): Promise<{ result: InvoiceParseResult; elapsedMs: number; model: string }> {
  const startMs = Date.now();

  const systemMessage = new SystemMessage(INVOICE_SYSTEM_PROMPT);

  let messages: (SystemMessage | HumanMessage | AIMessage)[];

  if (samplePdfBase64) {
    // 3-turn conversation: system → sample PDF → target PDF
    const sampleMessage = new HumanMessage({
      content: [
        { type: 'media', mimeType: 'application/pdf', data: samplePdfBase64 },
        { type: 'text', text: SAMPLE_PDF_MESSAGE },
      ],
    });

    const aiAck = new AIMessage({
      content: [
        {
          type: 'text',
          text: 'I have reviewed the sample automotive repair invoice and am ready to extract data from your invoice in the same structured format.',
        },
      ],
    });

    const targetMessage = new HumanMessage({
      content: [
        { type: 'media', mimeType: 'application/pdf', data: pdfBase64 },
        { type: 'text', text: PARSE_REQUEST_MESSAGE },
      ],
    });

    messages = [systemMessage, sampleMessage, aiAck, targetMessage];
  } else {
    // Single-turn: system + target PDF
    const targetMessage = new HumanMessage({
      content: [
        { type: 'media', mimeType: 'application/pdf', data: pdfBase64 },
        { type: 'text', text: PARSE_REQUEST_MESSAGE },
      ],
    });
    messages = [systemMessage, targetMessage];
  }

  logger.debug('Invoking Gemini PDF parser (flash)');

  let result = await getLlm('flash').invoke(messages);
  let usedModel = MODEL_FLASH;

  // Low-confidence parse — retry with Pro before storing potentially bad data
  if ((result.parse_confidence ?? 1) < CONFIDENCE_RETRY_THRESHOLD) {
    logger.info('Low confidence parse, retrying with Pro', {
      confidence: result.parse_confidence,
      threshold: CONFIDENCE_RETRY_THRESHOLD,
    });
    result = await getLlm('pro').invoke(messages);
    usedModel = MODEL_PRO;
  }

  const elapsedMs = Date.now() - startMs;

  logger.debug('Gemini parse complete', {
    model: usedModel,
    elapsedMs,
    isValid: result.is_valid_invoice,
    confidence: result.parse_confidence,
    serviceCount: result.services?.length ?? 0,
  });

  // Ensure required fields have defaults (LangChain structured output may not apply Zod defaults)
  const normalized: InvoiceParseResult = {
    ...result,
    services: (result.services ?? []).map((s) => ({
      ...s,
      sort_order: s.sort_order ?? 0,
      line_items: (s.line_items ?? []).map((li) => ({
        ...li,
        quantity: li.quantity ?? 1,
        sort_order: li.sort_order ?? 0,
        is_sublet: li.is_sublet ?? false,
      })),
    })),
    extras: result.extras ?? [],
  } as InvoiceParseResult;

  return { result: normalized, elapsedMs, model: usedModel };
}
