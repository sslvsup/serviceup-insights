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

/**
 * Render a single insight as an HTML string (no full page wrapper).
 * Used inside dashboard grid or as standalone widget content.
 */
export function renderWidgetHtml(insight: InsightCache, widgetId = 'w0'): string {
  const widgetType = insight.widgetType ?? 'stat_card';
  const detail = insight.detailJson ?? {};

  switch (widgetType) {
    case 'chart_line':
    case 'chart_bar':
    case 'chart_pie':
    case 'chart_area': {
      const chartType = widgetType.replace('chart_', '') as 'line' | 'bar' | 'pie' | 'area';
      const data: ChartWidgetData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        savingsEstimateCents: insight.savingsEstimateCents,
        chartType,
        labels: (detail.labels as string[]) ?? [],
        datasets: (detail.datasets as ChartWidgetData['datasets']) ?? [
          { label: insight.title, data: (detail.data as number[]) ?? [] },
        ],
      };
      return renderChartWidget(data, widgetId);
    }

    case 'stat_card': {
      const data: StatCardData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        savingsEstimateCents: insight.savingsEstimateCents,
        value: String(detail.value ?? '—'),
        label: detail.label as string | undefined,
        delta: detail.delta as string | undefined,
        deltaDirection: detail.delta_direction as StatCardData['deltaDirection'],
        secondaryStats: detail.secondary_stats as StatCardData['secondaryStats'],
      };
      return renderStatCard(data);
    }

    case 'table':
    case 'comparison_table': {
      const data: TableWidgetData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        savingsEstimateCents: insight.savingsEstimateCents,
        columns: (detail.columns as TableWidgetData['columns']) ?? [{ key: 'value', label: 'Value' }],
        rows: (detail.rows as TableWidgetData['rows']) ?? [],
      };
      return renderTableWidget(data);
    }

    case 'narrative': {
      const data: NarrativeWidgetData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        savingsEstimateCents: insight.savingsEstimateCents,
        bullets: detail.bullets as string[] | undefined,
        narrativeHtml: detail.narrative_html as string | undefined,
      };
      return renderNarrativeWidget(data);
    }

    case 'alert': {
      const data: AlertWidgetData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        savingsEstimateCents: insight.savingsEstimateCents,
        alerts: (detail.alerts as AlertWidgetData['alerts']) ?? [
          { headline: insight.title, detail: insight.summary, severity: insight.priority === 1 ? 'critical' : 'warning' },
        ],
      };
      return renderAlertWidget(data);
    }

    default: {
      // Fallback: stat card
      const data: StatCardData = {
        title: insight.title,
        summary: insight.summary,
        priority: insight.priority,
        value: String(detail.value ?? '—'),
      };
      return renderStatCard(data);
    }
  }
}

/**
 * Render a single insight as a full, standalone HTML page.
 */
export function renderWidgetPage(
  insight: InsightCache,
  theme: 'light' | 'dark' = 'light',
): string {
  const widgetHtml = renderWidgetHtml(insight);
  const needsChartJs = ['chart_line', 'chart_bar', 'chart_pie', 'chart_area'].includes(insight.widgetType ?? '');

  return renderLayout({
    title: insight.title,
    body: widgetHtml,
    theme,
    includeChartJs: needsChartJs,
  });
}
