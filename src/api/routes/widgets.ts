import { Router, Request, Response } from 'express';
import { getPrisma } from '../../db/prisma';
import { generateAndCacheInsights } from '../../intelligence/llmAnalyzer';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /api/v1/widgets?fleetId=X&period=90d
 * Returns JSON array of InsightWidget for the fleet.
 */
router.get('/', async (req: Request, res: Response) => {
  const fleetId = parseInt(req.query.fleetId as string, 10);
  const period = (req.query.period as string) ?? '90d';
  const audience = req.query.audience as string | undefined;

  if (!fleetId || isNaN(fleetId)) {
    return res.status(400).json({ error: 'fleetId is required' });
  }

  try {
    const prisma = getPrisma();
    const where: Record<string, unknown> = {
      fleetId,
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    };
    if (audience) {
      where.audience = { in: [audience, 'all'] };
    }

    const insights = await prisma.insightCache.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: 20,
    });

    const widgets = insights.map((i) => ({
      id: String(i.id),
      type: i.widgetType ?? 'stat_card',
      insightType: i.insightType,
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      audience: i.audience,
      savingsEstimateDollars: i.savingsEstimateCents ? i.savingsEstimateCents / 100 : null,
      config: i.detailJson,
      generatedAt: i.updatedAt?.toISOString(),
    }));

    res.json({ fleetId, period, widgets });
  } catch (err) {
    logger.error('widgets API error', { fleetId, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/widgets/generate?fleetId=X
 * Trigger insight generation for a fleet (async).
 */
router.post('/generate', async (req: Request, res: Response) => {
  const fleetId = parseInt((req.query.fleetId ?? req.body?.fleetId) as string, 10);
  const period = (req.query.period ?? req.body?.period ?? '90d') as string;

  if (!fleetId || isNaN(fleetId)) {
    return res.status(400).json({ error: 'fleetId is required' });
  }

  // Fire-and-forget generation
  generateAndCacheInsights(fleetId, period).catch((err) =>
    logger.error('Background insight generation failed', { fleetId, error: err instanceof Error ? err.message : String(err) }),
  );

  res.json({ status: 'generating', fleetId, period, message: 'Insight generation started' });
});

export default router;
