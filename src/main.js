import './style.css';
import Chart from 'chart.js/auto';
import PROGRAMS from './data/programs.json';
import {
  MONTHS, MONTHS_LONG, QTR, SL, LEGACY_STORAGE_KEY,
  appropriation, clearActiveEntries, commitAmount, fiscalThroughIndex, formatMoney,
  legacyExclusion, migrateState, narrativeFlags, num, parseAmount, periodSum,
  programView, ratio, straightLineCumulative, straightLineMonthly,
  sum, sumPbg, toCsv,
} from './model.js';
import { createPrototypeStore, storageFacts } from './storage.js';

const FACTS = storageFacts();
const store = createPrototypeStore(localStorage);
const loaded = store.load(PROGRAMS);
let S = loaded.state;
let startupSaveFailed = false;
if (loaded.source === 'v1') {
  try { store.save(S); } catch { startupSaveFailed = true; }
}

const ui = {
  fund: 'ALL',
  q: '',
  code: PROGRAMS[0].code,
  period: 'Annual',
  tab: 'dash',
  through: fiscalThroughIndex(new Date()),
  saveLabel: startupSaveFailed
    ? 'This browser blocked local save — Export JSON to keep a copy'
    : loaded.source === 'blank'
      ? 'No entries stored in this browser yet'
      : 'Loaded entries stored in this browser',
};

