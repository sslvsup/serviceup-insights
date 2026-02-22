import { renderLayout, escapeHtml } from './layout';
import { InsightCache, renderWidgetHtml } from './widgetRenderer';

// Map insight type → { icon, section, cols, colorClass }
const INSIGHT_META: Record<string, { icon: string; section: string; cols: number }> = {
  recall_alert:        { icon: '⚠️', section: '🚨 Safety & Alerts',      cols: 12 },
  repeat_repair:       { icon: '🔄', section: '🚨 Safety & Alerts',      cols: 12 },
  vehicle_risk:        { icon: '🚨', section: '🚗 Vehicle Intelligence',  cols: 6  },
  vehicle_health:      { icon: '🚗', section: '🚗 Vehicle Intelligence',  cols: 6  },
  concentration_risk:  { icon: '⚡', section: '🚗 Vehicle Intelligence',  cols: 6  },
  anomaly:             { icon: '🔍', section: '🚨 Safety & Alerts',      cols: 12 },
  cost_breakdown:      { icon: '💰', section: '📊 Cost Analysis',         cols: 6  },
  top_parts:           { icon: '🔩', section: '📊 Cost Analysis',         cols: 6  },
  parts_trend:         { icon: '📈', section: '📊 Cost Analysis',         cols: 6  },
  parts_quality:       { icon: '🔧', section: '📊 Cost Analysis',         cols: 6  },
  spend_spike:         { icon: '📊', section: '📊 Cost Analysis',         cols: 6  },
  seasonal:            { icon: '📅', section: '📊 Cost Analysis',         cols: 6  },
  turnaround_time:     { icon: '⏱️', section: '🏪 Shops & Vendors',       cols: 6  },
  shop_recommendation: { icon: '🏪', section: '🏪 Shops & Vendors',       cols: 6  },
  part_benchmark:      { icon: '⚖️', section: '🏪 Shops & Vendors',       cols: 6  },
  fleet_benchmark:     { icon: '📊', section: '🏪 Shops & Vendors',       cols: 6  },
  labor_rates:         { icon: '🔧', section: '🏪 Shops & Vendors',       cols: 6  },
  narrative:           { icon: '📋', section: '📝 Summary',               cols: 12 },
};

function getMeta(insightType: string) {
  return INSIGHT_META[insightType] ?? { icon: '💡', section: '📝 Summary', cols: 6 };
}

