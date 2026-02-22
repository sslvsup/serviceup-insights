import { getPrisma } from '../db/prisma';

const prisma = getPrisma();

// ── Spending ───────────────────────────────────────────────────────────────

export async function getTotalSpend(fleetId: number, since: Date): Promise<number> {
  const result = await prisma.parsedInvoice.aggregate({
    _sum: { grandTotalCents: true },
    where: {
      fleetId,
      OR: [{ invoiceDate: { gte: since } }, { invoiceDate: null }],
      parseStatus: 'completed',
    },
  });
  return (result._sum.grandTotalCents ?? 0) / 100;
}

export async function getSpendByShop(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ shop_name: string; total: number; invoice_count: number }[]>`
    SELECT pdf_shop_name AS shop_name,
           SUM(grand_total_cents) / 100.0 AS total,
           COUNT(*)::int AS invoice_count
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId}
      AND (invoice_date >= ${since} OR invoice_date IS NULL)
      AND parse_status = 'completed'
    GROUP BY pdf_shop_name
    ORDER BY total DESC
  `;
}

export async function getMonthlySpend(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ month: string; total: number; invoice_count: number }[]>`
    SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS month,
           SUM(grand_total_cents) / 100.0 AS total,
           COUNT(*)::int AS invoice_count
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId}
      AND invoice_date >= ${since}
      AND parse_status = 'completed'
    GROUP BY month
    ORDER BY month
  `;
}

// ── Labor ──────────────────────────────────────────────────────────────────

export async function getAvgLaborRateByShop(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ shop_name: string; avg_rate: number; labor_invoice_count: number }[]>`
    SELECT pi.pdf_shop_name AS shop_name,
           AVG((li.item_data->>'rate_per_hour')::numeric) AS avg_rate,
           COUNT(DISTINCT pi.id)::int AS labor_invoice_count
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
      AND li.item_type = 'labor'
      AND li.item_data->>'rate_per_hour' IS NOT NULL
    GROUP BY pi.pdf_shop_name
    ORDER BY avg_rate DESC
  `;
}

export async function getLaborHoursByShop(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ shop_name: string; total_hours: number; avg_hours_per_invoice: number }[]>`
    SELECT pi.pdf_shop_name AS shop_name,
           SUM((li.item_data->>'hours')::numeric) AS total_hours,
           AVG((li.item_data->>'hours')::numeric) AS avg_hours_per_invoice
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
      AND li.item_type = 'labor'
      AND li.item_data->>'hours' IS NOT NULL
    GROUP BY pi.pdf_shop_name
    ORDER BY total_hours DESC
  `;
}

// ── Parts ──────────────────────────────────────────────────────────────────

