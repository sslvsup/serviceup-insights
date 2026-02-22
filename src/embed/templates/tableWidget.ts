import { escapeHtml } from './layout';

export interface TableWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  icon?: string;
  iconColor?: string;
  insightType?: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Record<string, string | number | null>>;
  maxRows?: number;
  isDiffTable?: boolean; // enables green/red coloring on last column
}

function diffClass(val: string | number | null): string {
  if (val == null || val === '—') return 'neutral';
  const s = String(val);
  // Positive diff (e.g. "+12%" or "12%") → bad for cost; negative → good
  if (s.startsWith('-') || s === '0%' || s === '0.0%') return 'good';
  if (s.startsWith('+') || (!s.startsWith('-') && s.includes('%') && s !== '0%')) return 'bad';
  return 'neutral';
}

export function renderTableWidget(data: TableWidgetData): string {
  const p = data.priority ?? 4;
  const icon = data.icon ?? '⚖️';
  const iconColor = data.iconColor ?? 'green';
  const rows = data.rows.slice(0, data.maxRows ?? 10);
  const lastColIdx = data.columns.length - 1;

  const headerHtml = [
    `<th class="rank">#</th>`,
    ...data.columns.map(col => `<th style="text-align:${col.align ?? 'left'}">${escapeHtml(col.label)}</th>`),
  ].join('');

  const rowsHtml = rows.length > 0
    ? rows.map((row, ri) =>
        `<tr>
          <td class="rank">${ri + 1}</td>
          ${data.columns.map((col, ci) => {
            const val = row[col.key] ?? row[`c${ci}`];
            const display = val == null ? '—' : String(val);
            const align = col.align ?? (ci > 0 ? 'right' : 'left');
            if (data.isDiffTable && ci === lastColIdx) {
              const cls = diffClass(val);
              return `<td class="num"><span class="td-pill ${cls}">${escapeHtml(display)}</span></td>`;
            }
            if (ci === 0) return `<td>${escapeHtml(display)}</td>`;
            return `<td style="text-align:${align}" class="${ci > 0 ? 'num' : ''}">${escapeHtml(display)}</td>`;
          }).join('')}
        </tr>`
      ).join('')
    : `<tr><td colspan="${data.columns.length + 1}" style="text-align:center;padding:24px;color:var(--text-3);font-size:12px">No data available</td></tr>`;

  const savingsHtml = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
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
      ${savingsHtml ? `<div class="badge-row">${savingsHtml}</div>` : ''}
      <div class="w-table-wrap">
        <table class="w-table">
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}
