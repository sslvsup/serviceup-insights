export const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#4F46E5;--brand-lt:#818CF8;--brand-bg:#EEF2FF;--brand-dk:#3730A3;
  --green:#059669;--green-bg:#ECFDF5;--green-dk:#047857;
  --amber:#D97706;--amber-bg:#FFFBEB;--amber-dk:#B45309;
  --red:#DC2626;--red-bg:#FEF2F2;--red-dk:#B91C1C;
  --purple:#7C3AED;--purple-bg:#F5F3FF;
  --teal:#0891B2;--teal-bg:#ECFEFF;
  --bg:#F7F8FC;--surface:#FFFFFF;--surface-2:#F1F3F9;
  --border:#E2E6F0;--border-st:#C7CEDD;
  --text-1:#0D1117;--text-2:#4B5568;--text-3:#9CA3AF;
  --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --r-sm:6px;--r-md:10px;--r-lg:14px;--r-pill:9999px;
  --sx:0 1px 2px rgba(0,0,0,.04);
  --sm:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
  --smd:0 4px 8px -2px rgba(0,0,0,.08),0 2px 4px -2px rgba(0,0,0,.04);
}
body.dark{
  --bg:#0D1117;--surface:#161B22;--surface-2:#1C2330;
  --border:#30363D;--border-st:#484F58;
  --text-1:#E6EDF3;--text-2:#8B949E;--text-3:#6E7681;
  --brand-bg:rgba(79,70,229,.15);--green-bg:rgba(5,150,105,.12);
  --amber-bg:rgba(217,119,6,.12);--red-bg:rgba(220,38,38,.12);
}
html,body{font-family:var(--font);font-size:14px;line-height:1.5;color:var(--text-1);background:var(--bg);-webkit-font-smoothing:antialiased}

/* ── SHELL ── */
.dash{padding:20px;min-height:100vh}
.dash-inner{max-width:1280px;margin:0 auto}

/* ── HEADER ── */
.dash-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}
.dash-title{font-size:22px;font-weight:800;letter-spacing:-.4px;color:var(--text-1);line-height:1.2}
.dash-meta{font-size:13px;color:var(--text-3);margin-top:3px}
.period-pill{display:inline-flex;align-items:center;gap:5px;background:var(--brand-bg);color:var(--brand-dk);border:1px solid rgba(79,70,229,.2);border-radius:var(--r-pill);padding:5px 12px;font-size:12px;font-weight:600}

