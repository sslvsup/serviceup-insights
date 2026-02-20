import { Router, Request, Response } from 'express';
import { getPrisma } from '../../db/prisma';
import { embedAuthMiddleware } from '../auth/embedToken';
import { renderWidgetPage } from '../templates/widgetRenderer';
import { escapeHtml } from '../templates/layout';
import { logger } from '../../utils/logger';

const router = Router();

// Type mapping from URL param → insight_type in DB
const TYPE_MAP: Record<string, string> = {
  'parts-trend': 'parts_trend',
  'labor-rates': 'labor_rates',
  'shop-comparison': 'shop_recommendation',
  'narrative-summary': 'narrative',
  'anomaly-alerts': 'anomaly',
  'top-parts': 'top_parts',
  'vehicle-health': 'vehicle_health',
  'cost-breakdown': 'cost_breakdown',
  'fleet-benchmark': 'fleet_benchmark',
  'recall-alerts': 'recall_alert',
};

/**
 * GET /embed/widget/:type?fleetId=X&token=T
 * Returns a self-contained HTML widget page.
 */
router.get('/:type', embedAuthMiddleware, async (req: Request, res: Response) => {
  const { type } = req.params;
  const { theme = 'light' } = req.query as { theme?: string };
  const fleetId = req.fleetId;

  if (!fleetId) {
    res.status(401).send('Unauthorized');
    return;
  }

  const insightType = TYPE_MAP[type] ?? type;

  try {
    const prisma = getPrisma();
    const insight = await prisma.insightCache.findFirst({
      where: {
        fleetId,
        insightType,
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });

    if (!insight) {
      // Safe — escapeHtml prevents XSS even if `type` contains malicious input
      const safeType = escapeHtml(type);
      const emptyHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f5f5f5;}.msg{text-align:center;color:#666;}.msg h3{margin:0;font-size:16px;font-weight:600;}.msg p{margin:8px 0 0;font-size:13px;}</style>
</head><body>
<div class="msg"><h3>No ${safeType} data yet</h3><p>Insights appear after invoice data is processed.</p></div>
</body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(emptyHtml);
      return;
    }

    const html = renderWidgetPage(
      {
        id: insight.id,
        fleetId: insight.fleetId,
        insightType: insight.insightType,
        title: insight.title,
        summary: insight.summary,
        widgetType: insight.widgetType,
        detailJson: insight.detailJson as Record<string, unknown>,
        priority: insight.priority,
        audience: insight.audience,
        savingsEstimateCents: insight.savingsEstimateCents,
      },
      theme === 'dark' ? 'dark' : 'light',
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch (err) {
    logger.error('Widget render error', { type, fleetId, error: err instanceof Error ? err.message : String(err) });
    res.status(500).send('Internal error rendering widget');
  }
});

export default router;
