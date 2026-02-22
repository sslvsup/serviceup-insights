import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    });
  }
  return _prisma;
}

// Proxy wraps the lazy singleton so callers can write `prisma.foo` without
// calling getPrisma() themselves. `as any` is unavoidable here because the
// Proxy trap signature does not know which PrismaClient property is accessed.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (getPrisma() as unknown as Record<string | symbol, unknown>)[prop as string | symbol];
  },
});

export async function disconnectPrisma() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
    logger.info('Prisma disconnected');
  }
}
