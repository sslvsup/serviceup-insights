export const THEME_CSS = `
  *, *::before, *::after { box-sizing: border-box; }

  :root {
    --color-primary: #1976d2;
    --color-primary-light: #42a5f5;
    --color-secondary: #9c27b0;
    --color-success: #2e7d32;
    --color-warning: #ed6c02;
    --color-error: #d32f2f;
    --color-info: #0288d1;

    --color-bg: #ffffff;
    --color-surface: #f5f5f5;
    --color-border: #e0e0e0;
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #666666;
    --color-text-disabled: #9e9e9e;

    --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
    --font-size-xs: 11px;
    --font-size-sm: 12px;
    --font-size-base: 14px;
    --font-size-lg: 16px;
    --font-size-xl: 20px;
    --font-size-2xl: 24px;

    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;
    --spacing-xl: 32px;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
    --shadow-md: 0 2px 8px rgba(0,0,0,0.12);
  }

  body.dark {
    --color-bg: #121212;
    --color-surface: #1e1e1e;
    --color-border: #333333;
    --color-text-primary: #f5f5f5;
    --color-text-secondary: #aaaaaa;
  }

  body {
    margin: 0;
    padding: 0;
    font-family: var(--font-family);
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
    background: transparent;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .widget {
    background: var(--color-bg);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    overflow: hidden;
  }

  .widget-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--spacing-sm);
  }

  .widget-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
    line-height: 1.3;
  }

  .widget-summary {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .widget-chart {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .priority-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .priority-1 { background: #ffebee; color: #c62828; }
  .priority-2 { background: #fff3e0; color: #e65100; }
  .priority-3 { background: #e3f2fd; color: #1565c0; }
  .priority-4 { background: #f3e5f5; color: #6a1b9a; }
  .priority-5 { background: #f5f5f5; color: #616161; }

  .stat-value {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--color-primary);
    line-height: 1;
  }
  .stat-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }
  .stat-delta {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .stat-delta.positive { color: var(--color-success); }
  .stat-delta.negative { color: var(--color-error); }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }
  .data-table th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 2px solid var(--color-border);
    font-weight: 600;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .data-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
  }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tr:hover td { background: var(--color-surface); }

  .alert-card {
    background: var(--color-bg);
    border-left: 4px solid var(--color-error);
    border-radius: var(--radius-sm);
    padding: var(--spacing-md);
  }
  .alert-card.priority-2 { border-left-color: var(--color-warning); }
  .alert-card.priority-3 { border-left-color: var(--color-info); }

  .narrative-text {
    font-size: var(--font-size-base);
    color: var(--color-text-primary);
    line-height: 1.7;
  }

  .savings-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #e8f5e9;
    color: #1b5e20;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: var(--font-size-xs);
    font-weight: 600;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    padding: var(--spacing-xl);
    text-align: center;
  }

  .no-data {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-style: italic;
  }
`;
