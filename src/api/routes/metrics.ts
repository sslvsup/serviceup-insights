import { Router, Request, Response } from 'express';
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
  getFleetPercentiles,
  getLaborRateBenchmark,
} from '../../metrics/metrics';
import { logger } from '../../utils/logger';

const router = Router();

function getPeriodDate(period: string): Date {
  const days: Record<string, number> = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  const d = days[period] ?? 90;
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/v1/metrics?fleetId=X&type=spend&period=90d
 */
router.get('/', async (req: Request, res: Response) => {
  const fleetId = parseInt(req.query.fleetId as string);
  const type = req.query.type as string;
  const period = (req.query.period as string) ?? '90d';
  const since = getPeriodDate(period);

  if (!fleetId || isNaN(fleetId)) {
    return res.status(400).json({ error: 'fleetId is required' });
  }

  try {
    let data: unknown;

    switch (type) {
      case 'summary':
        data = await getFleetSummary(fleetId, since);
        break;
      case 'total_spend':
        data = { total: await getTotalSpend(fleetId, since) };
        break;
      case 'spend_by_shop':
        data = await getSpendByShop(fleetId, since);
        break;
      case 'monthly_spend':
        data = await getMonthlySpend(fleetId, since);
        break;
      case 'labor_rates':
        data = await getAvgLaborRateByShop(fleetId, since);
        break;
      case 'top_parts':
        data = await getTopReplacedParts(fleetId, since, 20);
        break;
      case 'cost_breakdown':
        data = await getCostBreakdown(fleetId, since);
        break;
      case 'anomalies':
        data = await getAnomalies(fleetId, since);
        break;
      case 'vehicle_health':
        data = await getVehicleRepairFrequency(fleetId, since);
        break;
      case 'fleet_percentiles':
        data = await getFleetPercentiles(fleetId, since);
        break;
      case 'labor_benchmark':
        data = await getLaborRateBenchmark(fleetId, since);
        break;
      default:
        return res.status(400).json({ error: `Unknown metric type: ${type}. Valid: summary, total_spend, spend_by_shop, monthly_spend, labor_rates, top_parts, cost_breakdown, anomalies, vehicle_health, fleet_percentiles, labor_benchmark` });
    }

    res.json({ fleetId, type, period, data });
  } catch (err) {
    logger.error('metrics API error', { fleetId, type, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
