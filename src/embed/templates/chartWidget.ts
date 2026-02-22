import { escapeHtml, jsonEmbed } from './layout';

const COLORS = ['#4F46E5', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#EC4899', '#84CC16'];
const COLORS_ALPHA = COLORS.map(c => c + '22');

export interface ChartWidgetData {
  title: string;
  summary: string;
  priority?: number;
  savingsEstimateCents?: number | null;
  icon?: string;
  iconColor?: string;
  insightType?: string;
  chartType: 'line' | 'bar' | 'pie' | 'area';
  labels: string[];
  datasets: Array<{ label: string; data: number[]; color?: string }>;
}

export function renderChartWidget(data: ChartWidgetData, widgetId: string): string {
  const p = data.priority ?? 5;
  const icon = data.icon ?? '📅';
  const iconColor = data.iconColor ?? 'purple';
  const chartType = data.chartType === 'area' ? 'line' : data.chartType;

  const datasets = data.datasets.map((ds, i) => {
    const color = ds.color ?? COLORS[i % COLORS.length];
    const base = {
      label: ds.label,
      data: ds.data,
      borderColor: color,
      borderWidth: 2,
      borderRadius: chartType === 'bar' ? 6 : 0,
      backgroundColor: chartType === 'pie'
        ? COLORS
        : data.chartType === 'area' || data.chartType === 'line'
          ? color + '20'
          : color + 'CC',
    };
    if (data.chartType === 'area' || data.chartType === 'line') {
      return { ...base, fill: data.chartType === 'area', tension: 0.4, pointRadius: 4, pointHoverRadius: 6 };
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
          labels: { font: { size: 11, family: "'Inter',sans-serif" }, boxWidth: 10, padding: 12 },
        },
        tooltip: {
          backgroundColor: '#0D1117',
          titleColor: '#E6EDF3',
          bodyColor: '#8B949E',
          padding: 10,
          cornerRadius: 8,
          callbacks: chartType !== 'pie' ? {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              ` ${ctx.dataset.label ?? ''}: $${(ctx.parsed.y ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
          } : {},
        },
      },
      scales: chartType === 'pie' ? {} : {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 11, family: "'Inter',sans-serif" }, color: '#9CA3AF' },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false },
          border: { display: false, dash: [4, 4] },
          ticks: {
            font: { size: 11, family: "'Inter',sans-serif" },
            color: '#9CA3AF',
            callback: (v: number) => v === 0 ? '$0' : `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`,
          },
        },
      },
    },
  };

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
      <div class="chart-wrap">
        <canvas id="${widgetId}-canvas"></canvas>
      </div>
    </div>
  </div>
  <script>
  (function(){
    var el = document.getElementById('${widgetId}-canvas');
    if(!el) return;
    new Chart(el.getContext('2d'), ${jsonEmbed(chartConfig)});
  })();
  </script>`;
}
