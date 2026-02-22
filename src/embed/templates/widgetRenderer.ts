import { renderLayout } from './layout';
import { renderChartWidget, ChartWidgetData } from './chartWidget';
import { renderStatCard, StatCardData } from './statCard';
import { renderTableWidget, TableWidgetData } from './tableWidget';
import { renderNarrativeWidget, NarrativeWidgetData } from './narrativeWidget';
import { renderAlertWidget, AlertWidgetData } from './alertWidget';

export interface InsightCache {
  id: number;
  fleetId: number | null;
  insightType: string;
  title: string;
  summary: string;
  widgetType: string | null;
  detailJson: Record<string, unknown>;
  priority: number;
  audience: string;
  savingsEstimateCents?: number | null;
}

/** Icon + accent color per insight type */
const INSIGHT_STYLE: Record<string, { icon: string; color: string }> = {
  vehicle_health:      { icon: '🚗', color: 'amber' },
  recall_alert:        { icon: '⚠️', color: 'red'   },
  anomaly:             { icon: '🔍', color: 'red'   },
  repeat_repair:       { icon: '🔄', color: 'red'   },
  vehicle_risk:        { icon: '🚨', color: 'red'   },
  concentration_risk:  { icon: '⚡', color: 'amber' },
  turnaround_time:     { icon: '⏱️', color: 'amber' },
  spend_spike:         { icon: '📊', color: 'red'   },
  cost_breakdown:      { icon: '💰', color: 'blue'  },
  top_parts:           { icon: '🔩', color: 'blue'  },
  parts_trend:         { icon: '📈', color: 'blue'  },
  parts_quality:       { icon: '🔧', color: 'teal'  },
  seasonal:            { icon: '📅', color: 'purple' },
  shop_recommendation: { icon: '🏪', color: 'teal'  },
  part_benchmark:      { icon: '⚖️', color: 'green' },
  fleet_benchmark:     { icon: '📊', color: 'green' },
  labor_rates:         { icon: '🔧', color: 'teal'  },
  narrative:           { icon: '📋', color: 'gray'  },
};

function getStyle(insightType: string) {
  return INSIGHT_STYLE[insightType] ?? { icon: '💡', color: 'blue' };
}

/**
 * Normalize the LLM's part_benchmark data:
 *   headers: string[], rows: string[][] → columns + rows as objects
 */
function normalizeBenchmarkTable(detail: Record<string, unknown>): { columns: TableWidgetData['columns']; rows: TableWidgetData['rows'] } {
  const headers = (detail.headers as string[] | undefined) ?? (detail.columns as string[] | undefined);
  const rawRows = detail.rows as Array<string[] | Record<string, unknown>> | undefined;

  if (!headers || !rawRows) return { columns: [{ key: 'value', label: 'Value' }], rows: [] };

  const columns: TableWidgetData['columns'] = headers.map((h, i) => ({
    key: `c${i}`,
    label: h,
    align: i > 0 ? 'right' : 'left',
  }));

  const rows: TableWidgetData['rows'] = rawRows.map(row => {
    if (Array.isArray(row)) {
      return Object.fromEntries(row.map((v, i) => [`c${i}`, v as string | number | null]));
    }
    return Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v as string | number | null]),
    );
  });

  return { columns, rows };
}

