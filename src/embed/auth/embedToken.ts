import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';

export interface EmbedTokenPayload {
  fleetId: number;
  iat?: number;
  exp?: number;
}

// Augment Express Request so downstream handlers have typed fleetId
declare global {
  namespace Express {
    interface Request {
      fleetId?: number;
    }
  }
}

/**
 * Generate a short-lived embed token for a fleet.
 * Used by the sa_portal backend when building iframe URLs.
 */
export function generateEmbedToken(fleetId: number, ttlSeconds = 3600): string {
  return jwt.sign({ fleetId }, config.api.embedSecret, { expiresIn: ttlSeconds });
}

/**
 * Validate an embed token from a query param.
 * Returns the payload if valid, throws if invalid/expired.
 */
export function verifyEmbedToken(token: string): EmbedTokenPayload {
  return jwt.verify(token, config.api.embedSecret) as EmbedTokenPayload;
}

/**
 * Express middleware to validate embed tokens on /embed/* routes.
 * Attaches req.fleetId on success, returns 401 otherwise.
 *
 * In development (NODE_ENV !== 'production'), a missing or invalid token
 * is still rejected — there is no bypass. Use a real JWT from
 * POST /api/v1/embed-token for local testing.
 */
export function embedAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(401).send('Missing embed token');
    return;
  }

  try {
    const payload = verifyEmbedToken(token);

    // Validate the fleetId in the token matches the query param if provided
    const qFleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : null;
    if (qFleetId !== null && qFleetId !== payload.fleetId) {
      res.status(403).send('Token fleetId mismatch');
      return;
    }

    req.fleetId = payload.fleetId;
    next();
  } catch {
    res.status(401).send('Invalid or expired embed token');
  }
}
