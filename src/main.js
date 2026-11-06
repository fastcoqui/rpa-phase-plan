import './style.css';
import Chart from 'chart.js/auto';
import PROGRAMS from './data/programs.json';

const MONTHS = ['Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27','Apr-27','May-27','Jun-27','Jul-27','Aug-27','Sep-27'];
const SL = [8,17,25,33,42,50,58,67,75,83,92,100];
const QTR = { Q1:[0,1,2], Q2:[3,4,5], Q3:[6,7,8], Q4:[9,10,11], Annual:[0,1,2,3,4,5,6,7,8,9,10,11] };
const KEY = 'fy27-rpa-studio-v1';
const z = () => Array(12).fill(0);
const fmt = n => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const pct = n => isFinite(n) ? (n * 100).toFixed(1) + '%' : '—';
const sum = a => a.reduce((s, v) => s + (+v || 0), 0);
const cum = a => { let s = 0; return a.map(v => (s += +v || 0)); };
const add = (...arr) => z().map((_, i) => sum(arr.map(a => a[i])));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

let S = load();
function blank() {
  const st = { phase: {}, obl: {}, undPbg: {}, notes: {} };
  for (const p of PROGRAMS) {
    st.phase[p.code] = { HQ: {}, UND: {} };
    for (const s of p.systems) { st.phase[p.code].HQ[s] = z(); st.phase[p.code].UND[s] = z(); }
    st.obl[p.code] = z(); st.undPbg[p.code] = 0; st.notes[p.code] = {};
  }
  return st;
}
function load() {
  const b = blank();
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) for (const k of Object.keys(b)) Object.assign(b[k], s[k] || {}); } catch {}
  return b;
}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

const ui = { fund: 'ALL', q: '', code: PROGRAMS[0].code, block: 'ALL', period: 'Annual', tab: 'plan' };

// ---------- calc ----------
function prog(code) {
  const p = PROGRAMS.find(x => x.code === code);
  const ph = S.phase[code];
  const hqPlan = add(...p.systems.map(s => ph.HQ[s]));
  const undPlan = add(...p.systems.map(s => ph.UND[s]));
  const hqExe = S.obl[code].map(v => +v || 0);
  const undExe = z();
  const undPbg = +S.undPbg[code] || 0;
  const B = {
    HQ: { pbg: p.pbg - undPbg, plan: hqPlan, exe: hqExe },
    UND: { pbg: undPbg, plan: undPlan, exe: undExe },
    ALL: { pbg: p.pbg, plan: add(hqPlan, undPlan), exe: add(hqExe, undExe) },
  };
  for (const b of Object.values(B)) {
    b.var = b.plan.map((v, i) => v - b.exe[i]);
    b.cp = cum(b.plan); b.ce = cum(b.exe); b.cv = b.cp.map((v, i) => v - b.ce[i]);
    b.tPlan = sum(b.plan); b.tExe = sum(b.exe); b.delta = b.pbg - b.tPlan;
  }
  return { p, B };
}
function filtered() {
  const q = ui.q.toLowerCase();
  return PROGRAMS.filter(p => (ui.fund === 'ALL' || p.fund === ui.fund) &&
    (!q || (p.code + ' ' + p.name + ' ' + p.mdep + ' ' + p.sag).toLowerCase().includes(q)));
}
function portfolio(list) {
  const r = { pbg: 0, plan: z(), exe: z() };
  for (const p of list) { const b = prog(p.code).B[ui.block]; r.pbg += b.pbg; r.plan = add(r.plan, b.plan); r.exe = add(r.exe, b.exe); }
  return r;
}
function flags(code) {
  const { B } = prog(code); const out = [];
  B.ALL.plan.forEach((pl, i) => {
    const ex = B.ALL.exe[i];
    if (pl === 0 && ex > 0) out.push({ i, why: `Obligation ${fmt(ex)} against zero plan` });
    else if (pl > 0 && Math.abs(pl - ex) / pl > 0.05 && (ex > 0 || i <= curMonth()))
      out.push({ i, why: `Variance ${fmt(pl - ex)} (${pct((ex - pl) / pl)} vs plan)` });
  });
  return out;
}
function curMonth() { const d = new Date(); const m = (d.getFullYear() - 2026) * 12 + d.getMonth() - 9; return Math.max(-1, Math.min(11, m)); }

