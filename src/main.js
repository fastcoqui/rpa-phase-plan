import './style.css';
import Chart from 'chart.js/auto';
import PROGRAMS from './data/programs.json';
import {
  MONTHS, MONTHS_LONG, QTR, SL, LEGACY_STORAGE_KEY,
  appropriation, applySofMonth, calloutLines, clearActiveEntries, commitAmount, fiscalThroughIndex, formatMoney,
  includedPrograms, legacyExclusion, listSofSnapshots, loadSofSnapshot, migrateState, narrativeFlags, num, parseAmount, periodSum,
  monthFigures, previewSofApply, programView, ratio, replaceSofWorking, setDashboardIncluded, straightLineCumulative,
  sum, sumPbg, toCsv,
} from './model.js';
import { buildSofTable, formatSofMoney, programMatchKey, SOF_LAYOUT } from './sof.js';
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
  programsOpen: false,
  programQuery: '',
  sofPreview: null,
  sofPreviewStamp: '',
  sofWarnings: [],
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

function dashboardPrograms() {
  return includedPrograms(PROGRAMS, S);
}

function openProgramPicker() {
  ui.tab = 'dash';
  ui.programsOpen = true;
  render();
  const box = document.getElementById('programs-q');
  if (box) box.focus();
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
  const includedCount = dashboardPrograms().length;
  const selectionFiltered = includedCount !== PROGRAMS.length;
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
    ${selectionFiltered && ui.tab !== 'dash' ? `<button type="button" id="showing-chip" class="filter-chip" title="Edit which programs the appropriation dashboard includes">Showing ${includedCount} of ${PROGRAMS.length} programs</button>` : ''}
  </section>
  <nav class="tabs" role="tablist" aria-label="Sections">
    ${[['dash','Dashboard'],['plan','Phase plan'],['obl','Obligations'],['sof','Status of Funds'],['imb','Imbalance']].map(([id, label]) => `<button type="button" role="tab" data-t="${id}" aria-selected="${ui.tab === id}" class="${ui.tab === id ? 'on' : ''}">${label}</button>`).join('')}
  </nav>
  <main id="body"></main>
  <footer>Unofficial prototype · FY27 RPA Phase-plan Studio · Entries stay in this browser until you export them · The straight-line reference is not saved into the plan.</footer>`;

  const body = document.getElementById('body');
  if (ui.tab === 'dash') {
    body.innerHTML = dashView(list);
    drawDash(list);
  } else if (ui.tab === 'plan') body.innerHTML = planView(list);
  else if (ui.tab === 'obl') body.innerHTML = oblView(list);
  else if (ui.tab === 'sof') body.innerHTML = sofView();
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
  const unphasedTone = metrics.programs === 0 ? '' : metrics.unphased === 0 ? 'ok' : 'warn';
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

function programPicker(included) {
  const total = PROGRAMS.length;
  const count = included.length;
  const filtered = count !== total;
  const query = ui.programQuery.trim().toLowerCase();
  const visible = PROGRAMS.filter(program => !query || `${program.code} ${program.name} ${program.mdep} ${program.fund} ${program.sag}`.toLowerCase().includes(query));
  const chosen = new Set(included.map(program => program.code));
  const status = filtered ? `Showing ${count} of ${total} programs` : `All ${total} programs`;
  const rows = visible.map(program => `<li><label><input type="checkbox" data-include="${esc(program.code)}" ${chosen.has(program.code) ? 'checked' : ''}> <span class="code">${esc(program.code)}</span> <span class="pname">${esc(program.name)}</span> <span class="meta">${esc(program.fund)} · ${formatMoney(program.pbg)}</span></label></li>`).join('');
  return `<div class="program-filter ${filtered ? 'is-filtered' : ''}">
    <div class="program-filter-bar">
      <button type="button" id="programs-toggle" class="programs-toggle" aria-expanded="${ui.programsOpen}" aria-controls="programs-panel">Programs</button>
      <span class="showing ${filtered ? 'on' : ''}" id="programs-showing" role="status">${esc(status)}</span>
    </div>
    <div id="programs-panel" class="programs-panel" role="region" aria-label="Programs included in appropriation totals" ${ui.programsOpen ? '' : 'hidden'}>
      <input id="programs-q" type="search" value="${esc(ui.programQuery)}" placeholder="Search programs…" autocomplete="off" aria-label="Search programs to include">
      <div class="programs-actions">
        <button type="button" id="programs-all" class="ghost">Select all</button>
        <button type="button" id="programs-none" class="ghost">Clear all</button>
      </div>
      <p class="hint">Select all and Clear all apply to every program, including ones hidden by this search. Unchecking a program removes it from these totals only.</p>
      <ul class="programs-list">${rows || '<li class="empty">No programs match that search.</li>'}</ul>
    </div>
  </div>`;
}

function dashView(list) {
  const included = dashboardPrograms();
  const metrics = appropriation(included, S, ui.through);
  const program = selectedProgram(list);
  const total = PROGRAMS.length;
  const count = included.length;
  const filtered = count !== total;
  const scopeLine = count === 0
    ? 'No programs are included. Totals are zero and percentages are N/A.'
    : filtered
      ? `${count} of ${total} programs, all funds, counted once.`
      : `All ${total} programs and all funds, counted once.`;
  const filterNote = (ui.fund !== 'ALL' || ui.q)
    ? `<p class="filter-note">Fund or search is narrowing the program list and the drilldown below. These appropriation totals follow Programs${filtered ? ` (${count} of ${total})` : ' (every program)'} and do not follow fund or search.</p>`
    : '';
  const banner = filtered
    ? `<p class="filter-banner" role="status">Showing ${count} of ${total} programs. Excluded programs stay in the phase plan and drilldown, and their amounts are unchanged.</p>`
    : '';
  const empty = count === 0
    ? `<div class="empty-approp" role="status"><p>No programs are included in this appropriation view. Open Programs and select at least one. Charts stay hidden so a zero total is not drawn as a broken scale. Saved phase plans and obligations are unchanged.</p></div>`
    : `<div class="grid2">
      <div class="card flat"><h3>Monthly · ${MONTHS_LONG[ui.through]}</h3><div class="ch"><canvas id="c-approp-m"></canvas></div><div id="s-approp-m" class="cs"></div>
        <p class="figcap">Columns are each month's phased plan${filtered ? ' for the included programs' : ''}. The marked line is each month's obligations. The figures under this chart are for ${MONTHS_LONG[ui.through]} (${MONTHS[ui.through]}) only. The amber tick marks that month. The label above that column is obligations, the percent of that month's plan, and the amount still required to reach 95% of plan.</p></div>
      <div class="card flat"><h3>Cumulative</h3><div class="ch"><canvas id="c-approp-c"></canvas></div><div id="s-approp-c" class="cs"></div>
        <p class="figcap">Bars are cumulative phased plan. The dashed line is cumulative straight-line PBG and reaches ${filtered ? "the included programs' authorized PBG" : 'authorized PBG'} in September. It is not a saved plan. The marked line is cumulative obligations. The label above the marked month uses cumulative plan and cumulative obligations through that month.</p></div>
    </div>
    <p class="figcap">Monthly figures for the appropriation. Cumulative columns include the month shown and every earlier month. Execution percentages use that row's cumulative plan, or the included programs' full-year authorized PBG, as the denominator. N/A means the denominator is zero.</p>
    ${figuresTable(metrics, metrics.pbg)}`;
  return `<section class="appropriation" id="appropriation" aria-labelledby="approp-title" data-through="${MONTHS[metrics.throughIndex]}" data-included="${count}" data-programs="${total}">
    <div class="dash-top">
      <div>
        <p class="eyebrow"><span class="badge">Default view</span> Appropriation</p>
        <h2 id="approp-title">RPA appropriation</h2>
        <p class="scope">${scopeLine} Fund and search change the program list and the drilldown only. Excluding a program here leaves its phase plan and obligations in place.</p>
      </div>
      <label class="month-pick">Cumulative through
        <select id="through" aria-label="Month for cumulative appropriation metrics">${MONTHS.map((month, index) => `<option value="${index}" ${index === ui.through ? 'selected' : ''}>${MONTHS_LONG[index]}</option>`).join('')}</select>
      </label>
    </div>
    ${programPicker(included)}
    ${banner}
    ${filterNote}
    <div class="kpis inset">${metricCards(metrics, count === total ? `All ${total} programs.` : `${count} of ${total} programs.`, 'approp')}</div>
    ${empty}
  </section>
  ${program ? drillView(program, new Set(included.map(item => item.code))) : `<section class="card" id="drilldown"><h2>Program drilldown</h2><p class="empty">No program matches the fund and search filters. Appropriation totals above follow Programs, not this fund or search.</p></section>`}`;
}

function drillView(program, includedCodes) {
  const metrics = appropriation([program], S, ui.through);
  const systems = (program.systems || []).join(' and ');
  const excluded = includedCodes && !includedCodes.has(program.code);
  const membership = excluded
    ? 'Excluded from the appropriation totals above. Its plan and obligations are unchanged and are still shown here.'
    : 'Already included once in the appropriation totals above.';
  return `<section class="card" id="drilldown" aria-labelledby="drill-title">
    <div class="card-h"><div>
      <p class="eyebrow">Program drilldown</p>
      <h2 id="drill-title">${esc(program.code)} — ${esc(program.name)}</h2>
      <p class="scope">This program only. MDEP ${esc(program.mdep)} · Fund ${esc(program.fund)} · SAG ${esc(program.sag)} · Systems covered by its one plan row: ${esc(systems)}. ${membership} Cumulative figures use ${throughText(ui.through)}.</p>
    </div>
    <button type="button" class="ghost" id="goto-plan">Open phase plan</button></div>
    <div class="kpis inset">${metricCards(metrics, `${program.code} only.`, 'drill')}</div>
    <div class="grid2">
      <div class="card flat"><h3>Monthly · ${MONTHS_LONG[ui.through]}</h3><div class="ch"><canvas id="c-prog-m"></canvas></div><div id="s-prog-m" class="cs"></div>
        <p class="figcap">Figures under this chart are for ${MONTHS_LONG[ui.through]} (${MONTHS[ui.through]}) only. The label above that column is this program's obligations, percent of plan, and the amount still required to reach 95% of plan.</p></div>
      <div class="card flat"><h3>Cumulative</h3><div class="ch"><canvas id="c-prog-c"></canvas></div><div id="s-prog-c" class="cs"></div></div>
    </div>
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

function requiredSummary(planAmount, oblAmount, basis) {
  const callout = calloutLines(planAmount, oblAmount, { narrow: false });
  const tone = callout.met ? 'met' : 'need';
  const text = callout.met ? '95% target met' : formatMoney(callout.required);
  return `<span>Required to meet 95% <b class="${tone}" data-required="${callout.required}" data-callout-met="${callout.met}" data-callout-line1="${esc(callout.line1)}" data-callout-line2="${esc(callout.line2)}">${text}</b> <small>${basis}</small></span>`;
}

function chartSummary(plan, exe, pbg, mode) {
  if (mode === 'month') {
    const month = monthFigures(plan, exe, ui.through);
    const label = `${MONTHS_LONG[month.index]} (${MONTHS[month.index]})`;
    const basis = month.execOfPlan.value == null
      ? `N/A because the ${MONTHS[month.index]} plan is zero`
      : `denominator: ${MONTHS[month.index]} plan`;
    return `<span>${label} plan <b data-month-plan="${month.plan}">${formatMoney(month.plan)}</b></span><span>${label} obligations <b data-month-obl="${month.obligations}">${formatMoney(month.obligations)}</b></span><span>Actual − plan <b data-month-var="${month.actualMinusPlan}">${formatMoney(month.actualMinusPlan)}</b> <small>${label} obligations minus ${label} plan</small></span><span>Execution % of plan <b data-month-exec="${month.execOfPlan.text}">${month.execOfPlan.text}</b> <small>${basis}</small></span>${requiredSummary(month.plan, month.obligations, `0.95 × ${MONTHS[month.index]} plan − ${MONTHS[month.index]} obligations`)}`;
  }
  const through = ui.through;
  const cumPlan = plan[through];
  const cumExe = exe[through];
  const exec = ratio(cumExe, cumPlan);
  const ofPbg = ratio(cumExe, pbg);
  return `<span>Cumulative plan <b>${formatMoney(cumPlan)}</b></span><span>Cumulative obligations <b>${formatMoney(cumExe)}</b></span><span>Actual − plan <b>${formatMoney(cumExe - cumPlan)}</b></span><span>Execution % of plan <b>${exec.text}</b> <small>denominator: cumulative plan through ${MONTHS[through]}</small></span><span>Execution % of PBG <b>${ofPbg.text}</b> <small>denominator: full-year PBG</small></span>${requiredSummary(cumPlan, cumExe, `0.95 × cumulative plan − cumulative obligations through ${MONTHS[through]}`)}`;
}

function axisCeiling(series) {
  let peak = 0;
  for (const values of series) {
    if (!values) continue;
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > peak) peak = n;
    }
  }
  if (peak <= 0) return undefined;
  return peak * 1.45;
}

