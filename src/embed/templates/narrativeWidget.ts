import { escapeHtml } from './layout';

export interface NarrativeWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  narrativeHtml?: string; // pre-rendered HTML
  bullets?: string[];    // alternative: bullet list
}

export function renderNarrativeWidget(data: NarrativeWidgetData): string {
  const priorityBadge = data.priority && data.priority <= 2
    ? `<span class="priority-badge priority-${data.priority}">${data.priority === 1 ? 'URGENT' : 'HIGH'}</span>`
    : '';

  const savingsChip = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  let content = '';
  if (data.narrativeHtml) {
    content = `<div class="narrative-text">${data.narrativeHtml}</div>`;
  } else if (data.bullets && data.bullets.length > 0) {
    const bulletItems = data.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
    content = `<ul style="margin:8px 0;padding-left:20px;line-height:1.8;">${bulletItems}</ul>`;
  } else {
    content = `<p class="narrative-text">${escapeHtml(data.summary)}</p>`;
  }

  return `
  <div class="widget">
    <div class="widget-header">
      <div>
        <h3 class="widget-title">${escapeHtml(data.title)}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${priorityBadge}${savingsChip}</div>
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;margin-top:8px;">
      ${content}
    </div>
  </div>`;
}
