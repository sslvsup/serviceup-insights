import cron from 'node-cron';
import { runNightlyPipeline } from './nightlyPipeline';
import { logger } from '../utils/logger';

/**
 * Schedule the nightly pipeline to run at 11:00 PM UTC daily.
 */
export function startScheduler() {
  // '0 23 * * *' = 11pm UTC every day
  cron.schedule('0 23 * * *', async () => {
    logger.info('Scheduler: starting nightly pipeline');
    try {
      await runNightlyPipeline();
    } catch (err) {
      logger.error('Scheduled pipeline error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, {
    timezone: 'UTC',
  });

  logger.info('Scheduler started — nightly pipeline runs at 11pm UTC');
}
