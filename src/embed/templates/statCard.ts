import { escapeHtml } from './layout';

export interface StatCardData {
  title: string;
  summary: string;
  value: string;
  label?: string;
  delta?: string;
  deltaDirection?: 'positive' | 'negative' | 'neutral';
  secondaryStats?: Array<{ label: string; value: string }>;
  priority?: number;
  savingsEstimateCents?: number | null;
}

export function renderStatCard(data: StatCardData): string {
  const deltaHtml = data.delta
    ? `<span class="stat-delta ${data.deltaDirection ?? 'neutral'}">${escapeHtml(data.delta)}</span>`
    : '';

  const secondaryHtml = data.secondaryStats
    ?.map((s) => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid var(--color-border);">
        <span style="color:var(--color-text-secondary);font-size:12px;">${escapeHtml(s.label)}</span>
        <span style="font-weight:600;font-size:12px;">${escapeHtml(s.value)}</span>
      </div>`)
    .join('') ?? '';

  const savingsChip = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  const priorityBadge = data.priority && data.priority <= 2
    ? `<span class="priority-badge priority-${data.priority}">${data.priority === 1 ? 'URGENT' : 'HIGH'}</span>`
    : '';

  return `
  <div class="widget">
    <div class="widget-header">
      <div>
        <h3 class="widget-title">${escapeHtml(data.title)}</h3>
        <p class="widget-summary">${escapeHtml(data.summary)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${priorityBadge}${savingsChip}</div>
      </div>
    </div>
    <div style="padding:8px 0;">
      <div class="stat-value">${escapeHtml(data.value)}</div>
      ${data.label ? `<div class="stat-label">${escapeHtml(data.label)}</div>` : ''}
      ${deltaHtml}
    </div>
    ${secondaryHtml ? `<div style="margin-top:8px;">${secondaryHtml}</div>` : ''}
  </div>`;
}