export function renderWidgetHtml(insight: InsightCache, widgetId = 'w0'): string {
  const widgetType = insight.widgetType ?? 'stat_card';
  const detail = insight.detailJson ?? {};
  const style = getStyle(insight.insightType);
  const common = {
    title: insight.title,
    summary: insight.summary,
    priority: insight.priority,
    savingsEstimateCents: insight.savingsEstimateCents,
    icon: style.icon,
    iconColor: style.color,
    insightType: insight.insightType,
  };

  switch (widgetType) {
    case 'chart_line':
    case 'chart_bar':
    case 'chart_pie':
    case 'chart_area': {
      const chartType = widgetType.replace('chart_', '') as 'line' | 'bar' | 'pie' | 'area';
      const data: ChartWidgetData = {
        ...common,
        chartType,
        labels: (detail.labels as string[]) ?? [],
        datasets: (detail.datasets as ChartWidgetData['datasets']) ?? [
          { label: insight.title, data: (detail.data as number[]) ?? [] },
        ],
      };
      return renderChartWidget(data, widgetId);
    }

    case 'stat_card': {
      // Handle top_parts format: { part_name, total_cost }
      let value = detail.value != null ? String(detail.value) : '—';
      let label = detail.label as string | undefined;
      if (insight.insightType === 'top_parts') {
        if (typeof detail.total_cost === 'number') {
          value = `$${detail.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          label = detail.part_name as string | undefined ?? label;
        }
      }
      const data: StatCardData = {
        ...common,
        value,
        label,
        delta: detail.delta as string | undefined,
        deltaDirection: detail.delta_direction as StatCardData['deltaDirection'],
        secondaryStats: detail.secondary_stats as StatCardData['secondaryStats'],
        extraChip: insight.insightType === 'top_parts' && detail.part_name
          ? { label: 'Top Part', value: String(detail.part_name) }
          : undefined,
      };
      return renderStatCard(data);
    }

    case 'table':
    case 'comparison_table': {
      // Handle LLM-generated headers+rows (arrays) vs expected columns+rows (objects)
      const { columns, rows } = normalizeBenchmarkTable(detail);
      const data: TableWidgetData = {
        ...common,
        columns: (detail.columns as TableWidgetData['columns']) ?? columns,
        rows: (detail.rows as TableWidgetData['rows'] | undefined) && !Array.isArray((detail.rows as unknown[])?.[0])
          ? (detail.rows as TableWidgetData['rows'])
          : rows,
        isDiffTable: insight.insightType === 'part_benchmark',
      };
      return renderTableWidget(data);
    }

    case 'narrative': {
      // Enrich narrative with structured data chips where available
      const data: NarrativeWidgetData = {
        ...common,
        bullets: detail.bullets as string[] | undefined,
        chips: buildNarrativeChips(insight),
      };
      return renderNarrativeWidget(data);
    }

    case 'alert': {
      const data: AlertWidgetData = {
        ...common,
        alerts: (detail.alerts as AlertWidgetData['alerts']) ?? [
          { headline: insight.title, detail: insight.summary, severity: insight.priority === 1 ? 'critical' : 'warning' },
        ],
      };
      return renderAlertWidget(data);
    }

    default: {
      const data: StatCardData = { ...common, value: String(detail.value ?? '—') };
      return renderStatCard(data);
    }
  }
}

/** Extract structured data chips to surface key numbers inside narrative cards */
function buildNarrativeChips(insight: InsightCache): Array<{ label: string; value: string }> {
  const d = insight.detailJson ?? {};
  const chips: Array<{ label: string; value: string }> = [];

  if (insight.insightType === 'vehicle_health' && d.vin_involved) {
    chips.push({ label: 'VIN', value: String(d.vin_involved) });
  }
  if (insight.insightType === 'shop_recommendation' && d.dominant_shop) {
    chips.push({ label: 'Shop', value: String(d.dominant_shop) });
  }
  if (insight.insightType === 'cost_breakdown' && typeof d.other_spend_amount === 'number') {
    chips.push({ label: '"Other" Spend', value: `$${(d.other_spend_amount as number).toLocaleString('en-US', { minimumFractionDigits: 2 })}` });
  }
  if (typeof d.invoice_count === 'number') chips.push({ label: 'Invoices', value: String(d.invoice_count) });
  if (typeof d.vehicle_count === 'number') chips.push({ label: 'Vehicles', value: String(d.vehicle_count) });

  return chips;
}

export function renderWidgetPage(insight: InsightCache, theme: 'light' | 'dark' = 'light'): string {
  const widgetHtml = renderWidgetHtml(insight);
  const needsChartJs = ['chart_line', 'chart_bar', 'chart_pie', 'chart_area'].includes(insight.widgetType ?? '');
  return renderLayout({ title: insight.title, body: widgetHtml, theme, includeChartJs: needsChartJs });
}
