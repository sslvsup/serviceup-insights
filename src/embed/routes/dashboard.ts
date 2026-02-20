import { Router, Request, Response } from 'express';
import { getPrisma } from '../../db/prisma';
import { embedAuthMiddleware } from '../auth/embedToken';
import { renderDashboardGrid } from '../templates/dashboardGrid';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /embed/dashboard?fleetId=X&token=T&period=90d&theme=light
 * Returns a full dashboard HTML page with all widgets for the fleet.
 */
router.get('/', embedAuthMiddleware, async (req: Request, res: Response) => {
  const { theme = 'light', period = '90d' } = req.query as { theme?: string; period?: string };
  const fleetId = req.fleetId;

  if (!fleetId) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const prisma = getPrisma();
    const insights = await prisma.insightCache.findMany({
      where: {
        fleetId,
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: 20,
    });

    const html = renderDashboardGrid({
      fleetId,
      insights: insights.map((i) => ({
        id: i.id,
        fleetId: i.fleetId,
        insightType: i.insightType,
        title: i.title,
        summary: i.summary,
        widgetType: i.widgetType,
        detailJson: i.detailJson as Record<string, unknown>,
        priority: i.priority,
        audience: i.audience,
        savingsEstimateCents: i.savingsEstimateCents,
      })),
      theme: theme === 'dark' ? 'dark' : 'light',
      period,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch (err) {
    logger.error('Dashboard render error', { fleetId, error: err instanceof Error ? err.message : String(err) });
    res.status(500).send('Internal error rendering dashboard');
  }
});

export default router;
