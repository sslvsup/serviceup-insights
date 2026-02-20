import { escapeHtml, jsonEmbed } from './layout';

const CHART_COLORS = [
  '#1976d2', '#42a5f5', '#9c27b0', '#e91e63', '#f44336',
  '#ff9800', '#4caf50', '#009688', '#607d8b', '#795548',
];

export interface ChartWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  chartType: 'line' | 'bar' | 'pie' | 'area';
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
}

export function renderChartWidget(data: ChartWidgetData, widgetId: string): string {
  const chartType = data.chartType === 'area' ? 'line' : data.chartType;

  const datasets = data.datasets.map((ds, i) => {
    const color = ds.color ?? CHART_COLORS[i % CHART_COLORS.length];
    const base = {
      label: ds.label,
      data: ds.data,
      backgroundColor: data.chartType === 'pie'
        ? CHART_COLORS
        : `${color}33`,
      borderColor: color,
      borderWidth: data.chartType === 'pie' ? 0 : 2,
    };
    if (data.chartType === 'area' || data.chartType === 'line') {
      return { ...base, fill: data.chartType === 'area', tension: 0.3, pointRadius: 3 };
    }
    return base;
  });

  const chartConfig = {
    type: chartType,
    data: { labels: data.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: data.datasets.length > 1 || data.chartType === 'pie',
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          callbacks: data.chartType !== 'pie' ? {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label ?? ''}: $${ctx.parsed.y?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
          } : {},
        },
      },
      scales: data.chartType === 'pie' ? {} : {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            font: { size: 10 },
            callback: (v: number) => `$${v.toLocaleString()}`,
          },
        },
      },
    },
  };

  const priorityBadge = data.priority && data.priority <= 2
    ? `<span class="priority-badge priority-${data.priority}">${data.priority === 1 ? 'URGENT' : 'HIGH'}</span>`
    : '';

  const savingsChip = data.savingsEstimateCents && data.savingsEstimateCents > 0
    ? `<span class="savings-chip">💰 Save ~$${Math.round(data.savingsEstimateCents / 100).toLocaleString()}/yr</span>`
    : '';

  return `
  <div class="widget" data-widget-id="${widgetId}">
    <div class="widget-header">
      <div>
        <h3 class="widget-title">${escapeHtml(data.title)}</h3>
        <p class="widget-summary">${escapeHtml(data.summary)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${priorityBadge}${savingsChip}</div>
      </div>
    </div>
    <div class="widget-chart">
      <canvas id="${widgetId}-canvas"></canvas>
    </div>
  </div>
  <script>
    (function() {
      const ctx = document.getElementById('${widgetId}-canvas').getContext('2d');
      new Chart(ctx, ${jsonEmbed(chartConfig)});
    })();
  </script>`;
}
