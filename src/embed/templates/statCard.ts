import { escapeHtml } from './layout';

export interface StatCardData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  icon?: string;
  iconColor?: string;
  insightType?: string;
  value: string;
  label?: string;
  delta?: string;
  deltaDirection?: 'positive' | 'negative' | 'neutral';
  secondaryStats?: Array<{ label: string; value: string }>;
  extraChip?: { label: string; value: string };
}

export function renderStatCard(data: StatCardData): string {
  const p = data.priority ?? 3;
  const icon = data.icon ?? '💡';
  const iconColor = data.iconColor ?? 'blue';

  const badgeHtml = p <= 2
    ? `<span class="badge ${p === 1 ? 'b-red' : 'b-amber'}">${p === 1 ? '🚨 Urgent' : '⚠️ High'}</span>`
    : '';

  const savingsHtml = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  const deltaClass = data.deltaDirection === 'positive' ? 'up' : data.deltaDirection === 'negative' ? 'down' : 'flat';
  const deltaArrow = data.deltaDirection === 'positive' ? '↑' : data.deltaDirection === 'negative' ? '↓' : '→';
  const deltaHtml = data.delta
    ? `<div class="stat-delta ${deltaClass}">${deltaArrow} ${escapeHtml(data.delta)}</div>`
    : '';

  const secondaryHtml = data.secondaryStats && data.secondaryStats.length > 0
    ? `<div class="stat-meta">${data.secondaryStats.map(s => `
        <div class="stat-meta-cell">
          <div class="stat-meta-lbl">${escapeHtml(s.label)}</div>
          <div class="stat-meta-val">${escapeHtml(s.value)}</div>
        </div>`).join('')}</div>`
    : '';

  const chipHtml = data.extraChip
    ? `<div class="data-chip">
        <div class="data-chip-lbl">${escapeHtml(data.extraChip.label)}</div>
        <div class="data-chip-val">${escapeHtml(data.extraChip.value)}</div>
       </div>`
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
      ${chipHtml ? chipHtml : ''}
      <div class="stat-hero">
        <div class="stat-num brand">${escapeHtml(data.value)}</div>
        ${data.label ? `<div class="stat-sublabel">${escapeHtml(data.label)}</div>` : ''}
        ${deltaHtml}
      </div>
      ${secondaryHtml}
      ${badgeHtml || savingsHtml ? `<div class="badge-row">${badgeHtml}${savingsHtml}</div>` : ''}
    </div>
  </div>`;
}
