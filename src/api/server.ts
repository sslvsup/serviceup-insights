import express from 'express';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { apiKeyAuth } from './middleware/auth';
import { generateEmbedToken } from '../embed/auth/embedToken';

// Route imports
import healthRouter from './routes/health';
import widgetsRouter from './routes/widgets';
import metricsRouter from './routes/metrics';
import dashboardRouter from '../embed/routes/dashboard';
import widgetRouter from '../embed/routes/widget';

// Allowed origins for CORS — sa_portal domains + localhost for dev.
// Update ALLOWED_ORIGINS env var in production.
function isAllowedOrigin(origin: string): boolean {
  const allowedPatterns = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Always allow localhost in development
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return true;
  }

  // Allow serviceup domains unconditionally
  if (origin.endsWith('.serviceup.com') || origin === 'https://app.serviceup.com') {
    return true;
  }

  return allowedPatterns.some((p) => origin === p || origin.endsWith(`.${p}`));
}

export function createServer() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.set('trust proxy', 1);

  // CORS — whitelist known origins rather than echoing anything
  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type');
    }

    // Remove X-Frame-Options for embed routes only
    if (req.path.startsWith('/embed/')) {
      res.removeHeader('X-Frame-Options');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Embed routes (HTML — auth handled per-route via embedAuthMiddleware)
  app.use('/embed/dashboard', dashboardRouter);
  app.use('/embed/widget', widgetRouter);

  // JSON API routes (internal)
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/widgets', apiKeyAuth, widgetsRouter);
  app.use('/api/v1/metrics', apiKeyAuth, metricsRouter);

  // Embed token generation endpoint (for sa_portal backend to call)
  app.post('/api/v1/embed-token', apiKeyAuth, (req, res) => {
    const fleetId = Number(req.body?.fleetId);
    const ttl = Number(req.body?.ttl) || 3600;

    if (!fleetId || isNaN(fleetId) || fleetId <= 0) {
      res.status(400).json({ error: 'fleetId must be a positive integer' });
      return;
    }

    // Clamp TTL to sane range: 5 minutes to 24 hours
    const clampedTtl = Math.max(300, Math.min(86400, ttl));
    const token = generateEmbedToken(fleetId, clampedTtl);
    res.json({ token, fleetId, expiresIn: clampedTtl });
  });

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

export async function startServer() {
  const app = createServer();
  const port = config.api.port;

  app.listen(port, () => {
    logger.info(`ServiceUp Insights running on port ${port}`, {
      env: process.env.NODE_ENV,
      port,
    });
    logger.info('Embed endpoints:', {
      dashboard: `http://localhost:${port}/embed/dashboard?fleetId=123&token=<token>`,
      widget: `http://localhost:${port}/embed/widget/cost-breakdown?fleetId=123&token=<token>`,
    });
    logger.info('API endpoints:', {
      health: `http://localhost:${port}/api/v1/health`,
      widgets: `http://localhost:${port}/api/v1/widgets?fleetId=123`,
    });
  });

  return app;
}
