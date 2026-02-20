import 'dotenv/config';
import { startServer } from './api/server';
import { startScheduler } from './jobs/scheduler';
import { getPrisma, disconnectPrisma } from './db/prisma';
import { logger } from './utils/logger';

async function main() {
  logger.info('ServiceUp Insights service starting...');

  // Ensure DB is reachable
  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connected');

  // Ensure pipeline_state rows exist
  await prisma.pipelineState.upsert({
    where: { pipelineName: 'nightly_ingest' },
    create: { pipelineName: 'nightly_ingest' },
    update: {},
  });
  await prisma.pipelineState.upsert({
    where: { pipelineName: 'backfill' },
    create: { pipelineName: 'backfill' },
    update: {},
  });

  // Start HTTP server
  await startServer();

  // Start nightly scheduler (11pm UTC)
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
