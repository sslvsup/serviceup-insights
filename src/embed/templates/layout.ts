import { THEME_CSS } from '../styles/theme';

export function renderLayout(opts: {
  title?: string;
  body: string;
  scripts?: string;
  theme?: 'light' | 'dark';
  includeChartJs?: boolean;
}): string {
  const { title = 'Fleet Insights', body, scripts = '', theme = 'light', includeChartJs = false } = opts;

  const chartJsScript = includeChartJs
    ? `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" crossorigin="anonymous"></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${THEME_CSS}</style>
</head>
<body class="${theme}">
${body}
${chartJsScript}
${scripts}
</body>
</html>`;
}

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function jsonEmbed(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
