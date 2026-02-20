import { escapeHtml } from './layout';

export interface AlertWidgetData {
  title: string;
  summary: string;
  priority: number;
  savingsEstimateCents?: number | null;
  alerts: Array<{
    headline: string;
    detail?: string;
    actionText?: string;
    severity?: 'critical' | 'warning' | 'info';
  }>;
}

export function renderAlertWidget(data: AlertWidgetData): string {
  const alertsHtml = data.alerts.map((alert) => {
    const colorMap = {
      critical: 'var(--color-error)',
      warning: 'var(--color-warning)',
      info: 'var(--color-info)',
    };
    const borderColor = colorMap[alert.severity ?? 'warning'];
    const icon = alert.severity === 'critical' ? '🚨' : alert.severity === 'info' ? 'ℹ️' : '⚠️';

    return `
    <div style="border-left:3px solid ${borderColor};padding:10px 12px;margin-bottom:8px;background:var(--color-surface);border-radius:0 var(--radius-sm) var(--radius-sm) 0;">
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <span style="font-size:16px;flex-shrink:0;">${icon}</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;color:var(--color-text-primary);">${escapeHtml(alert.headline)}</div>
          ${alert.detail ? `<div style="font-size:12px;color:var(--color-text-secondary);margin-top:3px;">${escapeHtml(alert.detail)}</div>` : ''}
          ${alert.actionText ? `<div style="font-size:12px;font-weight:600;color:${borderColor};margin-top:4px;">→ ${escapeHtml(alert.actionText)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const priorityBadge = data.priority <= 2
    ? `<span class="priority-badge priority-${data.priority}">${data.priority === 1 ? 'URGENT' : 'HIGH'}</span>`
    : '';

  const emptyHtml = data.alerts.length === 0
    ? `<div class="empty-state">✅ No alerts — looks good!</div>`
    : '';

  return `
  <div class="widget">
    <div class="widget-header">
      <div>
        <h3 class="widget-title">${escapeHtml(data.title)}</h3>
        <p class="widget-summary">${escapeHtml(data.summary)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${priorityBadge}</div>
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;margin-top:8px;">
      ${alertsHtml || emptyHtml}
    </div>
  </div>`;
}