// ---------- render ----------
const app = document.getElementById('app');
const charts = [];
function render() {
  charts.splice(0).forEach(c => c.destroy());
  const list = filtered();
  if (!list.find(p => p.code === ui.code) && list.length) ui.code = list[0].code;
  const port = portfolio(list);
  const idx = QTR[ui.period];
  const kPlan = sum(idx.map(i => port.plan[i])), kExe = sum(idx.map(i => port.exe[i]));
  const annualPlan = sum(port.plan);
  app.innerHTML = `
  <header class="hdr"><div class="brand"><div class="logo">RPA</div><div>
    <h1>FY27 RPA Phase-plan Studio</h1><p>MIRC · Oct 2026 – Sep 2027 · ${PROGRAMS.length} programs · Grand PBG ${fmt(sum(PROGRAMS.map(p=>p.pbg)))}</p></div></div>
    <div class="hdr-actions"><button id="exp">Export JSON</button><label class="btn">Import<input type="file" id="imp" accept=".json" hidden></label><button id="csv">Export CSV</button><button id="reset" class="danger">Reset</button></div></header>
  <div class="disclaimer">Unofficial companion. Entries are a local, in-browser what-if only (saved in this browser's storage, never uploaded). <b>FY27_RPA_Phase_Plan.xlsx</b> remains the working record.</div>
  <section class="toolbar">
    <label>Fund<select id="fund">${['ALL','BASE','OOC','EDI'].map(f=>`<option ${f===ui.fund?'selected':''}>${f}</option>`).join('')}</select></label>
    <label class="grow">Search<input id="q" value="${esc(ui.q)}" placeholder="Program, MDEP, SAG…"></label>
    <label>Program<select id="code">${list.map(p=>`<option value="${p.code}" ${p.code===ui.code?'selected':''}>${p.code} — ${esc(p.name)}</option>`).join('')}</select></label>
    <div class="seg" id="block">${['HQ','UND','ALL'].map(b=>`<button data-v="${b}" class="${b===ui.block?'on':''}">${b==='UND'?'UNDISTRIBUTED':b}</button>`).join('')}</div>
    <div class="seg" id="period">${Object.keys(QTR).map(b=>`<button data-v="${b}" class="${b===ui.period?'on':''}">${b}</button>`).join('')}</div>
  </section>
  <section class="kpis">
    ${kpi('Authorized PBG', fmt(port.pbg), `${list.length} programs · ${ui.block==='UND'?'UNDISTRIBUTED':ui.block}`)}
    ${kpi('Annual plan', fmt(annualPlan), pct(annualPlan/port.pbg)+' of PBG')}
    ${kpi('PBG − plan', fmt(port.pbg-annualPlan), port.pbg-annualPlan===0?'Balanced':'Unphased balance', port.pbg-annualPlan!==0?'warn':'ok')}
    ${kpi('Obligations', fmt(kExe), ui.period)}
    ${kpi('Plan − obligations', fmt(kPlan-kExe), ui.period+' plan '+fmt(kPlan), Math.abs(kPlan-kExe)>0.05*kPlan?'warn':'')}
    ${kpi('Obl / plan', pct(kExe/kPlan), ui.period)}
  </section>
  <nav class="tabs">${[['plan','Phase plan'],['dash','Dashboard'],['obl','Obligations'],['imb','Imbalance analysis']].map(([k,l])=>`<button data-t="${k}" class="${ui.tab===k?'on':''}">${l}</button>`).join('')}</nav>
  <main id="body"></main>
  <footer>Unofficial · FY27 RPA Phase-plan Studio · Straight-line reference (8/17/25/…/100%) is for comparison only and never seeds the phase plan.</footer>`;
  const body = document.getElementById('body');
  if (ui.tab === 'plan') body.innerHTML = planView();
  if (ui.tab === 'dash') { body.innerHTML = dashView(); drawCharts(list); }
  if (ui.tab === 'obl') body.innerHTML = oblView(list);
  if (ui.tab === 'imb') body.innerHTML = imbView(list);
  wire();
}
const kpi = (l, v, s, c = '') => `<div class="kpi ${c}"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
const hl = i => QTR[ui.period].includes(i) && ui.period !== 'Annual' ? 'hl' : '';
const qt = a => ['Q1','Q2','Q3','Q4'].map(q => `<td class="q">${fmt(sum(QTR[q].map(i => a[i])))}</td>`).join('');
const row = (lbl, a, cls = '', extra = '') => `<tr class="${cls}"><th>${lbl}</th>${a.map((v,i)=>`<td class="${hl(i)} ${v<0?'neg':''}">${fmt(v)}</td>`).join('')}${qt(a)}<td class="tot">${fmt(sum(a))}</td>${extra}</tr>`;

function planView() {
  const { p, B } = prog(ui.code); const b = B[ui.block];
  const head = `<tr><th></th>${MONTHS.map((m,i)=>`<th class="${hl(i)}">${m}</th>`).join('')}<th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Total</th><th>PBG</th><th>DELTA</th></tr>`;
  const sysRows = p.systems.map(s => {
    if (ui.block === 'ALL') return row(`&nbsp;&nbsp;${s}`, add(S.phase[p.code].HQ[s], S.phase[p.code].UND[s]), 'sys', '<td></td><td></td>');
    const a = S.phase[p.code][ui.block][s];
    return `<tr class="sys"><th>&nbsp;&nbsp;${s}</th>${a.map((v,i)=>`<td class="in ${hl(i)}"><input data-k="phase" data-s="${s}" data-i="${i}" value="${v||''}" inputmode="decimal"></td>`).join('')}${qt(a)}<td class="tot">${fmt(sum(a))}</td><td></td><td></td></tr>`;
  }).join('');
  const oblRow = ui.block === 'HQ'
    ? `<tr class="sys"><th>Obligations (PM entry)</th>${S.obl[p.code].map((v,i)=>`<td class="in ${hl(i)}"><input data-k="obl" data-i="${i}" value="${v||''}" inputmode="decimal"></td>`).join('')}${qt(b.exe)}<td class="tot">${fmt(b.tExe)}</td><td></td><td></td></tr>` : '';
  const pbgCell = ui.block === 'UND'
    ? `<td class="in"><input data-k="undPbg" value="${S.undPbg[p.code]||''}" inputmode="decimal"></td>` : `<td class="pbg">${fmt(b.pbg)}</td>`;
  return `<div class="card"><div class="card-h"><div><h2>${p.code} — ${esc(p.name)}</h2>
    <p>MDEP ${p.mdep} · Fund ${p.fund} · SAG ${p.sag} · Block <b>${ui.block==='UND'?'UNDISTRIBUTED':ui.block}</b></p></div>
    <div class="chip ${b.delta===0?'ok':'warn'}">DELTA ${fmt(b.delta)}</div></div>
    <p class="hint">${ui.block==='ALL'?'ALL = HQ + UNDISTRIBUTED (read-only). Switch to HQ or UNDISTRIBUTED to enter.':'Yellow cells are PM entry. Program-level PBG sits on the MTH Plan rollup only — system rows never carry their own PBG or DELTA.'}
    ${ui.block==='UND'?' UNDISTRIBUTED execution is intentionally empty; enter the UNDISTRIBUTED share of PBG here (HQ PBG = program PBG − UNDISTRIBUTED).':''}</p>
    <div class="tw"><table><thead>${head}</thead><tbody>
    <tr class="roll"><th>MTH Plan (rollup)</th>${b.plan.map((v,i)=>`<td class="${hl(i)}">${fmt(v)}</td>`).join('')}${qt(b.plan)}<td class="tot">${fmt(b.tPlan)}</td>${pbgCell}<td class="${b.delta?'bad':'good'}">${fmt(b.delta)}</td></tr>
    ${sysRows}${oblRow}
    <tr class="sep"><th colspan="20">Summary</th></tr>
    ${row('MTH Plan', b.plan,'','<td></td><td></td>')}${row('MTH Execution', b.exe,'','<td></td><td></td>')}${row('MTH Variance', b.var,'var','<td></td><td></td>')}
    ${row('CML Plan', b.cp,'cml','<td></td><td></td>')}${row('CML Execution', b.ce,'cml','<td></td><td></td>')}${row('CML Variance', b.cv,'cml var','<td></td><td></td>')}
    <tr class="ref"><th>Straight-line ref (CML)</th>${SL.map((s,i)=>`<td class="${hl(i)}">${fmt(b.pbg*s/100)}</td>`).join('')}<td colspan="7"></td></tr>
    </tbody></table></div>
    <div class="totals"><div>PLAN TOTALS <b>${fmt(b.tPlan)}</b></div><div>PBG <b>${fmt(b.pbg)}</b></div><div>PBG DELTA <b class="${b.delta?'bad':'good'}">${fmt(b.delta)}</b></div><div>Obl / plan <b>${pct(b.tExe/b.tPlan)}</b></div></div></div>`;
}

function dashView() {
  return `<div class="grid2">
    <div class="card"><h3>Selected program · Monthly</h3><div class="ch"><canvas id="c1"></canvas></div><div id="s1" class="cs"></div></div>
    <div class="card"><h3>Selected program · Cumulative</h3><div class="ch"><canvas id="c2"></canvas></div><div id="s2" class="cs"></div></div>
    <div class="card"><h3>Portfolio (filtered) · Monthly</h3><div class="ch"><canvas id="c3"></canvas></div><div id="s3" class="cs"></div></div>
    <div class="card"><h3>Portfolio (filtered) · Cumulative</h3><div class="ch"><canvas id="c4"></canvas></div><div id="s4" class="cs"></div></div></div>`;
}
function drawCharts(list) {
  const b = prog(ui.code).B[ui.block], port = portfolio(list);
  const slC = pbg => SL.map(s => pbg * s / 100), slM = pbg => slC(pbg).map((v, i, a) => v - (i ? a[i - 1] : 0));
  const mk = (id, sid, pbgS, plan, exe) => {
    const delta = plan.map((v, i) => v - exe[i]);
    charts.push(new Chart(document.getElementById(id), {
      data: { labels: MONTHS, datasets: [
        { type: 'line', label: 'PBG (straight-line)', data: pbgS, fill: true, backgroundColor: 'rgba(148,163,184,.28)', borderColor: '#94a3b8', pointRadius: 0, tension: 0, order: 3 },
        { type: 'bar', label: 'Phased plan', data: plan, backgroundColor: '#1e3a8a', borderRadius: 4, order: 2 },
        { type: 'line', label: 'Obligations', data: exe, borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, order: 1 },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}`,
          footer: it => { const i = it[0].dataIndex; return `Delta (plan−obl): ${fmt(delta[i])}\nObl % of plan: ${pct(exe[i] / plan[i])}`; } } } },
        scales: { y: { ticks: { callback: v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1e3).toFixed(0) + 'K') } } } },
    }));
    const isC = id === 'c2' || id === 'c4';
    const tp = isC ? plan[11] : sum(plan), te = isC ? exe[11] : sum(exe);
    document.getElementById(sid).innerHTML = `<span>Plan <b>${fmt(tp)}</b></span><span>Obligations <b>${fmt(te)}</b></span><span>Delta <b>${fmt(tp - te)}</b></span><span>Obl % of plan <b>${pct(te / tp)}</b></span>`;
  };
  mk('c1', 's1', slM(b.pbg), b.plan, b.exe); mk('c2', 's2', slC(b.pbg), b.cp, b.ce);
  mk('c3', 's3', slM(port.pbg), port.plan, port.exe); mk('c4', 's4', slC(port.pbg), cum(port.plan), cum(port.exe));
}
function oblView(list) {
  return `<div class="card"><h2>Monthly obligations by program</h2><p class="hint">Yellow cells feed each program's HQ MTH Execution. UNDISTRIBUTED execution stays empty; ALL = HQ + UNDISTRIBUTED.</p>
  <div class="tw"><table><thead><tr><th>Program</th>${MONTHS.map(m=>`<th>${m}</th>`).join('')}<th>Total</th><th>Plan</th><th>Obl %</th></tr></thead><tbody>
  ${list.map(p => { const B = prog(p.code).B.ALL; return `<tr><th title="${esc(p.name)}">${p.code}</th>${S.obl[p.code].map((v,i)=>`<td class="in"><input data-k="obl" data-c="${p.code}" data-i="${i}" value="${v||''}" inputmode="decimal"></td>`).join('')}<td class="tot">${fmt(B.tExe)}</td><td>${fmt(B.tPlan)}</td><td>${pct(B.tExe/B.tPlan)}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
}
function imbView(list) {
  const rows = list.map(p => ({ p, B: prog(p.code).B.ALL, f: flags(p.code) }));
  const unbal = rows.filter(r => r.B.delta !== 0);
  return `<div class="card"><h2>PBG vs plan balance</h2><p class="hint">${unbal.length} of ${rows.length} programs have PBG − plan ≠ 0. Straight-line reference is never used to seed the phase plan.</p>
  <div class="tw"><table><thead><tr><th>Program</th><th>Fund</th><th>PBG</th><th>Plan</th><th>DELTA</th><th>% phased</th><th>Obligations</th><th>Obl/plan</th><th>Flags</th></tr></thead><tbody>
  ${rows.map(({p,B,f})=>`<tr><th>${p.code} <small>${esc(p.name)}</small></th><td>${p.fund}</td><td>${fmt(B.pbg)}</td><td>${fmt(B.tPlan)}</td><td class="${B.delta?'bad':'good'}">${fmt(B.delta)}</td><td><div class="bar"><i style="width:${Math.min(100,B.tPlan/B.pbg*100)}%"></i></div>${pct(B.tPlan/B.pbg)}</td><td>${fmt(B.tExe)}</td><td>${pct(B.tExe/B.tPlan)}</td><td>${f.length?`<span class="chip warn">${f.length}</span>`:''}</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="card"><h2>PM narrative prompts</h2><p class="hint">Required when monthly variance exceeds 5% of plan or an obligation posts against a zero-plan month.</p>
  ${rows.filter(r=>r.f.length).map(({p,f})=>`<div class="narr"><h4>${p.code} — ${esc(p.name)}</h4>${f.map(x=>`<label>${MONTHS[x.i]} · ${x.why}<textarea data-k="note" data-c="${p.code}" data-i="${x.i}" placeholder="Explain cause and get-well plan…">${esc(S.notes[p.code][x.i]||'')}</textarea></label>`).join('')}</div>`).join('') || '<p class="empty">No variances requiring narrative.</p>'}</div>`;
}

function wire() {
  const $ = id => document.getElementById(id);
  $('fund').onchange = e => { ui.fund = e.target.value; render(); };
  $('q').oninput = e => { ui.q = e.target.value; clearTimeout(wire.t); wire.t = setTimeout(() => { render(); const q = $('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  $('code').onchange = e => { ui.code = e.target.value; render(); };
  document.querySelectorAll('#block button').forEach(b => b.onclick = () => { ui.block = b.dataset.v; render(); });
  document.querySelectorAll('#period button').forEach(b => b.onclick = () => { ui.period = b.dataset.v; render(); });
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.t; render(); });
  document.querySelectorAll('input[data-k],textarea[data-k]').forEach(el => el.onchange = () => {
    const k = el.dataset.k, i = +el.dataset.i, c = el.dataset.c || ui.code;
    const v = k === 'note' ? el.value : (parseFloat(String(el.value).replace(/[$,]/g, '')) || 0);
    if (k === 'phase') S.phase[c][ui.block][el.dataset.s][i] = v;
    if (k === 'obl') S.obl[c][i] = v;
    if (k === 'undPbg') S.undPbg[c] = Math.max(0, Math.min(v, PROGRAMS.find(p => p.code === c).pbg));
    if (k === 'note') { S.notes[c][i] = v; save(); return; }
    save(); render();
  });
  $('exp').onclick = () => dl('fy27-rpa-studio.json', JSON.stringify(S, null, 1), 'application/json');
  $('imp').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); const b = blank(); for (const k of Object.keys(b)) Object.assign(b[k], d[k] || {}); S = b; save(); render(); } catch { alert('Invalid file'); } };
  $('csv').onclick = () => {
    const L = [['Program','Name','Fund','Block','Row',...MONTHS,'Total','PBG','DELTA'].join(',')];
    for (const p of PROGRAMS) { const { B } = prog(p.code); for (const k of ['HQ','UND','ALL']) {
      const b = B[k]; L.push([p.code, `"${p.name}"`, p.fund, k, 'MTH Plan', ...b.plan, b.tPlan, b.pbg, b.delta].join(','));
      L.push([p.code, `"${p.name}"`, p.fund, k, 'MTH Execution', ...b.exe, b.tExe, '', ''].join(',')); } }
    dl('fy27-rpa-studio.csv', L.join('\n'), 'text/csv');
  };
  $('reset').onclick = () => { if (confirm('Clear all local entries?')) { S = blank(); save(); render(); } };
}
function dl(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
render();