function makeCalloutPlugin(plan, exe, index) {
  return {
    id: 'obligationCallout',
    afterDraw(chart) {
      const planned = plan[index];
      const actual = exe[index];
      let narrow = window.innerWidth < 640;
      let lines = calloutLines(planned, actual, { narrow });
      const barIndex = chart.data.datasets.findIndex(dataset => dataset.label === 'Phased plan');
      const lineIndex = chart.data.datasets.findIndex(dataset => dataset.label === 'Obligations');
      const bar = chart.getDatasetMeta(barIndex)?.data?.[index];
      const point = lineIndex >= 0 ? chart.getDatasetMeta(lineIndex)?.data?.[index] : null;
      if (!bar) return;
      const ctx = chart.ctx;
      const font1 = '700 12px Inter, system-ui, Segoe UI, sans-serif';
      const font2 = '600 11px Inter, system-ui, Segoe UI, sans-serif';
      ctx.save();
      ctx.font = font1;
      let width1 = ctx.measureText(lines.line1).width;
      ctx.font = font2;
      let width2 = ctx.measureText(lines.line2).width;
      const area = chart.chartArea;
      if (!narrow && Math.max(width1, width2) > (area.right - area.left) * 0.92) {
        narrow = true;
        lines = calloutLines(planned, actual, { narrow: true });
        ctx.font = font2;
        width2 = ctx.measureText(lines.line2).width;
      }
      const padX = 7;
      const padY = 5;
      const boxW = Math.min(Math.max(width1, width2) + padX * 2, area.right - area.left - 4);
      const boxH = 12 + 11 + 3 + padY * 2;
      let x = bar.x - boxW / 2;
      if (x < area.left + 2) x = area.left + 2;
      if (x + boxW > area.right - 2) x = area.right - 2 - boxW;
      const anchorY = Math.min(bar.y, point ? point.y : bar.y);
      let y = anchorY - boxH - 6;
      if (y < 2) y = 2;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.strokeStyle = lines.met ? '#047857' : '#1d4ed8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, boxW, boxH, 6);
      else ctx.rect(x, y, boxW, boxH);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = font1;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(lines.line1, x + boxW / 2, y + padY);
      ctx.font = font2;
      ctx.fillStyle = lines.met ? '#047857' : '#1d4ed8';
      ctx.fillText(lines.line2, x + boxW / 2, y + padY + 15);
      ctx.restore();
      const canvas = chart.canvas;
      if (canvas) {
        const base = canvas.getAttribute('data-callout-base') || canvas.getAttribute('aria-label') || '';
        if (!canvas.getAttribute('data-callout-base')) canvas.setAttribute('data-callout-base', base);
        canvas.setAttribute('aria-label', `${base} Selected month ${MONTHS[index]}: ${lines.line1}. ${lines.line2}.`);
      }
    },
  };
}