export async function getTopReplacedParts(fleetId: number, since: Date, limit = 10) {
  return prisma.$queryRaw<{ name: string; count: number; avg_cost: number; total_cost: number }[]>`
    SELECT li.name,
           COUNT(*)::int AS count,
           AVG(li.unit_price_cents) / 100.0 AS avg_cost,
           SUM(li.total_price_cents) / 100.0 AS total_cost
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
      AND li.item_type = 'part'
    GROUP BY li.name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

export async function getPartPriceTrend(fleetId: number, partName: string, since: Date) {
  return prisma.$queryRaw<{ month: string; avg_price: number; count: number }[]>`
    SELECT TO_CHAR(pi.invoice_date, 'YYYY-MM') AS month,
           AVG(li.unit_price_cents) / 100.0 AS avg_price,
           COUNT(*)::int AS count
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE pi.fleet_id = ${fleetId}
      AND pi.invoice_date >= ${since}
      AND li.item_type = 'part'
      AND li.name ILIKE ${'%' + partName + '%'}
    GROUP BY month
    ORDER BY month
  `;
}

// ── Cost Breakdown ─────────────────────────────────────────────────────────

export async function getCostBreakdown(fleetId: number, since: Date) {
  return prisma.$queryRaw<{ category: string; total: number; pct: number }[]>`
    WITH breakdown AS (
      SELECT
        CASE
          WHEN li.item_type = 'labor' THEN 'Labor'
          WHEN li.item_type = 'part' THEN 'Parts'
          WHEN li.item_type IN ('fee', 'shop_supply', 'hazmat', 'environmental') THEN 'Fees'
          WHEN li.item_type = 'discount' THEN 'Discounts'
          WHEN li.item_type = 'tax' THEN 'Tax'
          ELSE 'Other'
        END AS category,
        SUM(li.total_price_cents) / 100.0 AS total
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE pi.fleet_id = ${fleetId}
        AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
        AND pi.parse_status = 'completed'
      GROUP BY category
    )
    SELECT category, total,
           ROUND(100.0 * total / NULLIF(SUM(total) OVER (), 0), 1) AS pct
    FROM breakdown
    ORDER BY total DESC
  `;
}

// ── Anomalies ──────────────────────────────────────────────────────────────

export async function getAnomalies(
  fleetId: number,
  since: Date,
  stddevThreshold = 2,
) {
  return prisma.$queryRaw<{
    invoice_id: number;
    request_id: number;
    name: string;
    price: number;
    avg: number;
    stddev: number;
    z_score: number;
    shop_name: string;
  }[]>`
    WITH stats AS (
      SELECT li.name,
             AVG(li.unit_price_cents) AS avg_price,
             STDDEV(li.unit_price_cents) AS stddev_price
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE pi.fleet_id = ${fleetId}
        AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
        AND li.item_type IN ('part', 'labor')
      GROUP BY li.name
      HAVING COUNT(*) >= 3
    )
    SELECT li.parsed_invoice_id AS invoice_id,
           pi.request_id,
           li.name,
           li.unit_price_cents / 100.0 AS price,
           s.avg_price / 100.0 AS avg,
           s.stddev_price / 100.0 AS stddev,
           ABS(li.unit_price_cents - s.avg_price) / NULLIF(s.stddev_price, 0) AS z_score,
           pi.pdf_shop_name AS shop_name
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    JOIN stats s ON li.name = s.name
    WHERE pi.fleet_id = ${fleetId}
      AND ABS(li.unit_price_cents - s.avg_price) > ${stddevThreshold} * NULLIF(s.stddev_price, 0)
    ORDER BY ABS(li.unit_price_cents - s.avg_price) / NULLIF(s.stddev_price, 0) DESC
    LIMIT 20
  `;
}

// ── Vehicle Health ─────────────────────────────────────────────────────────

export async function getVehicleRepairFrequency(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    vin: string;
    unit: string;
    repair_count: number;
    total_spend: number;
    last_repair_date: string;
  }[]>`
    SELECT pdf_vin AS vin,
           extracted_data->>'vehicle_unit' AS unit,
           COUNT(*)::int AS repair_count,
           SUM(grand_total_cents) / 100.0 AS total_spend,
           MAX(invoice_date)::text AS last_repair_date
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId}
      AND (invoice_date >= ${since} OR invoice_date IS NULL)
      AND parse_status = 'completed'
    GROUP BY pdf_vin, extracted_data->>'vehicle_unit'
    ORDER BY repair_count DESC
  `;
}

// ── Cross-Fleet Benchmarks ─────────────────────────────────────────────────

export async function getFleetPercentiles(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    metric: string;
    fleet_value: number;
    p25: number;
    p50: number;
    p75: number;
    percentile_rank: number;
    fleet_count: number;
  }[]>`
    WITH fleet_metrics AS (
      SELECT fleet_id,
             AVG(grand_total_cents) / 100.0 AS avg_invoice_total,
             SUM(labor_total_cents) / 100.0 / NULLIF(COUNT(*), 0) AS avg_labor_per_invoice,
             SUM(parts_total_cents) / 100.0 / NULLIF(COUNT(*), 0) AS avg_parts_per_invoice
      FROM parsed_invoices
      WHERE invoice_date >= ${since}
        AND parse_status = 'completed'
        AND fleet_id IS NOT NULL
      GROUP BY fleet_id
      HAVING COUNT(*) >= 5
    ),
    percentiles AS (
      SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY avg_invoice_total) AS p25_total,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY avg_invoice_total) AS p50_total,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY avg_invoice_total) AS p75_total,
        COUNT(*) AS fleet_count
      FROM fleet_metrics
    )
    SELECT
      'avg_invoice_total' AS metric,
      fm.avg_invoice_total AS fleet_value,
      p.p25_total AS p25,
      p.p50_total AS p50,
      p.p75_total AS p75,
      PERCENT_RANK() OVER (ORDER BY fm.avg_invoice_total) AS percentile_rank,
      p.fleet_count::int AS fleet_count
    FROM fleet_metrics fm, percentiles p
    WHERE fm.fleet_id = ${fleetId}
  `;
}

export async function getLaborRateBenchmark(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    fleet_avg_rate: number;
    platform_avg_rate: number;
    platform_p25: number;
    platform_p75: number;
    pct_diff: number;
    fleet_count: number;
  }[]>`
    WITH fleet_rates AS (
      SELECT pi.fleet_id,
             AVG((li.item_data->>'rate_per_hour')::numeric) AS avg_rate
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE li.item_type = 'labor'
        AND li.item_data->>'rate_per_hour' IS NOT NULL
        AND pi.invoice_date >= ${since}
        AND pi.fleet_id IS NOT NULL
      GROUP BY pi.fleet_id
      HAVING COUNT(*) >= 3
    )
    SELECT
      f.avg_rate AS fleet_avg_rate,
      AVG(a.avg_rate) AS platform_avg_rate,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY a.avg_rate) AS platform_p25,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY a.avg_rate) AS platform_p75,
      ((f.avg_rate - AVG(a.avg_rate)) / NULLIF(AVG(a.avg_rate), 0) * 100) AS pct_diff,
      COUNT(a.fleet_id)::int AS fleet_count
    FROM fleet_rates f, fleet_rates a
    WHERE f.fleet_id = ${fleetId}
    GROUP BY f.avg_rate
  `;
}

export async function getPartCostBenchmark(fleetId: number, partName: string, since: Date) {
  return prisma.$queryRaw<{
    fleet_avg_cost: number;
    platform_avg_cost: number;
    pct_diff: number;
    fleet_count: number;
  }[]>`
    SELECT
      AVG(CASE WHEN pi.fleet_id = ${fleetId} THEN li.unit_price_cents END) / 100.0 AS fleet_avg_cost,
      AVG(li.unit_price_cents) / 100.0 AS platform_avg_cost,
      ((AVG(CASE WHEN pi.fleet_id = ${fleetId} THEN li.unit_price_cents END) - AVG(li.unit_price_cents))
        / NULLIF(AVG(li.unit_price_cents), 0) * 100) AS pct_diff,
      COUNT(DISTINCT pi.fleet_id)::int AS fleet_count
    FROM parsed_invoice_line_items li
    JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
    WHERE li.item_type = 'part'
      AND li.name ILIKE ${'%' + partName + '%'}
      AND pi.invoice_date >= ${since}
  `;
}

// ── Vehicle Multiple Visits ─────────────────────────────────────────────────

export async function getVehicleMultipleVisits(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    vin: string;
    unit: string | null;
    visit_count: number;
    total_spend: number;
    first_visit: string;
    last_visit: string;
    shops: string;
  }[]>`
    SELECT
      pdf_vin AS vin,
      MAX(extracted_data->>'vehicle_unit') AS unit,
      COUNT(*)::int AS visit_count,
      SUM(grand_total_cents) / 100.0 AS total_spend,
      MIN(invoice_date)::text AS first_visit,
      MAX(invoice_date)::text AS last_visit,
      STRING_AGG(DISTINCT pdf_shop_name, ', ') AS shops
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId}
      AND (invoice_date >= ${since} OR invoice_date IS NULL)
      AND parse_status = 'completed'
      AND pdf_vin IS NOT NULL
    GROUP BY pdf_vin
    HAVING COUNT(*) > 1
    ORDER BY total_spend DESC
    LIMIT 10
  `;
}

// ── Shop Turnaround Time ────────────────────────────────────────────────────

export async function getShopTurnaround(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    shop_name: string;
    avg_days: number;
    max_days: number;
    invoice_count: number;
  }[]>`
    SELECT
      pdf_shop_name AS shop_name,
      ROUND(AVG(
        GREATEST(0, (extracted_data->>'date_out')::date - (extracted_data->>'date_in')::date)
      )::numeric, 1) AS avg_days,
      MAX(
        GREATEST(0, (extracted_data->>'date_out')::date - (extracted_data->>'date_in')::date)
      ) AS max_days,
      COUNT(*)::int AS invoice_count
    FROM parsed_invoices
    WHERE fleet_id = ${fleetId}
      AND (invoice_date >= ${since} OR invoice_date IS NULL)
      AND parse_status = 'completed'
      AND extracted_data->>'date_in' IS NOT NULL
      AND extracted_data->>'date_out' IS NOT NULL
      AND (extracted_data->>'date_out')::date > (extracted_data->>'date_in')::date
    GROUP BY pdf_shop_name
    ORDER BY avg_days DESC
  `;
}

// ── Parts Quality Mix ───────────────────────────────────────────────────────

export async function getPartsQualityMix(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    quality_type: string;
    count: number;
    total_cost: number;
    pct: number;
  }[]>`
    WITH parts_mix AS (
      SELECT
        CASE
          WHEN (li.item_data->>'is_oem')::boolean = true THEN 'OEM'
          WHEN (li.item_data->>'is_aftermarket')::boolean = true THEN 'Aftermarket'
          WHEN (li.item_data->>'is_used')::boolean = true THEN 'Used/Salvage'
          WHEN (li.item_data->>'is_remanufactured')::boolean = true THEN 'Remanufactured'
          ELSE 'Unspecified'
        END AS quality_type,
        COUNT(*)::int AS cnt,
        SUM(li.total_price_cents) / 100.0 AS total_cost
      FROM parsed_invoice_line_items li
      JOIN parsed_invoices pi ON li.parsed_invoice_id = pi.id
      WHERE pi.fleet_id = ${fleetId}
        AND (pi.invoice_date >= ${since} OR pi.invoice_date IS NULL)
        AND li.item_type = 'part'
      GROUP BY quality_type
    )
    SELECT quality_type, cnt AS count, total_cost,
           ROUND(100.0 * cnt / NULLIF(SUM(cnt) OVER (), 0), 1) AS pct
    FROM parts_mix
    ORDER BY total_cost DESC
  `;
}

// ── Spend Velocity ──────────────────────────────────────────────────────────

export async function getSpendVelocity(fleetId: number, since: Date) {
  return prisma.$queryRaw<{
    period: string;
    total: number;
    invoice_count: number;
    mom_change_pct: number | null;
  }[]>`
    WITH monthly AS (
      SELECT
        TO_CHAR(invoice_date, 'YYYY-MM') AS period,
        SUM(grand_total_cents) / 100.0 AS total,
        COUNT(*)::int AS invoice_count
      FROM parsed_invoices
      WHERE fleet_id = ${fleetId}
        AND invoice_date >= ${since}
        AND parse_status = 'completed'
      GROUP BY period
    )
    SELECT
      period,
      total,
      invoice_count,
      ROUND(
        100.0 * (total - LAG(total) OVER (ORDER BY period)) / NULLIF(LAG(total) OVER (ORDER BY period), 0),
        1
      ) AS mom_change_pct
    FROM monthly
    ORDER BY period
  `;
}

// ── Summary stats ──────────────────────────────────────────────────────────

export async function getFleetSummary(fleetId: number, since: Date) {
  const result = await prisma.parsedInvoice.aggregate({
    where: {
      fleetId,
      OR: [{ invoiceDate: { gte: since } }, { invoiceDate: null }],
      parseStatus: 'completed',
    },
    _sum: { grandTotalCents: true, laborTotalCents: true, partsTotalCents: true },
    _count: { id: true },
    _avg: { grandTotalCents: true },
  });

  const shops = await prisma.parsedInvoice.groupBy({
    by: ['pdfShopName'],
    where: {
      fleetId,
      OR: [{ invoiceDate: { gte: since } }, { invoiceDate: null }],
      parseStatus: 'completed',
    },
  });

  const vehicles = await prisma.parsedInvoice.groupBy({
    by: ['pdfVin'],
    where: {
      fleetId,
      OR: [{ invoiceDate: { gte: since } }, { invoiceDate: null }],
      parseStatus: 'completed',
    },
  });

  return {
    totalSpend: (result._sum.grandTotalCents ?? 0) / 100,
    totalLabor: (result._sum.laborTotalCents ?? 0) / 100,
    totalParts: (result._sum.partsTotalCents ?? 0) / 100,
    invoiceCount: result._count.id,
    avgInvoiceTotal: (result._avg.grandTotalCents ?? 0) / 100,
    shopCount: shops.filter((s) => s.pdfShopName).length,
    vehicleCount: vehicles.filter((v) => v.pdfVin).length,
  };
}
