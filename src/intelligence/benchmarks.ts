import {
  getFleetPercentiles,
  getLaborRateBenchmark,
  getTopReplacedParts,
  getPartCostBenchmark,
} from '../metrics/metrics';
import { logger } from '../utils/logger';

export interface BenchmarkData {
  fleetPercentiles: Awaited<ReturnType<typeof getFleetPercentiles>>;
  laborRateBenchmark: Awaited<ReturnType<typeof getLaborRateBenchmark>>;
  topPartBenchmarks: Array<{
    partName: string;
    benchmark: Awaited<ReturnType<typeof getPartCostBenchmark>>;
  }>;
}

/**
 * Aggregate cross-fleet benchmark data for a fleet.
 * Computes fleet percentiles, labor rate benchmarks, and part cost comparisons
 * for the top replaced parts.
 */
export async function computeBenchmarks(
  fleetId: number,
  since: Date,
): Promise<BenchmarkData> {
  const [fleetPercentiles, laborRateBenchmark, topParts] = await Promise.all([
    getFleetPercentiles(fleetId, since).catch(() => {
      logger.warn('Fleet percentiles query failed', { fleetId });
      return [];
    }),
    getLaborRateBenchmark(fleetId, since).catch(() => {
      logger.warn('Labor rate benchmark query failed', { fleetId });
      return [];
    }),
    getTopReplacedParts(fleetId, since, 5).catch(() => {
      logger.warn('Top replaced parts query failed', { fleetId });
      return [];
    }),
  ]);

  // Get part cost benchmarks for top 5 parts
  const topPartBenchmarks = await Promise.all(
    topParts.map(async (part) => ({
      partName: part.name,
      benchmark: await getPartCostBenchmark(fleetId, part.name, since).catch(() => []),
    })),
  );

  return { fleetPercentiles, laborRateBenchmark, topPartBenchmarks };
}

export function formatBenchmarkForPrompt(data: BenchmarkData): string {
  const lines: string[] = [];

  const fmt = (n: number | null | undefined, decimals = 2) =>
    n != null ? Number(n).toFixed(decimals) : 'N/A';

  const p = data.fleetPercentiles?.[0];
  if (p) {
    lines.push('Fleet Spending Percentile:');
    lines.push(`  This fleet's avg invoice total: $${fmt(p.fleet_value)}`);
    lines.push(`  Platform p25: $${fmt(p.p25)}, p50: $${fmt(p.p50)}, p75: $${fmt(p.p75)}`);
    const rank = p.percentile_rank != null ? Math.round(Number(p.percentile_rank) * 100) : 'N/A';
    lines.push(`  Fleet rank: ${rank}th percentile across ${p.fleet_count ?? '?'} fleets`);
    lines.push('');
  }

  const lr = data.laborRateBenchmark?.[0];
  if (lr) {
    lines.push('Labor Rate Benchmark:');
    lines.push(`  This fleet's avg rate: $${fmt(lr.fleet_avg_rate)}/hr`);
    lines.push(`  Platform avg: $${fmt(lr.platform_avg_rate)}/hr`);
    lines.push(`  Platform p25: $${fmt(lr.platform_p25)}/hr, p75: $${fmt(lr.platform_p75)}/hr`);
    const diff = lr.pct_diff != null ? Number(lr.pct_diff) : null;
    const sign = diff != null && diff > 0 ? '+' : '';
    lines.push(`  vs Platform: ${diff != null ? `${sign}${diff.toFixed(1)}%` : 'N/A'} (${lr.fleet_count ?? '?'} fleets compared)`);
    lines.push('');
  }

  if (data.topPartBenchmarks.length > 0) {
    lines.push('Part Cost Benchmarks (vs platform):');
    for (const { partName, benchmark } of data.topPartBenchmarks) {
      const b = benchmark?.[0];
      if (b) {
        const diff = b.pct_diff != null ? Number(b.pct_diff) : null;
        const sign = diff != null && diff > 0 ? '+' : '';
        lines.push(`  ${partName}: Fleet avg $${fmt(b.fleet_avg_cost)}, Platform avg $${fmt(b.platform_avg_cost)} (${diff != null ? `${sign}${diff.toFixed(1)}%` : 'N/A'})`);
      }
    }
  }

  return lines.join('\n') || 'No benchmark data available.';
}
