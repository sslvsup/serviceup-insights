import { escapeHtml } from './layout';

export interface AlertWidgetData {
  title: string;
  summary: string;
  priority: number;
  savingsEstimateCents?: number | null;
  icon?: string;
  iconColor?: string;
  insightType?: string;
  alerts: Array<{
    headline: string;
    detail?: string;
    actionText?: string;
    severity?: 'critical' | 'warning' | 'info';
  }>;
}

export function renderAlertWidget(data: AlertWidgetData): string {
  const p = data.priority;
  const icon = data.icon ?? '⚠️';
  const iconColor = data.iconColor ?? (p === 1 ? 'red' : 'amber');

  const alertsHtml = data.alerts.map(alert => {
    const sev = alert.severity ?? (p === 1 ? 'critical' : 'warning');
    const sevClass = sev === 'critical' ? 'sev-c' : sev === 'info' ? 'sev-i' : 'sev-w';
    const alertIcon = sev === 'critical' ? '🚨' : sev === 'info' ? 'ℹ️' : '⚠️';
    const ctaClass = sev === 'critical' ? 'c' : 'w';
    return `
    <div class="alert-item ${sevClass}">
      <div class="alert-icon">${alertIcon}</div>
      <div>
        <div class="alert-headline">${escapeHtml(alert.headline)}</div>
        ${alert.detail ? `<div class="alert-detail">${escapeHtml(alert.detail)}</div>` : ''}
        ${alert.actionText ? `<div class="alert-cta ${ctaClass}">→ ${escapeHtml(alert.actionText)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const badgeHtml = p <= 2
    ? `<span class="badge ${p === 1 ? 'b-red' : 'b-amber'}">${p === 1 ? '🚨 Urgent' : '⚠️ High'}</span>`
    : '';

  return `
  <div class="widget p${p}">
    <div class="w-body">
      <div class="w-head">
        <div class="w-icon-box ${escapeHtml(iconColor)}">${icon}</div>
        <div class="w-title-g">
          <div class="w-title">${escapeHtml(data.title)}</div>
          <div class="w-summary">${escapeHtml(data.summary)}</div>
        </div>
      </div>
      ${badgeHtml ? `<div class="badge-row">${badgeHtml}</div>` : ''}
      <div class="w-div"></div>
      ${alertsHtml || '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No alerts</div></div>'}
    </div>
  </div>`;
}
