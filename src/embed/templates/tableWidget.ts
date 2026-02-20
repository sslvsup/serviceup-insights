import { escapeHtml } from './layout';

export interface TableWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Record<string, string | number | null>>;
  maxRows?: number;
}

export function renderTableWidget(data: TableWidgetData): string {
  const rows = data.rows.slice(0, data.maxRows ?? 10);

  const headerHtml = data.columns
    .map((col) => `<th style="text-align:${col.align ?? 'left'}">${escapeHtml(col.label)}</th>`)
    .join('');

  const rowsHtml = rows.map((row) =>
    `<tr>${data.columns.map((col) => {
      const val = row[col.key];
      const display = val == null ? '—' : String(val);
      return `<td style="text-align:${col.align ?? 'left'}">${escapeHtml(display)}</td>`;
    }).join('')}</tr>`,
  ).join('');

  const savingsChip = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  const priorityBadge = data.priority && data.priority <= 2
    ? `<span class="priority-badge priority-${data.priority}">${data.priority === 1 ? 'URGENT' : 'HIGH'}</span>`
    : '';

  const emptyHtml = rows.length === 0
    ? '<tr><td colspan="100%" class="no-data">No data available</td></tr>'
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
    <div style="flex:1;overflow-y:auto;margin-top:8px;">
      <table class="data-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}${emptyHtml}</tbody>
      </table>
    </div>
  </div>`;
}
