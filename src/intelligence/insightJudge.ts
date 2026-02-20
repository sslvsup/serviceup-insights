import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { config } from '../config/env';
import { JUDGE_SYSTEM_PROMPT } from './insightPrompts';
import { logger } from '../utils/logger';
import { InsightCandidate } from './llmAnalyzer';

interface JudgeDecision {
  insight_index: number;
  keep: boolean;
  reason: string;
}

let _judgeLlm: ChatGoogleGenerativeAI | undefined;

function getJudgeLlm() {
  if (!_judgeLlm) {
    _judgeLlm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0,
      apiKey: config.gemini.apiKey,
    });
  }
  return _judgeLlm;
}

/**
 * Run LLM-as-judge quality filter on a batch of candidate insights.
 * Returns only the insights that pass all quality criteria.
 */
export async function filterInsights(candidates: InsightCandidate[]): Promise<InsightCandidate[]> {
  if (candidates.length === 0) return [];

  // Always keep recall alerts regardless of other criteria
  const recallAlerts = candidates.filter((c) => c.insight_type === 'recall_alert');
  const otherCandidates = candidates.filter((c) => c.insight_type !== 'recall_alert');

  if (otherCandidates.length === 0) {
    logger.info('All candidates are recall alerts — skipping judge');
    return recallAlerts;
  }

  const llm = getJudgeLlm();

  const systemMessage = new SystemMessage(JUDGE_SYSTEM_PROMPT);
  const humanMessage = new HumanMessage(
    `CANDIDATES:\n${JSON.stringify(otherCandidates, null, 2)}`,
  );

  try {
    const response = await llm.invoke([systemMessage, humanMessage]);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn('Judge returned no JSON — keeping all candidates');
      return candidates;
    }

    let decisions: JudgeDecision[];
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) throw new Error('Expected array');
      decisions = parsed.filter(
        (d): d is JudgeDecision =>
          typeof d === 'object' &&
          d !== null &&
          typeof d.insight_index === 'number' &&
          typeof d.keep === 'boolean',
      );
    } catch (parseErr) {
      logger.warn('Judge returned unparseable JSON — keeping all candidates', {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return candidates;
    }

    const keptIndices = new Set(
      decisions.filter((d) => d.keep).map((d) => d.insight_index),
    );

    const passed = otherCandidates.filter((_, i) => keptIndices.has(i));

    logger.info('Judge quality filter', {
      total: candidates.length,
      recalled: recallAlerts.length,
      evaluated: otherCandidates.length,
      kept: passed.length,
      cut: otherCandidates.length - passed.length,
    });

    return [...recallAlerts, ...passed];
  } catch (err) {
    logger.error('Judge LLM call failed — keeping all candidates', {
      error: err instanceof Error ? err.message : String(err),
    });
    return candidates;
  }
}
