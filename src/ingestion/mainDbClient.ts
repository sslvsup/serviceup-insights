import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const DATASET = 'stitch__serviceup__prod_us';

interface MetabaseQueryResult {
  data: {
    rows: unknown[][];
    cols: { name: string }[];
  };
  error?: string;
}

/**
 * Execute a native SQL query via Metabase API → BigQuery (Stitch replica).
 */
async function queryViaMetabase(sql: string): Promise<Record<string, unknown>[]> {
  const { url, apiKey, databaseId } = config.metabase;

  if (!url || !apiKey) {
    throw new Error('METABASE_URL and METABASE_API_KEY must be set to query main app data');
  }

  logger.debug('Executing Metabase query', { databaseId, sqlPreview: sql.slice(0, 100) });

  const response = await axios.post<MetabaseQueryResult>(
    `${url}/api/dataset`,
    {
      database: databaseId,
      type: 'native',
      native: { query: sql },
    },
    {
      headers: { 'x-api-key': apiKey },
      timeout: 120_000,
    },
  );

  if (response.data.error) {
    throw new Error(`Metabase query error: ${response.data.error}`);
  }

  const { cols, rows } = response.data.data;
  const colNames = cols.map((c) => c.name);
  return rows.map((row) =>
    Object.fromEntries(colNames.map((name, i) => [name, row[i]])),
  );
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
  FROM \`${DATASET}.requests\` r
  LEFT JOIN \`${DATASET}.shops\` s ON r.shopid = s.id
  LEFT JOIN \`${DATASET}.vehicles\` v ON r.vehicleid = v.id
  LEFT JOIN \`${DATASET}.fleets\` f ON r.fleetid = f.id
`;

/**
 * Fetch new requests with invoice PDFs since the given timestamp.
 * Used by the nightly incremental pipeline.
 */
export async function getNewInvoicesSince(since: Date): Promise<InvoiceRow[]> {
  const sinceStr = since.toISOString();
  const rows = await queryViaMetabase(`
    ${BASE_SELECT}
    WHERE r.invoicepdfurl IS NOT NULL
      AND r._sdc_deleted_at IS NULL
      AND r.createdat > '${sinceStr}'
    ORDER BY r.createdat ASC
  `);
  return rows as unknown as InvoiceRow[];
}

/**
 * Fetch ALL requests with invoice PDFs.
 * Used by the one-time initial backfill only (~26,757 rows).
 */
export async function getAllInvoices(): Promise<InvoiceRow[]> {
  const rows = await queryViaMetabase(`
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
  const rows = await queryViaMetabase(`
    SELECT DISTINCT fleetid
    FROM \`${DATASET}.requests\`
    WHERE fleetid IS NOT NULL
      AND _sdc_deleted_at IS NULL
    ORDER BY fleetid
  `);
  return rows.map((r) => Number(r.fleetid)).filter(Boolean);
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
  const rows = await queryViaMetabase(`
    SELECT v.id, v.vin, v.make, v.model, v.year AS vehicle_year
    FROM \`${DATASET}.fleetVehicles\` fv
    JOIN \`${DATASET}.vehicles\` v ON fv.vehicleid = v.id
    WHERE fv.fleetid = ${fleetId}
      AND v.vin IS NOT NULL
  `);
  return rows as unknown as FleetVehicleRow[];
}
