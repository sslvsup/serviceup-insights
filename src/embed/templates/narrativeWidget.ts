import { escapeHtml } from './layout';

export interface NarrativeWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  icon?: string;
  iconColor?: string;
  insightType?: string;
  bullets?: string[];
  chips?: Array<{ label: string; value: string }>;
}

const ACTION_TEXT: Record<string, string> = {
  vehicle_health:      'Review incident report →',
  anomaly:             'Investigate discrepancy →',
  cost_breakdown:      'Review spend categories →',
  shop_recommendation: 'Diversify shop network →',
  recall_alert:        'Schedule recall service →',
  narrative:           'View full report →',
};

export function renderNarrativeWidget(data: NarrativeWidgetData): string {
  const p = data.priority ?? 3;
  const icon = data.icon ?? '📋';
  const iconColor = data.iconColor ?? 'gray';

  const badgeHtml = p === 1
    ? `<span class="badge b-red">🚨 Urgent</span>`
    : p === 2 ? `<span class="badge b-amber">⚠️ High Priority</span>` : '';

  const savingsHtml = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  const chipsHtml = data.chips && data.chips.length > 0
    ? data.chips.map(c => `
      <div class="data-chip">
        <div class="data-chip-lbl">${escapeHtml(c.label)}</div>
        <div class="data-chip-val">${escapeHtml(c.value)}</div>
      </div>`).join('')
    : '';

  let contentHtml = '';
  if (data.bullets && data.bullets.length > 0) {
    const items = data.bullets.map(b =>
      `<li><span class="b-dot"></span><span>${escapeHtml(b)}</span></li>`
    ).join('');
    contentHtml = `<ul class="bullet-list">${items}</ul>`;
  } else {
    contentHtml = `<p class="narrative-text">${escapeHtml(data.summary)}</p>`;
  }

  const actionText = (data.insightType && ACTION_TEXT[data.insightType]) ?? '';
  const actionBar = (badgeHtml || savingsHtml || actionText) ? `
    <div class="action-bar">
      <div class="badge-row" style="margin-top:0">${badgeHtml}${savingsHtml}</div>
      ${actionText ? `<span class="action-link">${escapeHtml(actionText)}</span>` : ''}
    </div>` : '';

  return `
  <div class="widget p${p}">
    <div class="w-body">
      <div class="w-head">
        <div class="w-icon-box ${escapeHtml(iconColor)}">${icon}</div>
        <div class="w-title-g">
          <div class="w-title">${escapeHtml(data.title)}</div>
        </div>
      </div>
      ${chipsHtml}
      ${chipsHtml ? '<div class="w-div"></div>' : ''}
      ${contentHtml}
      ${actionBar}
    </div>
  </div>`;
}
