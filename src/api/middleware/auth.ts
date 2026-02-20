import { Request, Response, NextFunction } from 'express';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

let _warnedOnce = false;

/**
 * API key middleware for internal /api/v1/* routes.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] as string | undefined;

  // No API key configured — open in dev, but warn loudly so it's not forgotten in prod
  if (!config.api.apiKey) {
    if (!_warnedOnce) {
      logger.warn('API_KEY is not set — all /api/v1 routes are unauthenticated. Set API_KEY in production.');
      _warnedOnce = true;
    }
    return next();
  }

  if (!key || key !== config.api.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
