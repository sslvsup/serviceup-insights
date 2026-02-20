import { renderLayout } from './layout';
import { InsightCache } from './widgetRenderer';
import { renderWidgetHtml } from './widgetRenderer';

export function renderDashboardGrid(opts: {
  fleetId: number;
  insights: InsightCache[];
  theme?: 'light' | 'dark';
  period?: string;
}): string {
  const { fleetId, insights, theme = 'light', period = '90d' } = opts;

  if (insights.length === 0) {
    const body = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
      <div style="font-size:48px;">📊</div>
      <div style="font-size:18px;font-weight:600;color:var(--color-text-primary);">No insights yet</div>
      <div style="font-size:14px;color:var(--color-text-secondary);text-align:center;max-width:300px;">
        Insights will appear here once invoice data has been processed for this fleet.
      </div>
    </div>`;
    return renderLayout({ title: 'Fleet Insights', body, theme });
  }

  // Sort by priority
  const sorted = [...insights].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));

  const widgetCards = sorted.map((insight, i) => {
    const widgetHtml = renderWidgetHtml(insight, `w${i}`);
    const height = getWidgetHeight(insight.widgetType ?? 'stat_card');
    return `
    <div style="grid-column: span ${getColSpan(insight.widgetType ?? 'stat_card')};height:${height}px;overflow:hidden;">
      ${widgetHtml}
    </div>`;
  }).join('');

  const body = `
  <div style="padding:16px;min-height:100vh;background:var(--color-surface);">
    <div style="max-width:1200px;margin:0 auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <h1 style="margin:0;font-size:20px;font-weight:700;">Fleet Insights</h1>
          <p style="margin:4px 0 0;font-size:13px;color:var(--color-text-secondary);">Last ${period} • ${insights.length} insights</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;align-items:start;">
        ${widgetCards}
      </div>
    </div>
  </div>`;

  return renderLayout({ title: 'Fleet Insights', body, theme, includeChartJs: true });
}

function getColSpan(widgetType: string): number {
  if (widgetType === 'narrative' || widgetType === 'comparison_table') return 2;
  return 1;
}

function getWidgetHeight(widgetType: string): number {
  switch (widgetType) {
    case 'chart_line':
    case 'chart_bar':
    case 'chart_area': return 320;
    case 'chart_pie': return 300;
    case 'table':
    case 'comparison_table': return 280;
    case 'narrative': return 200;
    case 'alert': return 260;
    default: return 200;
  }
}
