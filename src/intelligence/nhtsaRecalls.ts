import { logger } from '../utils/logger';

const NHTSA_API = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
const CONCURRENCY = 5; // max parallel NHTSA requests

export interface RecallAlert {
  vin: string;
  nhtsaCampaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  manufacturer: string;
  make: string;
  model: string;
  year: string;
}

interface NhtsaRecallResult {
  NHTSACampaignNumber: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  Manufacturer: string;
}

interface NhtsaResponse {
  Count: number;
  Results: NhtsaRecallResult[];
}

// In-process cache: key = "make:model:year" (lowercase), TTL = 7 days
const recallCache = new Map<string, { data: RecallAlert[]; expiresAt: number }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchRecallsForVehicle(
  v: { vin: string; make: string; model: string; year: string },
): Promise<RecallAlert[]> {
  const cacheKey = `${v.make}:${v.model}:${v.year}`.toLowerCase();
  const cached = recallCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    // Stamp the real VIN onto cached (VIN-agnostic) entries
    return cached.data.map((r) => ({ ...r, vin: v.vin }));
  }

  try {
    const url = `${NHTSA_API}?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&modelYear=${encodeURIComponent(v.year)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!resp.ok) {
      logger.warn('NHTSA API non-OK response', { status: resp.status, vehicle: cacheKey });
      return [];
    }

    const data = (await resp.json()) as NhtsaResponse;
    const vehicleRecalls: RecallAlert[] = (data.Results ?? []).map((r) => ({
      vin: v.vin,
      nhtsaCampaignNumber: r.NHTSACampaignNumber ?? '',
      component: r.Component ?? '',
      summary: r.Summary ?? '',
      consequence: r.Consequence ?? '',
      remedy: r.Remedy ?? '',
      manufacturer: r.Manufacturer ?? '',
      make: v.make,
      model: v.model,
      year: v.year,
    }));

    // Cache VIN-agnostic so the same make/model/year reuses the entry
    recallCache.set(cacheKey, {
      data: vehicleRecalls.map((r) => ({ ...r, vin: '' })),
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return vehicleRecalls;
  } catch (err) {
    logger.warn('Failed to fetch NHTSA recalls', {
      vehicle: cacheKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Check NHTSA Recalls API for a list of fleet vehicles.
 * Results are cached 7 days per make/model/year.
 * Runs up to CONCURRENCY parallel requests to avoid sequential bottleneck.
 */
export async function checkRecalls(
  vehicles: Array<{ vin: string; make: string; model: string; year: string }>,
): Promise<RecallAlert[]> {
  // De-duplicate by VIN so we don't hit the API multiple times for the same vehicle
  const seen = new Set<string>();
  const unique = vehicles.filter((v) => {
    if (!v.make || !v.model || !v.year || !v.vin) return false;
    if (seen.has(v.vin)) return false;
    seen.add(v.vin);
    return true;
  });

  const results: RecallAlert[] = [];

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const chunk = unique.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(fetchRecallsForVehicle));
    for (const r of chunkResults) results.push(...r);
  }

  return results;
}
