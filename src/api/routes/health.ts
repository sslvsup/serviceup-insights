import { Router } from 'express';
import { getPrisma } from '../../db/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;

    const [invoiceCount, cacheCount] = await Promise.all([
      prisma.parsedInvoice.count(),
      prisma.insightCache.count({ where: { OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] } }),
    ]);

    res.json({
      status: 'ok',
      db: 'connected',
      invoices: invoiceCount,
      active_insights: cacheCount,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