const app = document.getElementById('app');
const charts = [];
const esc = (value) => String(value).replace(/[&<>"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[ch]));
const fieldValue = (value) => (num(value) === 0 ? '' : String(num(value)));

function persist() {
  try {
    store.save(S);
    ui.saveLabel = 'Saved in this browser';
  } catch {
    ui.saveLabel = 'This browser blocked local save — Export JSON to keep a copy';
  }
  const el = document.getElementById('save-state');
  if (el) el.textContent = ui.saveLabel;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});
window.addEventListener('pagehide', () => persist());

function filtered() {
  const q = ui.q.toLowerCase();
  return PROGRAMS.filter(program => (ui.fund === 'ALL' || program.fund === ui.fund)
    && (!q || `${program.code} ${program.name} ${program.mdep} ${program.sag}`.toLowerCase().includes(q)));
}

function selectedProgram(list) {
  return list.find(program => program.code === ui.code) || null;
}

function throughText(index) {
  return `cumulative through ${MONTHS_LONG[index]} (${MONTHS[index]}), including that month`;
}

function kpi(label, value, basis, tone = '', metric = '') {
  const attr = metric ? ` data-metric="${esc(metric)}"` : '';
  return `<div class="kpi ${tone}"><span>${esc(label)}</span><b${attr}>${esc(value)}</b><small>${esc(basis)}</small></div>`;
}

function ratioBasis(result, denominatorName, timeBasis) {
  if (result.value == null) return `N/A because ${denominatorName} is zero. ${timeBasis}`;
  return `${result.text}. Numerator over ${denominatorName}. ${timeBasis}`;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeThroughPlugin(index) {
  return {
    id: 'throughLine',
    afterDraw(chart) {
      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;
      const x = xScale.getPixelForValue(index);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

function render() {
  charts.splice(0).forEach(chart => chart.destroy());
  const list = filtered();
  if (list.length && !list.some(program => program.code === ui.code)) ui.code = list[0].code;
  const grand = sumPbg(PROGRAMS);
  const exclusion = legacyExclusion(S);
  app.innerHTML = `
  <header class="hdr"><div class="brand"><div class="logo">RPA</div><div>
    <h1>FY27 RPA Phase-plan Studio</h1>
    <p>MIRC prototype · Oct 2026 – Sep 2027 · ${PROGRAMS.length} programs · Authorized PBG <span data-metric="grand-pbg">${formatMoney(grand)}</span></p>
  </div></div>
  <div class="hdr-actions">
    <button type="button" id="exp" title="Download a JSON file you can Import on another browser">Export JSON</button>
    <label class="btn" title="Replace this browser's entries with a JSON file">Import<input type="file" id="imp" accept=".json,application/json" hidden></label>
    <button type="button" id="csv" title="Spreadsheet snapshot. CSV cannot be imported">Export CSV</button>
    <button type="button" id="reset" class="danger">Reset</button>
    <span id="save-state" class="save-state" role="status" aria-live="polite">${esc(ui.saveLabel)}</span>
  </div></header>
  <div class="disclaimer">Unofficial prototype. <b>FY27_RPA_Phase_Plan.xlsx</b> remains the working record. Entries autosave in this browser only. To see them on another computer, Export JSON here and Import that file there. Nothing you type is uploaded.</div>
  <details class="about">
    <summary>Storage and deployment assumptions — localStorage on this browser only, not a shared store</summary>
    <ul>
      <li>Working copy: in memory while this tab is open.</li>
      <li>Saved copy: ${FACTS.mechanism}, key <code>${esc(FACTS.key)}</code>, on this device and this browser profile.</li>
      <li>Autosave: ${esc(FACTS.autosave)}. There is no separate Save button. Totals and charts refresh when you leave a cell.</li>
      <li>IndexedDB: unused. Cookies: unused. Server account: unused.</li>
      <li>Earlier entries on this same browser, if any, are under <code>${esc(FACTS.legacyKey)}</code>. This page reads that key once, leaves it in place, and writes <code>${esc(FACTS.key)}</code>.</li>
      <li>${esc(FACTS.transfer)}. Import replaces the entries already stored in the browser where you import.</li>
      <li>Export CSV is a dollar-rounded spreadsheet snapshot. CSV cannot be imported. JSON keeps the entered values and any migration backup.</li>
      <li>Clearing site data for this origin, or closing a private window that discards data, removes the local copy. Export JSON is the copy you hold.</li>
      <li>This page is a static prototype. It does not connect to Army Vantage and does not claim Army Vantage compatibility. It does not connect to commercial products named Vantage. A shared store and later packaging wait on design approval and a verified deployment target.</li>
    </ul>
  </details>
  ${exclusion.hasExcluded ? migrationNotice(exclusion) : ''}
  <section class="toolbar">
    <label>Fund<select id="fund">${['ALL','BASE','OOC','EDI'].map(fund => `<option ${fund === ui.fund ? 'selected' : ''}>${fund}</option>`).join('')}</select></label>
    <label class="grow">Search<input id="q" value="${esc(ui.q)}" placeholder="Program, MDEP, SAG…" autocomplete="off"></label>
    <label>Program<select id="code">${list.map(program => `<option value="${esc(program.code)}" ${program.code === ui.code ? 'selected' : ''}>${esc(program.code)} — ${esc(program.name)}</option>`).join('')}</select></label>
    <div class="field"><span>Quarter highlight</span><span class="seg" id="period">${Object.keys(QTR).map(period => `<button type="button" data-v="${period}" class="${period === ui.period ? 'on' : ''}" aria-pressed="${period === ui.period}">${period}</button>`).join('')}</span></div>
  </section>
  <nav class="tabs" role="tablist" aria-label="Sections">
    ${[['dash','Dashboard'],['plan','Phase plan'],['obl','Obligations'],['imb','Imbalance']].map(([id, label]) => `<button type="button" role="tab" data-t="${id}" aria-selected="${ui.tab === id}" class="${ui.tab === id ? 'on' : ''}">${label}</button>`).join('')}
  </nav>
  <main id="body"></main>
  <footer>Unofficial prototype · FY27 RPA Phase-plan Studio · Entries stay in this browser until you export them · The straight-line reference is not saved into the plan.</footer>`;

  const body = document.getElementById('body');
  if (ui.tab === 'dash') {
    body.innerHTML = dashView(list);
    drawDash(list);
  } else if (ui.tab === 'plan') body.innerHTML = planView(list);
  else if (ui.tab === 'obl') body.innerHTML = oblView(list);
  else body.innerHTML = imbView(list);
  wire();
}

function migrationNotice(exclusion) {
  const planBits = exclusion.undPlan
    ? `Excluded Undistributed plan: ${formatMoney(exclusion.undPlan)} across ${exclusion.programsWithPlan} program${exclusion.programsWithPlan === 1 ? '' : 's'}.`
    : 'Excluded Undistributed plan: $0.';
  const pbgBits = exclusion.undPbg
    ? `Excluded Undistributed PBG tags: ${formatMoney(exclusion.undPbg)} across ${exclusion.programsWithPbg} program${exclusion.programsWithPbg === 1 ? '' : 's'}. Those tags are a label on part of program PBG, not additional authority, and authorized PBG is not reduced by them.`
    : 'Excluded Undistributed PBG tags: $0.';
  return `<div class="mig" role="status"><p><b>Undistributed amounts are excluded from the active plan and from these totals.</b> ${planBits} ${pbgBits} They remain in the migration backup inside Export JSON, and the previous browser key ${esc(LEGACY_STORAGE_KEY)} was left in place. To phase any of that plan, enter it on the single program row.</p><button type="button" class="ghost" id="backup">Download migration backup</button></div>`;
}

function metricCards(metrics, scope, prefix) {
  const share = metrics.phasedOfPbg.value == null
    ? 'Share of PBG: N/A because full-year authorized PBG is zero.'
    : `Share of PBG: ${metrics.phasedOfPbg.text}. Denominator: full-year authorized PBG.`;
  const time = throughText(metrics.throughIndex);
  const unphasedTone = metrics.unphased === 0 ? 'ok' : 'warn';
  const varianceTone = metrics.actualMinusPlan > 0 ? 'warn' : '';
  return `
    ${kpi('Authorized PBG', formatMoney(metrics.pbg), `${scope} Full-year authority, counted once.`, '', `${prefix}-pbg`)}
    ${kpi('Full-year phased', formatMoney(metrics.fullYearPhased), `Sum of monthly plan, October 2026–September 2027. ${share}`, '', `${prefix}-phased`)}
    ${kpi('Unphased balance', formatMoney(metrics.unphased), 'Full-year authorized PBG minus full-year phased dollars. This is the full year, not the selected month.', unphasedTone, `${prefix}-unphased`)}
    ${kpi('Cumulative plan', formatMoney(metrics.cumPlan), `Sum of monthly plan, ${time}.`, '', `${prefix}-cum-plan`)}
    ${kpi('Cumulative obligations', formatMoney(metrics.cumObl), `Sum of obligations, ${time}.`, '', `${prefix}-cum-obl`)}
    ${kpi('Actual − plan', formatMoney(metrics.actualMinusPlan), `Cumulative obligations minus cumulative plan, ${time}. Positive means obligations are above plan.`, varianceTone, `${prefix}-variance`)}
    ${kpi('Execution % of plan', metrics.execOfPlan.text, ratioBasis(metrics.execOfPlan, 'cumulative plan', time), '', `${prefix}-exec-plan`)}
    ${kpi('Execution % of PBG', metrics.execOfPbg.text, ratioBasis(metrics.execOfPbg, 'full-year authorized PBG', `Numerator is ${time}.`), '', `${prefix}-exec-pbg`)}
  `;
}

function dashView(list) {
  const metrics = appropriation(PROGRAMS, S, ui.through);
  const program = selectedProgram(list);
  const filterNote = (ui.fund !== 'ALL' || ui.q)
    ? `<p class="filter-note">Fund or search is narrowing the program list and the drilldown below. These appropriation totals still include every program.</p>`
    : '';
  return `<section class="appropriation" id="appropriation" aria-labelledby="approp-title" data-through="${MONTHS[metrics.throughIndex]}">
    <div class="dash-top">
      <div>
        <p class="eyebrow"><span class="badge">Default view</span> Appropriation</p>
        <h2 id="approp-title">RPA appropriation</h2>
        <p class="scope">All ${PROGRAMS.length} programs and all funds, counted once. Changing the program, fund, or search does not change these totals.</p>
      </div>
      <label class="month-pick">Cumulative through
        <select id="through" aria-label="Month for cumulative appropriation metrics">${MONTHS.map((month, index) => `<option value="${index}" ${index === ui.through ? 'selected' : ''}>${MONTHS_LONG[index]}</option>`).join('')}</select>
      </label>
    </div>
    ${filterNote}
    <div class="kpis inset">${metricCards(metrics, `All ${PROGRAMS.length} programs.`, 'approp')}</div>
    <div class="grid2">
      <div class="card flat"><h3>Monthly</h3><div class="ch"><canvas id="c-approp-m"></canvas></div><div id="s-approp-m" class="cs"></div>
        <p class="figcap">Bars are the phased plan. The dashed line is a straight-line slice of authorized PBG for comparison and is not a saved plan. The marked line is obligations. The amber tick is ${MONTHS_LONG[ui.through]}.</p></div>
      <div class="card flat"><h3>Cumulative</h3><div class="ch"><canvas id="c-approp-c"></canvas></div><div id="s-approp-c" class="cs"></div>
        <p class="figcap">Bars are cumulative phased plan. The dashed line is cumulative straight-line PBG and reaches authorized PBG in September. It is not a saved plan. The marked line is cumulative obligations.</p></div>
    </div>
    <p class="figcap">Monthly figures for the appropriation. Cumulative columns include the month shown and every earlier month. Execution percentages use that row's cumulative plan, or full-year authorized PBG, as the denominator. N/A means the denominator is zero.</p>
    ${figuresTable(metrics, metrics.pbg)}
  </section>
  ${program ? drillView(program) : `<section class="card" id="drilldown"><h2>Program drilldown</h2><p class="empty">No program matches the fund and search filters. The appropriation totals above still include every program.</p></section>`}`;
}

function drillView(program) {
  const view = programView(program, S);
  const metrics = appropriation([program], S, ui.through);
  const systems = (program.systems || []).join(' and ');
  return `<section class="card" id="drilldown" aria-labelledby="drill-title">
    <div class="card-h"><div>
      <p class="eyebrow">Program drilldown</p>
      <h2 id="drill-title">${esc(program.code)} — ${esc(program.name)}</h2>
      <p class="scope">This program only. MDEP ${esc(program.mdep)} · Fund ${esc(program.fund)} · SAG ${esc(program.sag)} · Systems covered by its one plan row: ${esc(systems)}. Already included once in the appropriation totals above. Cumulative figures use ${throughText(ui.through)}.</p>
    </div>
    <button type="button" class="ghost" id="goto-plan">Open phase plan</button></div>
    <div class="kpis inset">${metricCards(metrics, `${program.code} only.`, 'drill')}</div>
    <div class="grid2">
      <div class="card flat"><h3>Monthly</h3><div class="ch"><canvas id="c-prog-m"></canvas></div><div id="s-prog-m" class="cs"></div></div>
      <div class="card flat"><h3>Cumulative</h3><div class="ch"><canvas id="c-prog-c"></canvas></div><div id="s-prog-c" class="cs"></div></div>
    </div>
    <p class="hint">Plan ${formatMoney(view.tPlan)} for the full year. PBG − plan ${formatMoney(view.delta)}. Execution % of full-year plan: ${ratio(view.tExe, view.tPlan).text}.</p>
  </section>`;
}

function figuresTable(metrics, pbg) {
  const rows = MONTHS.map((month, index) => `<tr class="${index === ui.through ? 'onmonth' : ''}"><th>${month}</th>
    <td>${formatMoney(metrics.plan[index])}</td>
    <td>${formatMoney(metrics.exe[index])}</td>
    <td class="${metrics.exe[index] - metrics.plan[index] < 0 ? 'neg' : ''}">${formatMoney(metrics.exe[index] - metrics.plan[index])}</td>
    <td>${formatMoney(metrics.cp[index])}</td>
    <td>${formatMoney(metrics.ce[index])}</td>
    <td class="${metrics.ce[index] - metrics.cp[index] < 0 ? 'neg' : ''}">${formatMoney(metrics.ce[index] - metrics.cp[index])}</td>
    <td>${ratio(metrics.ce[index], metrics.cp[index]).text}</td>
    <td>${ratio(metrics.ce[index], pbg).text}</td></tr>`).join('');
  return `<div class="tw"><table><thead><tr>
    <th scope="col">Month</th><th scope="col">Phased plan</th><th scope="col">Obligations</th><th scope="col">Actual − plan</th>
    <th scope="col">Cumulative plan</th><th scope="col">Cumulative obligations</th><th scope="col">Cumulative actual − plan</th>
    <th scope="col">Cum. execution % of plan</th><th scope="col">Cum. execution % of PBG</th>
  </tr></thead><tbody>${rows}
    <tr class="roll"><th>Full year</th>
      <td>${formatMoney(metrics.fullYearPhased)}</td>
      <td>${formatMoney(metrics.fullYearObl)}</td>
      <td>${formatMoney(metrics.fullYearObl - metrics.fullYearPhased)}</td>
      <td>${formatMoney(metrics.cp[11])}</td>
      <td>${formatMoney(metrics.ce[11])}</td>
      <td>${formatMoney(metrics.ce[11] - metrics.cp[11])}</td>
      <td>${ratio(metrics.ce[11], metrics.cp[11]).text}</td>
      <td>${ratio(metrics.ce[11], pbg).text}</td></tr>
  </tbody></table></div>`;
}

function chartSummary(plan, exe, pbg, mode) {
  const fullPlan = sum(plan);
  const fullExe = sum(exe);
  if (mode === 'month') {
    const exec = ratio(fullExe, fullPlan);
    return `<span>Full-year plan <b>${formatMoney(fullPlan)}</b></span><span>Full-year obligations <b>${formatMoney(fullExe)}</b></span><span>Actual − plan <b>${formatMoney(fullExe - fullPlan)}</b></span><span>Execution % of plan <b>${exec.text}</b> <small>denominator: full-year plan</small></span><span>PBG <b>${formatMoney(pbg)}</b></span>`;
  }
  const through = ui.through;
  const cumPlan = plan[through];
  const cumExe = exe[through];
  const exec = ratio(cumExe, cumPlan);
  const ofPbg = ratio(cumExe, pbg);
  return `<span>Cumulative plan <b>${formatMoney(cumPlan)}</b></span><span>Cumulative obligations <b>${formatMoney(cumExe)}</b></span><span>Actual − plan <b>${formatMoney(cumExe - cumPlan)}</b></span><span>Execution % of plan <b>${exec.text}</b> <small>denominator: cumulative plan through ${MONTHS[through]}</small></span><span>Execution % of PBG <b>${ofPbg.text}</b> <small>denominator: full-year PBG</small></span>`;
}

function drawCombo(canvasId, summaryId, { pbgRef, plan, exe, pbg, mode, aria }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', aria);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  charts.push(new Chart(canvas, {
    plugins: [makeThroughPlugin(ui.through)],
    data: {
      labels: MONTHS,
      datasets: [
        { type: 'line', label: 'PBG reference (straight-line)', data: pbgRef.slice(), fill: false, borderColor: '#64748b', borderDash: [6, 4], pointRadius: 0, tension: 0, order: 3 },
        { type: 'bar', label: 'Phased plan', data: plan.slice(), backgroundColor: '#1e3a8a', borderRadius: 3, maxBarThickness: 28, order: 2 },
        { type: 'line', label: 'Obligations', data: exe.slice(), borderColor: '#b45309', backgroundColor: '#f59e0b', pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, tension: 0.15, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : undefined,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatMoney(item.raw)}`,
            footer: (items) => {
              if (!items.length) return '';
              const index = items[0].dataIndex;
              const planned = plan[index];
              const actual = exe[index];
              const basis = mode === 'cum' ? `cumulative through ${MONTHS[index]}` : MONTHS[index];
              return [
                `Actual − plan: ${formatMoney(actual - planned)}`,
                `Execution % of plan: ${ratio(actual, planned).text} (denominator: plan, ${basis})`,
              ];
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => {
              const abs = Math.abs(value);
              const sign = value < 0 ? '-' : '';
              if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
              if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'K';
              return sign + '$' + Math.round(abs);
            },
          },
        },
      },
    },
  }));
  const summary = document.getElementById(summaryId);
  if (summary) summary.innerHTML = chartSummary(plan, exe, pbg, mode);
}

function drawDash(list) {
  const metrics = appropriation(PROGRAMS, S, ui.through);
  const monthAria = `Appropriation monthly chart for all ${PROGRAMS.length} programs. Dashed line is straight-line PBG reference and is not a saved plan. Bars are phased plan. Marked line is obligations.`;
  const cumAria = `Appropriation cumulative chart for all ${PROGRAMS.length} programs through ${MONTHS_LONG[ui.through]}. Dashed line is cumulative straight-line PBG reference and is not a saved plan.`;
  drawCombo('c-approp-m', 's-approp-m', {
    pbgRef: straightLineMonthly(metrics.pbg),
    plan: metrics.plan,
    exe: metrics.exe,
    pbg: metrics.pbg,
    mode: 'month',
    aria: monthAria,
  });
  drawCombo('c-approp-c', 's-approp-c', {
    pbgRef: straightLineCumulative(metrics.pbg),
    plan: metrics.cp,
    exe: metrics.ce,
    pbg: metrics.pbg,
    mode: 'cum',
    aria: cumAria,
  });
  const program = selectedProgram(list);
  if (!program) return;
  const view = programView(program, S);
  drawCombo('c-prog-m', 's-prog-m', {
    pbgRef: straightLineMonthly(view.pbg),
    plan: view.plan,
    exe: view.exe,
    pbg: view.pbg,
    mode: 'month',
    aria: `${program.code} monthly chart. Dashed line is that program's straight-line PBG reference and is not a saved plan.`,
  });
  drawCombo('c-prog-c', 's-prog-c', {
    pbgRef: straightLineCumulative(view.pbg),
    plan: view.cp,
    exe: view.ce,
    pbg: view.pbg,
    mode: 'cum',
    aria: `${program.code} cumulative chart through ${MONTHS_LONG[ui.through]}.`,
  });
}

function quarterCells(values) {
  return ['Q1', 'Q2', 'Q3', 'Q4'].map(quarter => {
    const hot = ui.period === quarter ? 'q hl' : 'q';
    return `<td class="${hot}">${formatMoney(periodSum(values, quarter))}</td>`;
  }).join('');
}

function hot(index) {
  return QTR[ui.period].includes(index) && ui.period !== 'Annual' ? 'hl' : '';
}

function moneyCells(values, className = '') {
  return values.map((value, index) => `<td class="${className} ${hot(index)} ${value < 0 ? 'neg' : ''}">${formatMoney(value)}</td>`).join('');
}

function planView(list) {
  const program = selectedProgram(list);
  if (!program) return `<div class="card"><h2>Phase plan</h2><p class="empty">No program matches the fund and search filters.</p></div>`;
  const view = programView(program, S);
  const systems = program.systems || [];
  const combined = systems.length > 1;
  const systemText = combined
    ? `One plan row for this program. It covers ${systems.join(' and ')} together — enter the month's total once.`
    : `One plan row for this program${systems.length ? ` (${systems[0]})` : ''}.`;
  const inputs = MONTHS.map((month, index) => `<td class="in ${hot(index)}"><input data-k="phase" data-c="${esc(program.code)}" data-i="${index}" value="${fieldValue(view.plan[index])}" inputmode="decimal" autocomplete="off" aria-label="${esc(program.code)} plan ${month}"></td>`).join('');
  const oblInputs = MONTHS.map((month, index) => `<td class="in ${hot(index)}"><input data-k="obl" data-c="${esc(program.code)}" data-i="${index}" value="${fieldValue(view.exe[index])}" inputmode="decimal" autocomplete="off" aria-label="${esc(program.code)} obligations ${month}"></td>`).join('');
  const head = `<tr><th scope="col"></th>${MONTHS.map((month, index) => `<th scope="col" class="${hot(index)}">${month}</th>`).join('')}<th scope="col">Q1</th><th scope="col">Q2</th><th scope="col">Q3</th><th scope="col">Q4</th><th scope="col">Total</th><th scope="col">PBG</th><th scope="col">PBG − plan</th></tr>`;
  const execPct = ratio(view.tExe, view.tPlan);
  return `<div class="card"><div class="card-h"><div><h2>${esc(program.code)} — ${esc(program.name)}</h2>
    <p>MDEP ${esc(program.mdep)} · Fund ${esc(program.fund)} · SAG ${esc(program.sag)}</p>
    <div class="syschips">${systems.map(system => `<span>${esc(system)}</span>`).join('')}</div></div>
    <div class="chip ${view.delta === 0 ? 'ok' : 'warn'}">PBG − plan ${formatMoney(view.delta)}</div></div>
    <p class="hint">${esc(systemText)} Yellow cells are the entry. Monthly execution uses the same obligation figures as the Obligations tab, stored once. Quarter highlight does not change what is saved. MTH and CML variance are plan minus execution. The appropriation dashboard also shows actual minus plan.</p>
    <div class="tw"><table data-plan-rows="1"><thead>${head}</thead><tbody>
      <tr class="roll"><th>MTH Plan</th>${inputs}${quarterCells(view.plan)}<td class="tot">${formatMoney(view.tPlan)}</td><td class="pbg">${formatMoney(view.pbg)}</td><td class="${view.delta ? 'bad' : 'good'}">${formatMoney(view.delta)}</td></tr>
      <tr><th>MTH Execution</th>${oblInputs}${quarterCells(view.exe)}<td class="tot">${formatMoney(view.tExe)}</td><td></td><td></td></tr>
      <tr class="var"><th>MTH Variance (plan − execution)</th>${moneyCells(view.var)}${quarterCells(view.var)}<td class="tot">${formatMoney(sum(view.var))}</td><td></td><td></td></tr>
      <tr class="cml"><th>CML Plan</th>${moneyCells(view.cp, 'cml')}${quarterCells(view.cp)}<td class="tot">${formatMoney(view.cp[11])}</td><td></td><td></td></tr>
      <tr class="cml"><th>CML Execution</th>${moneyCells(view.ce, 'cml')}${quarterCells(view.ce)}<td class="tot">${formatMoney(view.ce[11])}</td><td></td><td></td></tr>
      <tr class="cml var"><th>CML Variance (plan − execution)</th>${moneyCells(view.cv, 'cml')}${quarterCells(view.cv)}<td class="tot">${formatMoney(view.cv[11])}</td><td></td><td></td></tr>
      <tr class="ref" data-straight-line="reference-only"><th>Straight-line reference (cumulative)</th>${straightLineCumulative(view.pbg).map((value, index) => `<td class="${hot(index)}">${formatMoney(value)}</td>`).join('')}<td colspan="4"></td><td></td><td></td><td></td></tr>
    </tbody></table></div>
    <p class="hint">The straight-line row runs from ${SL[0]}% of authorized PBG in October to ${SL[11]}% in September. It is a comparison only. It is not saved and it does not fill the plan.</p>
    <div class="totals"><div>PLAN <b>${formatMoney(view.tPlan)}</b></div><div>PBG <b>${formatMoney(view.pbg)}</b></div><div>PBG − PLAN <b class="${view.delta ? 'bad' : 'good'}">${formatMoney(view.delta)}</b></div><div>EXECUTION % OF PLAN <b>${execPct.text}</b> <small>${execPct.value == null ? 'N/A because the full-year plan is zero' : 'denominator: full-year plan'}</small></div></div>
  </div>`;
}

function oblView(list) {
  const scoped = appropriation(list, S, 11);
  const multi = list.filter(program => (program.systems || []).length > 1);
  return `<div class="card"><h2>Monthly obligations by program</h2>
    <p class="hint">Each yellow row is that program's execution. It feeds monthly execution, cumulative execution, variance, and the appropriation dashboard once. ${list.length} programs in this fund and search. Full-year obligations ${formatMoney(scoped.fullYearObl)}. Full-year plan ${formatMoney(scoped.fullYearPhased)}. The appropriation dashboard still includes every program.</p>
    <div class="tw"><table><thead><tr><th scope="col">Program</th>${MONTHS.map(month => `<th scope="col">${month}</th>`).join('')}<th scope="col">Total</th><th scope="col">Plan</th><th scope="col">Execution % of plan</th></tr></thead><tbody>
    ${list.map(program => {
      const view = programView(program, S);
      const pct = ratio(view.tExe, view.tPlan);
      return `<tr><th title="${esc(program.name)}">${esc(program.code)}</th>${view.exe.map((value, index) => `<td class="in"><input data-k="obl" data-c="${esc(program.code)}" data-i="${index}" value="${fieldValue(value)}" inputmode="decimal" autocomplete="off" aria-label="${esc(program.code)} obligations ${MONTHS[index]}"></td>`).join('')}<td class="tot">${formatMoney(view.tExe)}</td><td>${formatMoney(view.tPlan)}</td><td>${pct.text}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${multi.length ? `<details class="prov"><summary>Optional system memo for obligations (not added to execution)</summary>
      <p class="hint">For a program paid through more than one system, you can note how the combined obligation splits. The memo is not added to execution, plan, or appropriation totals. Enter the program total on the yellow row above.</p>
      <div class="tw"><table><thead><tr><th scope="col">Program</th><th scope="col">System</th>${MONTHS.map(month => `<th scope="col">${month}</th>`).join('')}<th scope="col">Memo status</th></tr></thead><tbody>
      ${multi.map(program => program.systems.map((system, systemIndex) => `<tr><th>${systemIndex === 0 ? esc(program.code) : ''}</th><td>${esc(system)}</td>${MONTHS.map((month, index) => `<td class="in"><input data-k="prov" data-c="${esc(program.code)}" data-s="${esc(system)}" data-i="${index}" value="${fieldValue(S.oblProvenance?.[program.code]?.[system]?.[index])}" inputmode="decimal" autocomplete="off" aria-label="${esc(program.code)} ${esc(system)} obligation memo ${month}"></td>`).join('')}${systemIndex === 0 ? `<td>${esc(provenanceStatus(program))}</td>` : '<td></td>'}</tr>`).join('')).join('')}
      </tbody></table></div></details>` : ''}
  </div>`;
}

function provenanceStatus(program) {
  const memo = S.oblProvenance?.[program.code] || {};
  let any = false;
  let differ = false;
  for (let index = 0; index < 12; index += 1) {
    let memoSum = 0;
    for (const system of program.systems) {
      const value = num(memo[system]?.[index]);
      if (value !== 0) any = true;
      memoSum += value;
    }
    if (Math.abs(memoSum - num(S.obl[program.code]?.[index])) > 0.0001) differ = true;
  }
  if (!any) return 'Empty memo';
  if (!differ) return 'Matches combined obligation';
  return 'Differs from combined obligation — not added to execution';
}

function imbView(list) {
  const asOf = fiscalThroughIndex(new Date());
  const rows = list.map(program => {
    const view = programView(program, S);
    return { program, view, flags: narrativeFlags(view, asOf) };
  });
  const unbalanced = rows.filter(row => row.view.delta !== 0);
  return `<div class="card"><h2>PBG vs plan balance</h2>
    <p class="hint">${unbalanced.length} of ${rows.length} programs in this fund and search have an unphased balance. Authorized PBG is counted once per program. The straight-line reference is never written into the plan. The appropriation dashboard includes every program, including ones hidden by this filter. Narrative prompts use the current fiscal month (${MONTHS[asOf]}).</p>
    <div class="tw"><table><thead><tr><th scope="col">Program</th><th scope="col">Fund</th><th scope="col">PBG</th><th scope="col">Plan</th><th scope="col">PBG − plan</th><th scope="col">% phased</th><th scope="col">Obligations</th><th scope="col">Execution % of plan</th><th scope="col">Flags</th></tr></thead><tbody>
    ${rows.map(({ program, view, flags }) => {
      const phased = ratio(view.tPlan, view.pbg);
      const exec = ratio(view.tExe, view.tPlan);
      const width = view.pbg ? Math.min(100, Math.max(0, view.tPlan / view.pbg * 100)) : 0;
      return `<tr><th>${esc(program.code)} <small>${esc(program.name)}</small></th><td>${esc(program.fund)}</td><td>${formatMoney(view.pbg)}</td><td>${formatMoney(view.tPlan)}</td><td class="${view.delta ? 'bad' : 'good'}">${formatMoney(view.delta)}</td><td><div class="bar"><i style="width:${width}%"></i></div>${phased.text}</td><td>${formatMoney(view.tExe)}</td><td>${exec.text}</td><td>${flags.length ? `<span class="chip warn">${flags.length}</span>` : ''}</td></tr>`;
    }).join('')}
    </tbody></table></div></div>
    <div class="card"><h2>PM narrative prompts</h2>
    <p class="hint">A prompt appears when a month's actual differs from plan by more than 5% of that month's plan, or an obligation posts in a month with no plan. Later months with a plan and no obligations yet stay quiet until the fiscal month reaches them.</p>
    ${rows.filter(row => row.flags.length).map(({ program, flags }) => `<div class="narr"><h4>${esc(program.code)} — ${esc(program.name)}</h4>${flags.map(flag => `<label>${MONTHS[flag.i]} · ${esc(flag.why)}<textarea data-k="note" data-c="${esc(program.code)}" data-i="${flag.i}" aria-label="${esc(program.code)} narrative ${MONTHS[flag.i]}">${esc(S.notes[program.code]?.[flag.i] || '')}</textarea></label>`).join('')}</div>`).join('') || '<p class="empty">No variances requiring narrative.</p>'}
    </div>`;
}

function assignAmount(el, amount) {
  const key = el.dataset.k;
  const index = +el.dataset.i;
  const code = el.dataset.c || ui.code;
  if (key === 'phase') S.phase[code][index] = amount;
  if (key === 'obl') S.obl[code][index] = amount;
  if (key === 'prov') {
    const system = el.dataset.s;
    if (!S.oblProvenance[code]) S.oblProvenance[code] = {};
    if (!Array.isArray(S.oblProvenance[code][system])) S.oblProvenance[code][system] = Array(12).fill(0);
    S.oblProvenance[code][system][index] = amount;
  }
}

function wire() {
  const $ = (id) => document.getElementById(id);
  $('fund').onchange = (event) => { ui.fund = event.target.value; render(); };
  $('q').oninput = (event) => {
    ui.q = event.target.value;
    clearTimeout(wire.timer);
    wire.timer = setTimeout(() => {
      render();
      const box = $('q');
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }, 300);
  };
  $('code').onchange = (event) => { ui.code = event.target.value; render(); };
  const through = $('through');
  if (through) through.onchange = (event) => { ui.through = Number(event.target.value); render(); };
  document.querySelectorAll('#period button').forEach(button => {
    button.onclick = () => { ui.period = button.dataset.v; render(); };
  });
  document.querySelectorAll('.tabs button').forEach(button => {
    button.onclick = () => { ui.tab = button.dataset.t; render(); };
  });
  const goto = $('goto-plan');
  if (goto) goto.onclick = () => { ui.tab = 'plan'; render(); };
  document.querySelectorAll('input[data-k],textarea[data-k]').forEach(el => {
    const commit = () => {
      if (el.dataset.k === 'note') {
        const code = el.dataset.c || ui.code;
        if (!S.notes[code]) S.notes[code] = {};
        S.notes[code][+el.dataset.i] = el.value;
        persist();
        return;
      }
      const typed = parseAmount(el.value);
      if (typed == null) return;
      assignAmount(el, typed);
      persist();
    };
    el.oninput = commit;
    el.onchange = () => {
      if (el.dataset.k === 'note') {
        commit();
        return;
      }
      assignAmount(el, commitAmount(el.value));
      persist();
      render();
    };
  });
  $('exp').onclick = () => download('fy27-rpa-studio.json', JSON.stringify(S, null, 1), 'application/json');
  $('imp').onchange = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      S = migrateState(data, PROGRAMS);
      persist();
      ui.saveLabel = 'Imported into this browser';
      render();
    } catch {
      ui.saveLabel = 'Import failed — this browser was not changed';
      const el = document.getElementById('save-state');
      if (el) el.textContent = ui.saveLabel;
      alert('That file could not be read as a phase-plan JSON export. This browser was not changed.');
    }
  };
  $('csv').onclick = () => download('fy27-rpa-studio.csv', toCsv(PROGRAMS, S), 'text/csv');
  const backup = $('backup');
  if (backup) backup.onclick = () => download('fy27-rpa-migration-backup.json', JSON.stringify({
    note: 'Undistributed and prior-version snapshot excluded from active totals.',
    legacy: S.legacy,
  }, null, 1), 'application/json');
  $('reset').onclick = () => {
    const ok = confirm('Clear plan, obligation, memo, and narrative entries in this browser? A migration backup, if present, stays in this browser and in Export JSON. Other computers are unchanged.');
    if (!ok) return;
    S = clearActiveEntries(S, PROGRAMS);
    persist();
    ui.saveLabel = 'Active entries cleared in this browser';
    render();
  };
}

render();
