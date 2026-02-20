import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getPrisma } from '../db/prisma';
import { config } from '../config/env';
import { logger } from '../utils/logger';

import {
  getTotalSpend,
  getSpendByShop,
  getMonthlySpend,
  getAvgLaborRateByShop,
  getTopReplacedParts,
  getCostBreakdown,
  getAnomalies,
  getVehicleRepairFrequency,
  getFleetSummary,
} from '../metrics/metrics';

import { findSimilarInvoices } from './vectorRetriever';
import { checkRecalls } from './nhtsaRecalls';
import { computeBenchmarks, formatBenchmarkForPrompt } from './benchmarks';
import { buildInsightGenerationPrompt } from './insightPrompts';
import { filterInsights } from './insightJudge';

export interface InsightCandidate {
  title: string;
  summary: string;
  insight_type: string;
  savings_estimate_cents: number | null;
  widget_type: string;
  detail_json: Record<string, unknown>;
  priority: number;
  audience: string;
}

const MODEL = 'gemini-2.5-flash';

let _llm: ChatGoogleGenerativeAI | undefined;

function getLlm() {
  if (!_llm) {
    _llm = new ChatGoogleGenerativeAI({
      model: MODEL,
      temperature: 0.2,
      apiKey: config.gemini.apiKey,
    });
  }
  return _llm;
}

function getPeriodDays(period: string): number {
  const map: Record<string, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  return map[period] ?? 90;
}

/**
 * Generate insights for a fleet and cache them.
 * Full pipeline: metrics → benchmarks → vector retrieval → LLM generation → judge → cache.
 */