function fmtDollars(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Extract hero KPIs by scanning all insight detailJson */
function extractKpis(insights: InsightCache[]): Array<{ label: string; value: string; sub?: string; color: string; icon: string }> {
  const kpis: Array<{ label: string; value: string; sub?: string; color: string; icon: string }> = [];

  // Total spend: sum seasonal chart data, or look for spend fields
  let totalSpendCents = 0;
  let invoiceCount: number | null = null;
  let vehicleCount: number | null = null;

  for (const ins of insights) {
    const d = ins.detailJson ?? {};
    if (ins.insightType === 'seasonal' && Array.isArray(d.data)) {
      totalSpendCents = (d.data as number[]).reduce((a, b) => a + b, 0) * 100;
    }
    if (typeof d.invoice_count === 'number') invoiceCount = d.invoice_count;
    if (typeof d.vehicle_count === 'number') vehicleCount = d.vehicle_count;
    if (typeof d.total_spend === 'number' && totalSpendCents === 0) totalSpendCents = d.total_spend * 100;
  }

  if (totalSpendCents > 0) {
    kpis.push({ label: 'Total Spend', value: fmtDollars(totalSpendCents), sub: 'this period', color: 'c-blue', icon: '💳' });
  }
  if (invoiceCount !== null) {
    kpis.push({ label: 'Invoices', value: String(invoiceCount), sub: 'processed', color: 'c-purple', icon: '📄' });
  }
  if (vehicleCount !== null) {
    kpis.push({ label: 'Vehicles', value: String(vehicleCount), sub: 'with activity', color: 'c-teal', icon: '🚛' });
  }

  const urgentCount = insights.filter(i => i.priority <= 2).length;
  if (urgentCount > 0) {
    kpis.push({ label: 'Action Items', value: String(urgentCount), sub: 'need attention', color: 'c-red', icon: '🚨' });
  } else {
    kpis.push({ label: 'Insights', value: String(insights.length), sub: 'generated', color: 'c-green', icon: '✅' });
  }

  return kpis;
}

function renderKpiBar(kpis: ReturnType<typeof extractKpis>): string {
  const cards = kpis.map(k => `
    <div class="kpi-card ${escapeHtml(k.color)}">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-label">${escapeHtml(k.label)}</div>
      <div class="kpi-num">${escapeHtml(k.value)}</div>
      ${k.sub ? `<div class="kpi-sub">${escapeHtml(k.sub)}</div>` : ''}
    </div>`).join('');
  return `<div class="kpi-bar">${cards}</div>`;
}

function renderAlertBanner(insights: InsightCache[]): string {
  const p1 = insights.filter(i => i.priority === 1);
  const p2 = insights.filter(i => i.priority === 2 && !p1.length);
  const urgent = p1.length ? p1 : p2;
  if (!urgent.length) return '';
  const lvl = p1.length ? '' : 'lvl-2';
  const icon = p1.length ? '🚨' : '⚠️';
  const label = urgent.length === 1
    ? `${icon} Action required: ${escapeHtml(urgent[0].title)}`
    : `${icon} ${urgent.length} items need your attention`;
  return `
  <div class="alert-banner ${lvl}">
    <span style="flex:1">${label}</span>
    <span class="alert-banner-count">Priority ${p1.length ? '1' : '2'}</span>
  </div>`;
}

export function renderDashboardGrid(opts: {
  fleetId: number;
  insights: InsightCache[];
  theme?: 'light' | 'dark';
  period?: string;
}): string {
  const { fleetId, insights, theme = 'light', period = '90d' } = opts;

  if (insights.length === 0) {
    const body = `
    <div class="dash"><div class="dash-inner">
      <div class="empty" style="min-height:60vh;justify-content:center">
        <div class="empty-icon">📊</div>
        <div class="empty-text">No insights yet</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:6px;max-width:280px;text-align:center">
          Insights appear once invoice data has been processed for this fleet.
        </div>
      </div>
    </div></div>`;
    return renderLayout({ title: 'Fleet Insights', body, theme });
  }

  const sorted = [...insights].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));
  const kpis = extractKpis(sorted);
  const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Group by section, maintaining priority order within each section
  const sections = new Map<string, InsightCache[]>();
  for (const ins of sorted) {
    const { section } = getMeta(ins.insightType);
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(ins);
  }

  let gridInner = '';
  for (const [sectionName, sectionInsights] of sections) {
    gridInner += `<div class="section-label"><span>${sectionName}</span></div>`;
    for (const ins of sectionInsights) {
      const { cols } = getMeta(ins.insightType);
      const colClass = `col-${cols}`;
      gridInner += `
      <div class="${colClass}">
        ${renderWidgetHtml(ins, `w${ins.id}`)}
      </div>`;
    }
  }

  const body = `
  <div class="dash">
    <div class="dash-inner">
      <div class="dash-head">
        <div>
          <div class="dash-title">Fleet Insights</div>
          <div class="dash-meta">Fleet #${fleetId} &nbsp;·&nbsp; Updated ${escapeHtml(now)}</div>
        </div>
        <div class="period-pill">📅 Last ${escapeHtml(period)}</div>
      </div>
      ${renderKpiBar(kpis)}
      ${renderAlertBanner(sorted)}
      <div class="widget-grid">
        ${gridInner}
      </div>
      <div class="dash-footer">Powered by ServiceUp Insights &nbsp;·&nbsp; ${insights.length} insights generated</div>
    </div>
  </div>`;

  return renderLayout({ title: `Fleet #${fleetId} Insights`, body, theme, includeChartJs: true });
}
