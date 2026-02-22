import { BigQuery } from '@google-cloud/bigquery';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const BQ_PROJECT = 'serviceupios';
const DATASET = 'stitch__serviceup__prod_us';

// Uses Application Default Credentials (gcloud auth application-default login)
// Matt granted Sam's Google account BigQuery read access on the serviceupios project.
const bigquery = new BigQuery({ projectId: BQ_PROJECT });

/**
 * Execute a native SQL query directly against BigQuery via ADC.
 * Supports parameterized queries and enforces a job timeout.
 */
async function queryBigQuery(
  sql: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const sqlPreview = sql.trim().slice(0, 120);
  logger.debug('Executing BigQuery query', { sqlPreview });

  try {
    const job = await bigquery.createQueryJob({
      query: sql,
      location: 'US',
      params,
      jobTimeoutMs: config.processing.bigqueryTimeoutMs,
    });
    const [rows] = await job[0].getQueryResults({ maxResults: 50_000 });
    return rows as Record<string, unknown>[];
  } catch (err) {
    logger.error('BigQuery query failed', {
      sqlPreview,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export interface InvoiceRow {
  id: number;
  invoicepdfurl: string;
  shopid: number | null;
  vehicleid: number | null;
  fleetid: number | null;
  createdat: string;
  status: string;
  shop_name: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  vehicle_year: string | null;
  fleet_name: string | null;
}

const BASE_SELECT = `
  SELECT r.id, r.invoicepdfurl, r.shopid, r.vehicleid, r.fleetid, r.createdat, r.status,
         s.name AS shop_name,
         v.vin, v.make, v.model, v.year AS vehicle_year,
         f.name AS fleet_name
  FROM \`${BQ_PROJECT}.${DATASET}.requests\` r
  LEFT JOIN \`${BQ_PROJECT}.${DATASET}.shops\` s ON r.shopid = s.id
  LEFT JOIN \`${BQ_PROJECT}.${DATASET}.vehicles\` v ON r.vehicleid = v.id
  LEFT JOIN \`${BQ_PROJECT}.${DATASET}.fleets\` f ON r.fleetid = f.id
`;

/**
 * Fetch new requests with invoice PDFs since the given timestamp.
 * Used by the nightly incremental pipeline.
 */
export async function getNewInvoicesSince(since: Date): Promise<InvoiceRow[]> {
  const rows = await queryBigQuery(`
    ${BASE_SELECT}
    WHERE r.invoicepdfurl IS NOT NULL
      AND r._sdc_deleted_at IS NULL
      AND r.createdat > @since
    ORDER BY r.createdat ASC
  `, { since: since.toISOString() });
  return rows as unknown as InvoiceRow[];
}

/**
 * Fetch ALL requests with invoice PDFs.
 * Used by the one-time initial backfill only (~26,757 rows).
 */
export async function getAllInvoices(): Promise<InvoiceRow[]> {
  const rows = await queryBigQuery(`
    ${BASE_SELECT}
    WHERE r.invoicepdfurl IS NOT NULL
      AND r._sdc_deleted_at IS NULL
    ORDER BY r.createdat ASC
  `);
  return rows as unknown as InvoiceRow[];
}

/**
 * Fetch all active fleet IDs from the platform.
 */
export async function getActiveFleetIds(): Promise<number[]> {
  const rows = await queryBigQuery(`
    SELECT DISTINCT fleetid
    FROM \`${BQ_PROJECT}.${DATASET}.requests\`
    WHERE fleetid IS NOT NULL
      AND _sdc_deleted_at IS NULL
    ORDER BY fleetid
  `);
  return rows.map((r) => Number(r['fleetid'])).filter(Boolean);
}

export interface FleetVehicleRow {
  id: number;
  vin: string;
  make: string;
  model: string;
  vehicle_year: string;
}

/**
 * Fetch all fleet vehicles with VINs for NHTSA recall checks.
 */
export async function getFleetVehicles(fleetId: number): Promise<FleetVehicleRow[]> {
  const rows = await queryBigQuery(`
    SELECT v.id, v.vin, v.make, v.model, v.year AS vehicle_year
    FROM \`${BQ_PROJECT}.${DATASET}.fleetVehicles\` fv
    JOIN \`${BQ_PROJECT}.${DATASET}.vehicles\` v ON fv.vehicleid = v.id
    WHERE fv.fleetid = @fleetId
      AND v.vin IS NOT NULL
  `, { fleetId });
  return rows as unknown as FleetVehicleRow[];
}