export async function generateAndCacheInsights(
  fleetId: number,
  period = '90d',
): Promise<number> {
  const prisma = getPrisma();
  const days = getPeriodDays(period);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const startDate = since.toISOString().split('T')[0];
  const endDate = new Date().toISOString().split('T')[0];

  logger.info('Generating insights', { fleetId, period, since: startDate });

  // 1. Gather fleet-level metrics in parallel
  const [summary, spendByShop, monthlySpend, laborRates, topParts, costBreakdown, anomalies, vehicles] =
    await Promise.all([
      getFleetSummary(fleetId, since).catch(() => null),
      getSpendByShop(fleetId, since).catch(() => []),
      getMonthlySpend(fleetId, since).catch(() => []),
      getAvgLaborRateByShop(fleetId, since).catch(() => []),
      getTopReplacedParts(fleetId, since, 10).catch(() => []),
      getCostBreakdown(fleetId, since).catch(() => []),
      getAnomalies(fleetId, since).catch(() => []),
      getVehicleRepairFrequency(fleetId, since).catch(() => []),
    ]);

  const metricsJson = JSON.stringify({
    summary,
    spend_by_shop: spendByShop,
    monthly_spend: monthlySpend,
    labor_rates_by_shop: laborRates,
    top_replaced_parts: topParts,
    cost_breakdown: costBreakdown,
    anomalies: anomalies.slice(0, 10),
    vehicle_repair_frequency: vehicles.slice(0, 10),
  }, null, 2);

  // 2. pgvector: retrieve relevant repair context
  let vectorContext = '';
  try {
    const similarDocs = await findSimilarInvoices(
      `high cost repairs anomalies ${topParts.slice(0, 3).map((p) => p.name).join(' ')}`,
      fleetId,
      8,
    );
    vectorContext = similarDocs
      .slice(0, 5)
      .map((d) => `[Shop: ${d.shop_name ?? 'Unknown'}, similarity: ${d.similarity?.toFixed(2)}]\n${d.chunk_text?.slice(0, 300)}`)
      .join('\n\n');
  } catch (err) {
    logger.warn('Vector retrieval failed', { fleetId, error: err instanceof Error ? err.message : String(err) });
  }

  // 3. Cross-fleet benchmarks
  let benchmarkData = '';
  try {
    const benchmarks = await computeBenchmarks(fleetId, since);
    benchmarkData = formatBenchmarkForPrompt(benchmarks);
  } catch (err) {
    logger.warn('Benchmark computation failed', { fleetId, error: err instanceof Error ? err.message : String(err) });
  }

  // 4. NHTSA recalls for fleet vehicles
  let nhtsaData = '';
  try {
    // Get unique vehicles from the invoices we have
    const vehicleRows = await prisma.$queryRaw<{ vin: string; make: string; model: string; year: string }[]>`
      SELECT DISTINCT
        pdf_vin AS vin,
        extracted_data->>'vehicle_make' AS make,
        extracted_data->>'vehicle_model' AS model,
        extracted_data->>'vehicle_year' AS year
      FROM parsed_invoices
      WHERE fleet_id = ${fleetId}
        AND pdf_vin IS NOT NULL
        AND parse_status = 'completed'
      LIMIT 50
    `;

    const recallableVehicles = vehicleRows.filter((v) => v.vin && v.make && v.model && v.year);
    if (recallableVehicles.length > 0) {
      const recalls = await checkRecalls(recallableVehicles);
      if (recalls.length > 0) {
        nhtsaData = recalls
          .map((r) => `VIN: ${r.vin} (${r.year} ${r.make} ${r.model})\nCampaign: ${r.nhtsaCampaignNumber}\nComponent: ${r.component}\nSummary: ${r.summary}\nRemedy: ${r.remedy}`)
          .join('\n\n');
      }
    }
  } catch (err) {
    logger.warn('NHTSA recall check failed', { fleetId, error: err instanceof Error ? err.message : String(err) });
  }

  // 5. Generate insights with LLM
  const prompt = buildInsightGenerationPrompt({
    fleetId,
    period,
    startDate,
    endDate,
    metricsJson,
    vectorContext,
    benchmarkData,
    nhtsaData,
  });

  let candidates: InsightCandidate[] = [];
  try {
    const llm = getLlm();
    const response = await llm.invoke([
      new SystemMessage('You are a fleet maintenance analytics expert. Return valid JSON only.'),
      new HumanMessage(prompt),
    ]);

    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        // Validate each candidate has minimum required fields
        candidates = parsed.filter(
          (c): c is InsightCandidate =>
            typeof c === 'object' &&
            c !== null &&
            typeof c.title === 'string' &&
            typeof c.summary === 'string' &&
            typeof c.insight_type === 'string' &&
            typeof c.widget_type === 'string',
        );
      }
    }
    logger.info('LLM generated candidates', { fleetId, count: candidates.length });
  } catch (err) {
    logger.error('LLM insight generation failed', {
      fleetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  // 6. LLM-as-judge quality filter
  const filtered = await filterInsights(candidates);
  logger.info('After judge filter', { fleetId, kept: filtered.length });

  // 7. Upsert into insight_cache
  const validUntil = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h TTL
  let cached = 0;

  for (const insight of filtered) {
    const insightKey = `fleet:${fleetId}:${insight.insight_type}:${period}:${endDate}`;
    try {
      await prisma.insightCache.upsert({
        where: { insightKey },
        create: {
          fleetId,
          insightType: insight.insight_type,
          insightKey,
          title: insight.title,
          summary: insight.summary,
          detailJson: insight.detail_json as object,
          widgetType: insight.widget_type,
          priority: insight.priority ?? 3,
          audience: insight.audience ?? 'all',
          savingsEstimateCents: insight.savings_estimate_cents,
          generatedByModel: MODEL,
          validFrom: new Date(),
          validUntil,
        },
        update: {
          title: insight.title,
          summary: insight.summary,
          detailJson: insight.detail_json as object,
          widgetType: insight.widget_type,
          priority: insight.priority ?? 3,
          audience: insight.audience ?? 'all',
          savingsEstimateCents: insight.savings_estimate_cents,
          generatedByModel: MODEL,
          validFrom: new Date(),
          validUntil,
          updatedAt: new Date(),
        },
      });
      cached++;
    } catch (err) {
      logger.error('Failed to cache insight', {
        insightKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Insights cached', { fleetId, cached });
  return cached;
}