function drawCombo(canvasId, summaryId, { pbgRef, plan, exe, pbg, mode, aria }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', aria);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const datasets = [];
  if (mode !== 'month') {
    datasets.push({ type: 'line', label: 'PBG reference (straight-line)', data: pbgRef.slice(), fill: false, borderColor: '#64748b', borderDash: [6, 4], pointRadius: 0, tension: 0, order: 3 });
  }
  datasets.push(
    { type: 'bar', label: 'Phased plan', data: plan.slice(), backgroundColor: '#1e3a8a', borderRadius: 3, maxBarThickness: 28, order: 2 },
    { type: 'line', label: 'Obligations', data: exe.slice(), borderColor: '#b45309', backgroundColor: '#f59e0b', pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, tension: 0.15, order: 1 },
  );
  charts.push(new Chart(canvas, {
    plugins: [makeThroughPlugin(ui.through), makeCalloutPlugin(plan, exe, ui.through)],
    data: {
      labels: MONTHS,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : undefined,
      layout: { padding: { top: 8 } },
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
          beginAtZero: true,
          suggestedMax: axisCeiling([plan, exe, pbgRef]) || undefined,
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
  const included = dashboardPrograms();
  const metrics = appropriation(included, S, ui.through);
  const scope = included.length === PROGRAMS.length
    ? `all ${PROGRAMS.length} programs`
    : `${included.length} of ${PROGRAMS.length} programs`;
  const monthAria = `Appropriation monthly chart for ${scope}. Bars are each month's phased plan. Marked line is each month's obligations. Summary figures are for ${MONTHS_LONG[ui.through]} only.`;
  const cumAria = `Appropriation cumulative chart for ${scope} through ${MONTHS_LONG[ui.through]}. Dashed line is cumulative straight-line PBG reference for the included authorized PBG and is not a saved plan.`;
  if (included.length) {
    drawCombo('c-approp-m', 's-approp-m', {
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
  }
  const program = selectedProgram(list);
  if (!program) return;
  const view = programView(program, S);
  drawCombo('c-prog-m', 's-prog-m', {
    plan: view.plan,
    exe: view.exe,
    pbg: view.pbg,
    mode: 'month',
    aria: `${program.code} monthly chart for ${MONTHS_LONG[ui.through]}. Bars are each month's phased plan. Marked line is each month's obligations.`,
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

function quarterHeads() {
  return ['Q1', 'Q2', 'Q3', 'Q4'].map(quarter => `<th scope="col" class="${ui.period === quarter ? 'hl' : ''}">${quarter}</th>`).join('');
}

function quarterCells(values) {
  return ['Q1', 'Q2', 'Q3', 'Q4'].map(quarter => {
    const hot = ui.period === quarter ? 'q hl' : 'q';
    return `<td class="${hot}">${formatMoney(periodSum(values, quarter))}</td>`;
  }).join('');
}

function quarterControl() {
  const note = ui.period === 'Annual'
    ? 'Annual leaves every month unshaded.'
    : `${ui.period} months and the ${ui.period} total are shaded. Numbers stay readable, and nothing here is saved.`;
  const buttons = Object.keys(QTR).map(period => `<button type="button" data-v="${period}" class="${period === ui.period ? 'on' : ''}" aria-pressed="${period === ui.period}">${period}</button>`).join('');
  return `<div class="plan-tools">
    <div class="quarter-field">
      <span id="period-label">Quarter highlight</span>
      <span class="seg" id="period" role="group" aria-labelledby="period-label">${buttons}</span>
    </div>
    <p class="highlight-status ${ui.period === 'Annual' ? '' : 'on'}" role="status">${esc(note)}</p>
  </div>`;
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
  const head = `<tr><th scope="col"></th>${MONTHS.map((month, index) => `<th scope="col" class="${hot(index)}">${month}</th>`).join('')}${quarterHeads()}<th scope="col">Total</th><th scope="col">PBG</th><th scope="col">PBG − plan</th></tr>`;
  const execPct = ratio(view.tExe, view.tPlan);
  const excludedFromDash = !dashboardPrograms().some(item => item.code === program.code);
  return `<div class="card"><div class="card-h"><div><h2>${esc(program.code)} — ${esc(program.name)}</h2>
    <p>MDEP ${esc(program.mdep)} · Fund ${esc(program.fund)} · SAG ${esc(program.sag)}</p>
    <div class="syschips">${systems.map(system => `<span>${esc(system)}</span>`).join('')}</div></div>
    <div class="chip ${view.delta === 0 ? 'ok' : 'warn'}">PBG − plan ${formatMoney(view.delta)}</div></div>
    <p class="hint">${esc(systemText)} Yellow cells are the entry. Monthly execution uses the same obligation figures as the Obligations tab, stored once. Quarter highlight does not change what is saved. MTH and CML variance are plan minus execution. The appropriation dashboard also shows actual minus plan.</p>
    ${excludedFromDash ? '<p class="filter-banner">This program is excluded from the appropriation dashboard. Amounts entered here stay saved and stay out of those totals until it is included again.</p>' : ''}
    ${quarterControl()}
    <div class="tw"><table data-plan-rows="1" data-quarter-highlight="${esc(ui.period)}"><thead>${head}</thead><tbody>
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
    <p class="hint">Each yellow row is that program's execution. It feeds monthly execution, cumulative execution, variance, and the appropriation dashboard once. ${list.length} programs in this fund and search. Full-year obligations ${formatMoney(scoped.fullYearObl)}. Full-year plan ${formatMoney(scoped.fullYearPhased)}. The appropriation dashboard follows Programs and can omit a program that is still listed here.</p>
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
    <p class="hint">${unbalanced.length} of ${rows.length} programs in this fund and search have an unphased balance. Authorized PBG is counted once per program. The straight-line reference is never written into the plan. The appropriation dashboard follows Programs, including programs hidden by this fund or search filter. Narrative prompts use the current fiscal month (${MONTHS[asOf]}).</p>
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

function sofIo() {
  return import('./sof-io.js');
}

function todayIso() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function sofAsOf() {
  return S.sof?.asOf || todayIso();
}

function sofStamp() {
  return JSON.stringify({ asOf: sofAsOf(), rows: S.sof?.rows || {}, extras: S.sof?.extras || [] });
}

function ensureSof() {
  if (!S.sof || typeof S.sof !== 'object') S.sof = { rows: {}, extras: [], snapshots: {} };
  if (!S.sof.rows || typeof S.sof.rows !== 'object') S.sof.rows = {};
  if (!Array.isArray(S.sof.extras)) S.sof.extras = [];
  if (!S.sof.snapshots || typeof S.sof.snapshots !== 'object') S.sof.snapshots = {};
  return S.sof;
}

function sofRowRecord(key) {
  const sof = ensureSof();
  if (key.startsWith('extra:')) {
    const index = Number(key.slice(6));
    return Number.isInteger(index) ? sof.extras[index] || null : null;
  }
  if (!sof.rows[key]) sof.rows[key] = { obligations: 0, commitments: 0, comments: '', obligationsSet: false };
  return sof.rows[key];
}

function sofInputValue(value, showZero) {
  const n = num(value);
  if (!showZero && n === 0) return '';
  return String(Math.round(n * 100) / 100);
}

function sofMoneyCell(value) {
  if (value == null || value === '') return '<td></td>';
  const n = num(value);
  return `<td class="${n < 0 ? 'neg' : ''}">${esc(formatSofMoney(n))}</td>`;
}

function sofPctCell(result, tone) {
  const cls = tone ? `pct ${tone}` : 'pct';
  return `<td class="${cls}">${esc(result.text)}</td>`;
}

function sofPreviewModel(table) {
  const cumulative = {};
  const unmatched = [];
  for (const line of table.lines) {
    if (line.kind !== 'data') continue;
    if (line.programCode && line.obligationsSet) cumulative[line.programCode] = line.obligations;
    if (line.unmatched && (line.obligationsSet || line.extra)) {
      unmatched.push({
        label: `${line.mdep}${line.suffix ? ` ${line.suffix}` : ''} — ${line.name}`,
        cumulative: line.obligations,
      });
    }
  }
  return {
    monthIndex: table.monthIndex,
    rows: previewSofApply(PROGRAMS, S, cumulative, table.monthIndex),
    unmatched,
  };
}

function sofView() {
  const asOf = sofAsOf();
  const table = buildSofTable(PROGRAMS, S, asOf);
  const snapshots = listSofSnapshots(S);
  const fresh = ui.sofPreview && ui.sofPreviewStamp === sofStamp();
  const preview = fresh ? ui.sofPreview : null;
  const warning = (ui.sofWarnings || []).slice(0, 6);
  const rows = table.lines.map(line => {
    if (line.kind === 'gap') return '<tr class="sof-gap"><td colspan="22"></td></tr>';
    if (line.kind === 'subtotal') {
      return `<tr class="roll sof-total" data-sof-total="${esc(line.id)}"><th colspan="6">${esc(line.label)}</th>
        ${sofMoneyCell(line.pbg)}${sofMoneyCell(line.plan)}${sofMoneyCell(line.allotment)}${sofMoneyCell(line.obligations)}
        ${sofMoneyCell(line.commitments)}${sofMoneyCell(line.totalExecution)}${sofMoneyCell(line.availablePbg)}${sofMoneyCell(line.availableAllotment)}
        ${sofPctCell(line.oblVsPlan, line.tone)}${sofPctCell(line.oblVsPbg, '')}${sofPctCell(line.execVsPbg, '')}
        <td></td>${sofMoneyCell(line.julTarget)}${sofMoneyCell(line.obligationToJul)}${sofMoneyCell(line.plan95)}${sofMoneyCell(line.variance)}</tr>`;
    }
    const flag = line.unmatched ? ' <span class="chip warn">Unmatched</span>' : '';
    const allotmentCell = line.isAnchor
      ? `<td class="in"><input data-sof="allot" data-sof-key="${esc(line.key)}" data-sof-group="${esc(line.groupId)}" value="${esc(sofInputValue(line.allotment, line.allotment != null))}" inputmode="decimal" autocomplete="off" aria-label="${esc(line.key)} allotment"></td>`
      : '<td class="sof-span" title="Included in this allotment group"></td>';
    const available = line.isAnchor ? sofMoneyCell(line.availableAllotment) : '<td></td>';
    const pbgCell = line.programCode
      ? sofMoneyCell(line.pbg)
      : `<td class="in"><input data-sof="pbg" data-sof-key="${esc(line.key)}" value="${esc(sofInputValue(line.pbg, true))}" inputmode="decimal" autocomplete="off" aria-label="${esc(line.key)} PBG"></td>`;
    const planCell = line.programCode
      ? sofMoneyCell(line.plan)
      : `<td class="in"><input data-sof="plan" data-sof-key="${esc(line.key)}" value="${esc(sofInputValue(line.plan, true))}" inputmode="decimal" autocomplete="off" aria-label="${esc(line.key)} plan"></td>`;
    return `<tr class="${line.unmatched ? 'unmatched' : ''}" data-sof-row="${esc(line.key)}">
      <th><span class="sof-id">${esc(line.mdep)}${line.suffix ? ` ${esc(line.suffix)}` : ''}</span>${flag}<small>${esc(line.name)}</small></th>
      <td>${esc(line.pm)}</td><td>${esc(line.sag)}</td><td>${esc(line.mdep)}</td><td>${esc(line.suffix)}</td><td>${esc(line.name)}</td>
      ${pbgCell}${planCell}${allotmentCell}
      <td class="in"><input data-sof="obl" data-sof-key="${esc(line.key)}" value="${esc(sofInputValue(line.obligations, line.obligationsSet))}" inputmode="decimal" autocomplete="off" aria-label="${esc(line.key)} cumulative obligations"></td>
      <td class="in"><input data-sof="commit" data-sof-key="${esc(line.key)}" value="${esc(sofInputValue(line.commitments, line.commitments !== 0))}" inputmode="decimal" autocomplete="off" aria-label="${esc(line.key)} commitments"></td>
      ${sofMoneyCell(line.totalExecution)}${sofMoneyCell(line.availablePbg)}${available}
      ${sofPctCell(line.oblVsPlan, line.tone)}${sofPctCell(line.oblVsPbg, '')}${sofPctCell(line.execVsPbg, '')}
      <td class="in sof-comment"><input data-sof="comment" data-sof-key="${esc(line.key)}" value="${esc(line.comments)}" autocomplete="off" aria-label="${esc(line.key)} comments"></td>
      ${sofMoneyCell(line.julTarget)}${sofMoneyCell(line.obligationToJul)}${sofMoneyCell(line.plan95)}${sofMoneyCell(line.variance)}
    </tr>`;
  }).join('');
  const footer = table.footer.rows.map(item => `<div class="sof-target"><span>${esc(item.label)}</span><b>${esc(formatSofMoney(item.target))}</b><span>To meet target:</span><b class="${item.toMeet < 0 ? 'neg' : ''}">${esc(formatSofMoney(item.toMeet))}</b>${item.note ? `<em>${esc(item.note)}</em>` : ''}</div>`).join('');
  const previewHtml = preview ? sofPreviewHtml(preview, table) : (ui.sofPreview ? '<p class="filter-banner">This preview is out of date. Update the preview before applying.</p>' : '');
  const snapHtml = snapshots.length ? `<ul class="sof-snaps">${snapshots.map(snap => `<li><span>${esc(MONTHS_LONG[snap.month])} snapshot${snap.asOf ? ` · as of ${esc(snap.asOf)}` : ''} · ${snap.programs} obligation rows</span> <button type="button" class="ghost" data-load-snap="${snap.month}">Load</button></li>`).join('')}</ul>` : '<p class="hint">No snapshot stored yet. Apply a report to keep it.</p>';
  return `<div class="card sof-card"><div class="card-h"><div>
      <p class="eyebrow">Status of Funds</p>
      <h2>RPA Status of Funds</h2>
      <p class="hint">Obligations and commitments here are cumulative fiscal-year-to-date as of the report date. PLAN for a matched program is the phase plan cumulative through ${esc(table.monthLabel)}. PBG is that program's authorized PBG. TOTAL EXECUTION is obligations plus commitments. AVAILABLE PBG is PBG minus total execution. AVAILABLE ALLOTMENT is the group allotment minus the obligations in that group. EOM JUL 80% target is PBG × 0.8. The 95% plan target is PLAN × 0.95, and variance is that target minus obligations.</p>
    </div></div>
    ${table.outside ? `<p class="filter-banner">That date is outside FY27 (October 2026–September 2027). Figures use ${esc(table.monthLabel)}.</p>` : ''}
    <div class="sof-tools">
      <label class="month-pick">As of
        <input type="date" id="sof-asof" value="${esc(asOf)}" aria-label="Status of Funds as of date">
      </label>
      <label class="btn sof-file">Import .xlsx / .csv<input type="file" id="sof-file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <button type="button" id="sof-export">Export .xlsx</button>
      <button type="button" id="sof-preview" class="ghost">Preview apply to obligations</button>
    </div>
    ${warning.length ? `<ul class="sof-warnings">${warning.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
    <details class="prov"><summary>Paste rows</summary>
      <p class="hint">Paste a block copied from the template, including the header row, or a CSV in the same columns.</p>
      <textarea id="sof-paste" aria-label="Paste Status of Funds rows"></textarea>
      <button type="button" id="sof-paste-load" class="ghost">Load pasted rows</button>
    </details>
    <div id="sof-preview-panel">${previewHtml}</div>
    <p class="hint sof-legend"><span class="pct low">Under 50% of plan</span> · <span class="pct mid">50% up to 95%</span> · <span class="pct ok">95% or more</span> · N/A means the plan is zero. An unmatched row is not one of the 31 programs. It stays on this tab and is not written into monthly obligations.</p>
    <div class="tw sof-wrap"><table class="sof-table"><thead><tr>
      <th scope="col">Program</th><th scope="col">PM</th><th scope="col">SAG</th><th scope="col">MDEP</th><th scope="col">Suffix</th><th scope="col">Description</th>
      <th scope="col">PBG</th><th scope="col">PLAN</th><th scope="col">ALLOTMENT</th><th scope="col">OBLIGATIONS</th><th scope="col">COMMITMENTS</th>
      <th scope="col">TOTAL EXECUTION</th><th scope="col">AVAILABLE PBG</th><th scope="col">AVAILABLE ALLOTMENT</th>
      <th scope="col">% OBL vs PLAN</th><th scope="col">% OBL vs PBG</th><th scope="col">% EXEC vs PBG</th>
      <th scope="col">COMMENTS</th><th scope="col">EOM JUL 80% Target</th><th scope="col">Obligation to meet target</th>
      <th scope="col">95% PLAN TARGET</th><th scope="col">VARIANCE</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div class="sof-footer" aria-label="Targets versus base total obligations">
      <h3>Targets vs base total obligations</h3>
      <p class="hint">95%, 100%, and 105% of BASE TOTAL plan, compared with BASE TOTAL obligations. The 105% line is the amount not to exceed.</p>
      ${footer}
    </div>
    <h3>Stored snapshots</h3>
    <p class="hint">Each apply keeps the cumulative report for that fiscal month. Loading a snapshot brings it back to this sheet. Applying it again rewrites that month, and later months that already have a snapshot are re-derived.</p>
    ${snapHtml}
  </div>`;
}

function sofPreviewHtml(preview, table) {
  const month = MONTHS_LONG[preview.monthIndex];
  const body = preview.rows.map(row => `<tr class="${row.deobligation ? 'deobl' : ''}" data-preview="${esc(row.code)}">
      <th>${esc(row.code)} <small>${esc(row.name)}</small></th>
      <td>${esc(formatSofMoney(row.cumulative))}</td>
      <td>${esc(formatSofMoney(row.prior))}</td>
      <td class="${row.derived < 0 ? 'neg' : ''}">${esc(formatSofMoney(row.derived))}</td>
      <td>${row.deobligation ? 'cumulative decreased — check de-obligation' : ''}</td>
    </tr>`).join('');
  const unmatched = preview.unmatched.map(row => `<tr class="unmatched">
      <th>${esc(row.label)}</th>
      <td>${esc(formatSofMoney(row.cumulative))}</td>
      <td>—</td><td>—</td>
      <td>Unmatched — not applied to obligations</td>
    </tr>`).join('');
  const count = preview.rows.length;
  const flagged = preview.rows.filter(row => row.deobligation).length;
  return `<section class="sof-preview" aria-label="Obligation apply preview">
    <h3>Preview — ${esc(month)} monthly obligations</h3>
    <p class="hint">Monthly obligation = cumulative SOF − obligations already recorded for earlier FY27 months. ${esc(month)} is not part of that prior total, so confirming replaces this month's figure. ${count} matched program${count === 1 ? '' : 's'}.${flagged ? ` ${flagged} flagged because the cumulative total is below prior months.` : ''}</p>
    <div class="tw"><table><thead><tr>
      <th scope="col">Program</th><th scope="col">Cumulative SOF</th><th scope="col">Prior months total</th><th scope="col">Derived month amount</th><th scope="col">Flag</th>
    </tr></thead><tbody>${body}${unmatched}${count || preview.unmatched.length ? '' : '<tr><td colspan="5">Nothing to apply yet. Enter obligations or import a report.</td></tr>'}</tbody></table></div>
    <button type="button" id="sof-confirm">Confirm apply to obligations</button>
    <p class="hint">Confirm writes these monthly amounts into the phase-plan execution rows and the dashboard. Unmatched rows stay on this tab only.</p>
  </section>`;
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
    button.onclick = () => {
      ui.tab = button.dataset.t;
      if (ui.tab !== 'dash') ui.programsOpen = false;
      render();
    };
  });
  const showingChip = $('showing-chip');
  if (showingChip) showingChip.onclick = () => openProgramPicker();
  const programsToggle = $('programs-toggle');
  if (programsToggle) {
    programsToggle.onclick = () => {
      ui.programsOpen = !ui.programsOpen;
      render();
      if (ui.programsOpen) {
        const box = $('programs-q');
        if (box) box.focus();
      }
    };
  }
  const programsAll = $('programs-all');
  if (programsAll) {
    programsAll.onclick = () => {
      setDashboardIncluded(S, PROGRAMS, PROGRAMS.map(program => program.code));
      ui.programsOpen = true;
      persist();
      render();
      const again = $('programs-all');
      if (again) again.focus();
    };
  }
  const programsNone = $('programs-none');
  if (programsNone) {
    programsNone.onclick = () => {
      setDashboardIncluded(S, PROGRAMS, []);
      ui.programsOpen = true;
      persist();
      render();
      const again = $('programs-none');
      if (again) again.focus();
    };
  }
  const programsQuery = $('programs-q');
  if (programsQuery) {
    programsQuery.oninput = (event) => {
      ui.programQuery = event.target.value;
      ui.programsOpen = true;
      clearTimeout(wire.programTimer);
      wire.programTimer = setTimeout(() => {
        render();
        const box = $('programs-q');
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }, 200);
    };
  }
  document.querySelectorAll('input[data-include]').forEach(box => {
    box.onchange = () => {
      const codes = dashboardPrograms().map(program => program.code);
      const code = box.dataset.include;
      const next = box.checked ? codes.concat(code) : codes.filter(item => item !== code);
      setDashboardIncluded(S, PROGRAMS, next);
      ui.programsOpen = true;
      persist();
      render();
      const again = document.querySelector(`input[data-include="${CSS.escape(code)}"]`);
      if (again) again.focus();
    };
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
  document.querySelectorAll('input[data-sof]').forEach(el => {
    const commit = (final) => {
      const record = sofRowRecord(el.dataset.sofKey);
      if (!record) return;
      if (el.dataset.sof === 'comment') {
        record.comments = el.value.slice(0, 500);
        persist();
        return;
      }
      const parsed = final ? commitAmount(el.value) : parseAmount(el.value);
      if (parsed == null) return;
      if (el.dataset.sof === 'obl') {
        record.obligations = parsed;
        record.obligationsSet = true;
      } else if (el.dataset.sof === 'commit') record.commitments = parsed;
      else if (el.dataset.sof === 'pbg') record.pbg = parsed;
      else if (el.dataset.sof === 'plan') record.plan = parsed;
      else if (el.dataset.sof === 'allot') {
        if (String(el.value).trim() === '') delete record.allotment;
        else record.allotment = parsed;
        const group = el.dataset.sofGroup;
        const block = SOF_LAYOUT.find(item => item.id === group);
        if (block && block.rows) {
          for (const def of block.rows) {
            const key = programMatchKey(def.mdep, def.suffix);
            if (key !== el.dataset.sofKey && S.sof?.rows?.[key]) delete S.sof.rows[key].allotment;
          }
        }
      }
      if (!S.sof.asOf) S.sof.asOf = sofAsOf();
      persist();
    };
    el.oninput = () => commit(false);
    el.onchange = () => {
      commit(true);
      ui.sofPreview = null;
      render();
    };
  });
  const sofAsOfInput = $('sof-asof');
  if (sofAsOfInput) {
    sofAsOfInput.onchange = () => {
      ensureSof().asOf = sofAsOfInput.value;
      ui.sofPreview = null;
      persist();
      render();
    };
  }
  const sofFile = $('sof-file');
  if (sofFile) {
    sofFile.onchange = async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const { parseSofTable } = await sofIo();
        const name = file.name.toLowerCase();
        const parsed = (name.endsWith('.csv') || (file.type && file.type.includes('csv')))
          ? parseSofTable(await file.text())
          : parseSofTable(await file.arrayBuffer());
        replaceSofWorking(S, parsed);
        ui.sofWarnings = parsed.warnings || [];
        ui.sofPreview = null;
        persist();
        ui.saveLabel = `Loaded Status of Funds${parsed.asOf ? ` as of ${parsed.asOf}` : ''}`;
        render();
      } catch (error) {
        ui.saveLabel = 'Status of Funds import failed — this browser was not changed';
        const status = document.getElementById('save-state');
        if (status) status.textContent = ui.saveLabel;
        alert(error instanceof Error ? error.message : 'That Status of Funds file could not be read. This browser was not changed.');
      }
    };
  }
  const sofPaste = $('sof-paste-load');
  if (sofPaste) {
    sofPaste.onclick = async () => {
      const text = $('sof-paste') ? $('sof-paste').value : '';
      try {
        const { parseSofTable } = await sofIo();
        const parsed = parseSofTable(text);
        replaceSofWorking(S, parsed);
        ui.sofWarnings = parsed.warnings || [];
        ui.sofPreview = null;
        persist();
        ui.saveLabel = `Loaded pasted Status of Funds${parsed.asOf ? ` as of ${parsed.asOf}` : ''}`;
        render();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Those rows could not be read. This browser was not changed.');
      }
    };
  }
  const sofExport = $('sof-export');
  if (sofExport) {
    sofExport.onclick = async () => {
      const { sofToArrayBuffer } = await sofIo();
      const table = buildSofTable(PROGRAMS, S, sofAsOf());
      const bytes = sofToArrayBuffer(table);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RPA_Status_of_Funds_${table.asOf || 'fy27'}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  const sofPreviewBtn = $('sof-preview');
  if (sofPreviewBtn) {
    sofPreviewBtn.onclick = () => {
      const table = buildSofTable(PROGRAMS, S, sofAsOf());
      ui.sofPreview = sofPreviewModel(table);
      ui.sofPreviewStamp = sofStamp();
      render();
      const panel = document.getElementById('sof-preview-panel');
      if (panel) panel.scrollIntoView({ block: 'start' });
    };
  }
  const sofConfirm = $('sof-confirm');
  if (sofConfirm) {
    sofConfirm.onclick = () => {
      if (!ui.sofPreview || ui.sofPreviewStamp !== sofStamp()) {
        ui.sofPreview = null;
        render();
        return;
      }
      const table = buildSofTable(PROGRAMS, S, sofAsOf());
      applySofMonth(S, PROGRAMS, {
        monthIndex: table.monthIndex,
        asOf: sofAsOf(),
        rows: S.sof?.rows || {},
        extras: S.sof?.extras || [],
      });
      ui.sofPreview = null;
      ui.sofPreviewStamp = '';
      persist();
      ui.saveLabel = `Applied ${MONTHS[table.monthIndex]} obligations from Status of Funds`;
      render();
    };
  }
  document.querySelectorAll('[data-load-snap]').forEach(button => {
    button.onclick = () => {
      loadSofSnapshot(S, Number(button.dataset.loadSnap));
      ui.sofPreview = null;
      persist();
      ui.saveLabel = `Loaded ${MONTHS[Number(button.dataset.loadSnap)]} Status of Funds snapshot`;
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
    const ok = confirm('Clear plan, obligation, Status of Funds, memo, and narrative entries in this browser? A migration backup, if present, stays in this browser and in Export JSON. Other computers are unchanged.');
    if (!ok) return;
    S = clearActiveEntries(S, PROGRAMS);
    persist();
    ui.saveLabel = 'Active entries cleared in this browser';
    render();
  };
}

render();