/* ── KPI BAR ── */
.kpi-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px 18px;box-shadow:var(--sx);position:relative;overflow:hidden;transition:box-shadow .2s,transform .15s}
.kpi-card:hover{box-shadow:var(--smd);transform:translateY(-1px)}
.kpi-card::after{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.kpi-card.c-blue::after  {background:linear-gradient(90deg,var(--brand),var(--brand-lt))}
.kpi-card.c-green::after {background:linear-gradient(90deg,var(--green),#34D399)}
.kpi-card.c-amber::after {background:linear-gradient(90deg,var(--amber),#FCD34D)}
.kpi-card.c-red::after   {background:linear-gradient(90deg,var(--red),#F87171)}
.kpi-card.c-purple::after{background:linear-gradient(90deg,var(--purple),#A78BFA)}
.kpi-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--text-3);margin-bottom:6px}
.kpi-num{font-size:28px;font-weight:800;letter-spacing:-.8px;line-height:1;color:var(--text-1)}
.kpi-sub{font-size:12px;color:var(--text-3);margin-top:4px}
.kpi-icon{position:absolute;right:14px;top:14px;font-size:22px;opacity:.12}

/* ── ALERT BANNER ── */
.alert-banner{display:flex;align-items:center;gap:10px;background:var(--red-bg);border:1px solid rgba(220,38,38,.2);border-left:4px solid var(--red);border-radius:var(--r-md);padding:12px 16px;margin-bottom:20px;font-size:13px;font-weight:500}
.alert-banner.lvl-2{background:var(--amber-bg);border-color:rgba(217,119,6,.2);border-left-color:var(--amber)}
.alert-banner-count{background:var(--red);color:#fff;border-radius:var(--r-pill);font-size:11px;font-weight:700;padding:2px 8px;flex-shrink:0}

/* ── SECTION LABEL ── */
.section-label{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);padding-bottom:8px;border-bottom:1px solid var(--border);margin-top:4px}

/* ── WIDGET GRID ── */
.widget-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;align-items:start}
.col-3{grid-column:span 3}.col-4{grid-column:span 4}.col-5{grid-column:span 5}
.col-6{grid-column:span 6}.col-7{grid-column:span 7}.col-8{grid-column:span 8}
.col-12{grid-column:span 12}
@media(max-width:960px){
  .col-3,.col-4,.col-5,.col-6,.col-7,.col-8,.col-12{grid-column:span 12}
}

/* ── WIDGET BASE ── */
.widget{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--sx);display:flex;flex-direction:column;transition:box-shadow .2s,border-color .2s}
.widget:hover{box-shadow:var(--smd);border-color:var(--border-st)}
.widget.p1{border-top:3px solid var(--red)}
.widget.p2{border-top:3px solid var(--amber)}
.widget.p3{border-top:3px solid var(--brand)}
.widget.p4,.widget.p5{border-top:3px solid var(--border-st)}
.w-body{padding:18px 20px;flex:1;display:flex;flex-direction:column}

/* ── WIDGET HEADER ── */
.w-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.w-icon-box{width:38px;height:38px;border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.w-icon-box.blue  {background:var(--brand-bg)}
.w-icon-box.green {background:var(--green-bg)}
.w-icon-box.amber {background:var(--amber-bg)}
.w-icon-box.red   {background:var(--red-bg)}
.w-icon-box.purple{background:var(--purple-bg)}
.w-icon-box.teal  {background:var(--teal-bg)}
.w-icon-box.gray  {background:var(--surface-2)}
.w-title-g{flex:1;min-width:0}
.w-title{font-size:14px;font-weight:700;color:var(--text-1);line-height:1.3}
.w-summary{font-size:12px;color:var(--text-2);line-height:1.55;margin-top:2px}

/* ── BADGES ── */
.badge-row{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:6px}
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:var(--r-pill);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
.b-red   {background:var(--red-bg);   color:var(--red-dk)}
.b-amber {background:var(--amber-bg); color:var(--amber-dk)}
.b-blue  {background:var(--brand-bg); color:var(--brand-dk)}
.b-green {background:var(--green-bg); color:var(--green-dk)}
.b-purple{background:var(--purple-bg);color:var(--purple)}
.b-gray  {background:var(--surface-2);color:var(--text-2)}
.savings-chip{display:inline-flex;align-items:center;gap:4px;background:var(--green-bg);color:var(--green-dk);border:1px solid rgba(5,150,105,.2);padding:3px 10px;border-radius:var(--r-pill);font-size:11px;font-weight:600}

/* ── DIVIDER ── */
.w-div{height:1px;background:var(--border);margin:12px 0}

/* ── DATA CHIP ── */
.data-chip{display:inline-flex;flex-direction:column;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:8px 14px;margin:8px 0 4px}
.data-chip-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);margin-bottom:2px}
.data-chip-val{font-size:15px;font-weight:700;color:var(--text-1);font-variant-numeric:tabular-nums}

/* ── LARGE STAT ── */
.stat-hero{flex:1;display:flex;flex-direction:column;justify-content:center;padding:4px 0}
.stat-num{font-size:42px;font-weight:800;letter-spacing:-1.5px;line-height:1;color:var(--text-1)}
.stat-num.brand{color:var(--brand)}.stat-num.green{color:var(--green)}.stat-num.red{color:var(--red)}
.stat-sublabel{font-size:12px;color:var(--text-3);font-weight:500;margin-top:5px}
.stat-delta{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:var(--r-pill);margin-top:10px}
.stat-delta.up  {color:var(--green);background:var(--green-bg)}
.stat-delta.down{color:var(--red);  background:var(--red-bg)}
.stat-delta.flat{color:var(--text-3);background:var(--surface-2)}
.stat-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
.stat-meta-cell{background:var(--surface-2);border-radius:var(--r-md);padding:10px 12px}
.stat-meta-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3)}
.stat-meta-val{font-size:18px;font-weight:800;letter-spacing:-.4px;color:var(--text-1);margin-top:2px}

/* ── PROGRESS BAR ── */
.prog-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}
.prog-row:last-child{border-bottom:none}
.prog-rank{font-size:11px;font-weight:800;color:var(--text-3);width:18px;text-align:center;flex-shrink:0}
.prog-label{flex:1;font-size:13px;color:var(--text-1);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog-track{flex:2;height:7px;background:var(--surface-2);border-radius:var(--r-pill);overflow:hidden;min-width:60px}
.prog-fill{height:100%;border-radius:var(--r-pill);background:linear-gradient(90deg,var(--brand),var(--brand-lt))}
.prog-fill.g{background:linear-gradient(90deg,var(--green),#34D399)}
.prog-fill.a{background:linear-gradient(90deg,var(--amber),#FCD34D)}
.prog-fill.r{background:linear-gradient(90deg,var(--red),#F87171)}
.prog-val{font-size:13px;font-weight:700;color:var(--text-1);min-width:52px;text-align:right;font-variant-numeric:tabular-nums}

/* ── NARRATIVE ── */
.narrative-text{font-size:13px;color:var(--text-2);line-height:1.7;flex:1}
.bullet-list{list-style:none;padding:0;margin:4px 0 0}
.bullet-list li{display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;color:var(--text-2);line-height:1.5;border-bottom:1px solid var(--border)}
.bullet-list li:last-child{border-bottom:none}
.b-dot{width:6px;height:6px;border-radius:50%;background:var(--brand);margin-top:7px;flex-shrink:0}
.action-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
.action-link{font-size:12px;font-weight:600;color:var(--brand);display:inline-flex;align-items:center;gap:4px}

/* ── ALERT ITEM ── */
.alert-item{display:flex;gap:12px;padding:12px;border-radius:var(--r-md);margin-bottom:8px;border:1px solid var(--border)}
.alert-item:last-child{margin-bottom:0}
.alert-item.sev-c{background:var(--red-bg);  border-color:rgba(220,38,38,.2)}
.alert-item.sev-w{background:var(--amber-bg);border-color:rgba(217,119,6,.2)}
.alert-item.sev-i{background:var(--brand-bg);border-color:rgba(79,70,229,.15)}
.alert-icon{font-size:20px;flex-shrink:0;width:26px;text-align:center}
.alert-headline{font-size:13px;font-weight:600;color:var(--text-1);line-height:1.3}
.alert-detail{font-size:12px;color:var(--text-2);margin-top:3px;line-height:1.5}
.alert-cta{font-size:11px;font-weight:700;margin-top:5px}
.alert-cta.c{color:var(--red-dk)}.alert-cta.w{color:var(--amber-dk)}

/* ── TABLE ── */
.w-table-wrap{flex:1;overflow-x:auto;margin-top:4px}
.w-table{width:100%;border-collapse:collapse;font-size:13px}
.w-table th{text-align:left;padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);white-space:nowrap}
.w-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text-1);vertical-align:middle}
.w-table tr:last-child td{border-bottom:none}
.w-table tr:hover td{background:var(--surface-2)}
.w-table td.num{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.w-table td.rank{text-align:center;width:32px;font-size:11px;font-weight:800;color:var(--text-3)}
.td-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.td-pill.good   {background:var(--green-bg);color:var(--green-dk)}
.td-pill.neutral{background:var(--surface-2);color:var(--text-2)}
.td-pill.bad    {background:var(--red-bg);  color:var(--red-dk)}

/* ── CHART ── */
.chart-wrap{position:relative;flex:1;min-height:180px;margin-top:8px}

/* ── EMPTY ── */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 20px;color:var(--text-3);text-align:center}
.empty-icon{font-size:28px;margin-bottom:8px;opacity:.45}
.empty-text{font-size:13px;font-weight:500}

/* ── FOOTER ── */
.dash-footer{text-align:center;font-size:11px;color:var(--text-3);padding:28px 0 16px}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-st);border-radius:3px}
`;
