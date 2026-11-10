// FY27 RPA calculations, migration, and CSV. No browser storage and no network.

export const MONTHS = ['Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27','Apr-27','May-27','Jun-27','Jul-27','Aug-27','Sep-27'];
export const MONTHS_LONG = ['October 2026','November 2026','December 2026','January 2027','February 2027','March 2027','April 2027','May 2027','June 2027','July 2027','August 2027','September 2027'];
export const SL = [8,17,25,33,42,50,58,67,75,83,92,100];
export const QTR = { Q1:[0,1,2], Q2:[3,4,5], Q3:[6,7,8], Q4:[9,10,11], Annual:[0,1,2,3,4,5,6,7,8,9,10,11] };

export const STORAGE_KEY = 'fy27-rpa-studio-v2';
export const LEGACY_STORAGE_KEY = 'fy27-rpa-studio-v1';

const ROLLUP_KEYS = new Set(['ALL','HQ','UND','UNDISTRIBUTED','TOTAL','ROLLUP','PLAN','EXE','EXECUTION','COMBINED','MTH','DELTA','PBG']);

export function emptyMonths() {
  return Array(12).fill(0);
}

export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value.trim().replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const t = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (t === '') return 0;
  if (t === '-' || t === '.' || t === '-.' || t.endsWith('.')) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function commitAmount(value) {
  const n = parseAmount(value);
  if (n != null) return n;
  const t = String(value ?? '').trim().replace(/[$,\s]/g, '');
  const n2 = Number(t);
  return Number.isFinite(n2) ? n2 : 0;
}

export function sum(values) {
  return (values || []).reduce((total, value) => total + num(value), 0);
}

export function cum(values) {
  let total = 0;
  return monthArray(values).map(value => (total += value));
}

export function formatMoney(value) {
  const n = num(value);
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

export function ratio(numerator, denominator) {
  const n = num(numerator);
  const d = num(denominator);
  if (!d) return { text: 'N/A', value: null, numerator: n, denominator: d };
  const value = n / d;
  return { text: (value * 100).toFixed(1) + '%', value, numerator: n, denominator: d };
}

export function clampMonth(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 11) return 11;
  return Math.floor(n);
}

export function fiscalThroughIndex(date) {
  const m = (date.getFullYear() - 2026) * 12 + date.getMonth() - 9;
  return clampMonth(m);
}

// ISO date (YYYY-MM-DD) → FY27 month. October 2026 is 0 and September 2027 is 11.
// Dates outside that year still resolve to the nearest end month and set outside.
export function fiscalMonthFromIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!match) return { index: null, outside: true, iso: '' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { index: null, outside: true, iso: '' };
  }
  const raw = (year - 2026) * 12 + (month - 1) - 9;
  return {
    index: clampMonth(raw),
    outside: raw < 0 || raw > 11,
    iso: `${match[1]}-${match[2]}-${match[3]}`,
  };
}

export function cumulativeThrough(values, index) {
  const end = clampMonth(index);
  const months = monthArray(values);
  let total = 0;
  for (let i = 0; i <= end; i += 1) total += months[i];
  return total;
}

// Dollars still needed to reach 95% of plan. Already at or above 95% reports required 0.
// A zero plan leaves the percent as N/A and treats 95% of zero as zero.
export function obligationCallout(plan, obligations) {
  const planned = num(plan);
  const actual = num(obligations);
  const percent = ratio(actual, planned);
  const target = planned * 0.95;
  const rawGap = target - actual;
  const met = rawGap <= 0.005;
  return {
    plan: planned,
    obligations: actual,
    percent,
    target,
    required: met ? 0 : rawGap,
    met,
  };
}

// One set of thresholds for % of plan. `percentValue` is the unrounded ratio (0.95 means 95%).
// Green: 95% through 105% inclusive. Amber: 90% up to 95%, or over 105% through 110%.
// Red: under 90%, or over 110%. Empty tone when the plan is zero.
// kind selects the callout sentence: short (still under 95%), met, over105, over110, or na.
export function executionBand(percentValue) {
  if (percentValue == null || !Number.isFinite(percentValue)) return { tone: '', kind: 'na' };
  if (percentValue >= 0.95 && percentValue <= 1.05) return { tone: 'ok', kind: 'met' };
  if (percentValue >= 0.9 && percentValue < 0.95) return { tone: 'mid', kind: 'short' };
  if (percentValue > 1.05 && percentValue <= 1.1) return { tone: 'mid', kind: 'over105' };
  if (percentValue > 1.1) return { tone: 'low', kind: 'over110' };
  return { tone: 'low', kind: 'short' };
}

export function planExecutionTone(percentValue) {
  return executionBand(percentValue).tone;
}

export function calloutLines(plan, obligations, options = {}) {
  const callout = obligationCallout(plan, obligations);
  const narrow = !!options.narrow;
  const band = executionBand(callout.percent.value);
  const line1 = `${formatMoney(callout.obligations)} (${callout.percent.text})`;
  const overAmount = callout.obligations - callout.plan;
  let line2 = 'N/A';
  if (band.kind === 'short') {
    line2 = `${formatMoney(callout.required)} (${narrow ? 'to 95% target' : 'required to meet 95% obligation target'})`;
  } else if (band.kind === 'met') {
    line2 = '95% target met';
  } else if (band.kind === 'over105') {
    line2 = `Over plan by ${formatMoney(overAmount)} (>105%)`;
  } else if (band.kind === 'over110') {
    line2 = `Over-executed by ${formatMoney(overAmount)} (${narrow ? '>110%' : '>110% of plan'})`;
  }
  return { ...callout, ...band, line1, line2, overAmount };
}

export function monthFigures(plan, obligations, index) {
  const i = clampMonth(index);
  const planned = monthArray(plan)[i];
  const actual = monthArray(obligations)[i];
  return {
    index: i,
    plan: planned,
    obligations: actual,
    actualMinusPlan: actual - planned,
    execOfPlan: ratio(actual, planned),
  };
}

export function periodSum(values, period) {
  const idx = QTR[period] || QTR.Annual;
  const months = monthArray(values);
  return sum(idx.map(i => months[i]));
}

export function straightLineCumulative(pbg) {
  const base = num(pbg);
  return SL.map(share => base * share / 100);
}

export function straightLineMonthly(pbg) {
  const cumulative = straightLineCumulative(pbg);
  return cumulative.map((value, index) => value - (index ? cumulative[index - 1] : 0));
}

export function sumPbg(programs) {
  return (programs || []).reduce((total, program) => total + num(program.pbg), 0);
}

export function deepCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function monthArray(value) {
  return monthArrayOrNull(value) || emptyMonths();
}

function monthArrayOrNull(value) {
  if (!Array.isArray(value)) return null;
  const out = emptyMonths();
  for (let i = 0; i < 12 && i < value.length; i += 1) out[i] = num(value[i]);
  return out;
}

function isRollupKey(key) {
  return ROLLUP_KEYS.has(String(key).trim().toUpperCase().replace(/\s+/g, ' '));
}

function collectSystemArrays(obj, program) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const seen = new Set();
  const parts = [];
  const keys = [...(program.systems || []), ...Object.keys(obj)];
  for (const key of keys) {
    if (seen.has(key) || isRollupKey(key)) continue;
    seen.add(key);
    const values = monthArrayOrNull(obj[key]);
    if (!values) continue;
    parts.push({ name: key, values });
  }
  return parts;
}

function sumParts(parts) {
  const out = emptyMonths();
  for (const part of parts) {
    for (let i = 0; i < 12; i += 1) out[i] += part.values[i];
  }
  return out;
}

function aggregatePhase(entry, program) {
  if (!entry) return { plan: emptyMonths(), undBySystem: {} };
  const direct = monthArrayOrNull(entry);
  if (direct) return { plan: direct, undBySystem: {} };

  const hq = entry.HQ ?? entry.hq ?? null;
  let plan = emptyMonths();
  if (Array.isArray(hq)) plan = monthArray(hq);
  else if (hq && typeof hq === 'object') {
    const parts = collectSystemArrays(hq, program);
    plan = parts.length ? sumParts(parts) : emptyMonths();
  } else if (typeof entry === 'object') {
    const flat = { ...entry };
    delete flat.UND;
    delete flat.UNDISTRIBUTED;
    delete flat.und;
    delete flat.HQ;
    delete flat.hq;
    const parts = collectSystemArrays(flat, program);
    plan = parts.length ? sumParts(parts) : emptyMonths();
  }

  const undNode = entry.UND ?? entry.UNDISTRIBUTED ?? entry.und ?? null;
  const undBySystem = {};
  if (Array.isArray(undNode)) undBySystem.UNDISTRIBUTED = monthArray(undNode);
  else if (undNode && typeof undNode === 'object') {
    for (const part of collectSystemArrays(undNode, program)) undBySystem[part.name] = part.values;
  }
  return { plan, undBySystem };
}

function readExecution(entry, program) {
  const direct = monthArrayOrNull(entry);
  if (direct) return { obl: direct, provenance: {} };
  const parts = collectSystemArrays(entry, program);
  if (parts.length) {
    return {
      obl: sumParts(parts),
      provenance: Object.fromEntries(parts.map(part => [part.name, part.values])),
    };
  }
  return { obl: emptyMonths(), provenance: {} };
}

function sanitizeNotes(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, text] of Object.entries(value)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > 11) continue;
    if (typeof text === 'string' && text) out[index] = text;
  }
  return out;
}

function blankProvenance(program) {
  const out = {};
  if ((program.systems || []).length > 1) {
    for (const system of program.systems) out[system] = emptyMonths();
  }
  return out;
}

export function blankState(programs) {
  const state = { version: 2, phase: {}, obl: {}, oblProvenance: {}, notes: {}, legacy: null };
  for (const program of programs || []) {
    state.phase[program.code] = emptyMonths();
    state.obl[program.code] = emptyMonths();
    state.oblProvenance[program.code] = blankProvenance(program);
    state.notes[program.code] = {};
  }
  return state;
}

function applyProvenance(target, program, explicit, fallback) {
  if ((program.systems || []).length < 2) {
    target.oblProvenance[program.code] = {};
    return;
  }
  const source = explicit && typeof explicit === 'object' ? explicit : fallback;
  const out = {};
  for (const system of program.systems) out[system] = monthArray(source?.[system]);
  target.oblProvenance[program.code] = out;
}

function backupShell(fromKey) {
  return {
    role: 'migration-backup',
    excludedFromActiveTotals: true,
    fromKey: fromKey || LEGACY_STORAGE_KEY,
    undPhase: {},
    undPbg: {},
  };
}

function mergeBackup(existing, foundPhase, foundPbg) {
  const backup = existing ? deepCopy(existing) : null;
  const hasFound = Object.keys(foundPhase).length > 0 || Object.keys(foundPbg).length > 0;
  if (!backup && !hasFound) return null;
  const next = backup || backupShell(LEGACY_STORAGE_KEY);
  next.role = next.role || 'migration-backup';
  next.excludedFromActiveTotals = true;
  next.undPhase = next.undPhase || {};
  next.undPbg = next.undPbg || {};
  for (const [code, systems] of Object.entries(foundPhase)) {
    if (!next.undPhase[code]) next.undPhase[code] = systems;
  }
  for (const [code, value] of Object.entries(foundPbg)) {
    if (next.undPbg[code] == null) next.undPbg[code] = value;
  }
  return next;
}

function normalizeV2(raw, programs) {
  const next = blankState(programs);
  const foundPhase = {};
  const foundPbg = {};
  for (const program of programs) {
    const phaseEntry = raw.phase?.[program.code];
    if (Array.isArray(phaseEntry)) next.phase[program.code] = monthArray(phaseEntry);
    else if (phaseEntry && typeof phaseEntry === 'object') {
      const aggregated = aggregatePhase(phaseEntry, program);
      next.phase[program.code] = aggregated.plan;
      if (Object.keys(aggregated.undBySystem).length) foundPhase[program.code] = aggregated.undBySystem;
    }
    const execution = readExecution(raw.obl?.[program.code], program);
    next.obl[program.code] = execution.obl;
    applyProvenance(next, program, raw.oblProvenance?.[program.code], execution.provenance);
    next.notes[program.code] = sanitizeNotes(raw.notes?.[program.code]);
  }
  if (raw.undPbg && typeof raw.undPbg === 'object') {
    for (const [code, value] of Object.entries(raw.undPbg)) {
      const amount = num(value);
      if (amount) foundPbg[code] = amount;
    }
  }
  next.legacy = mergeBackup(raw.legacy, foundPhase, foundPbg);
  if (Object.prototype.hasOwnProperty.call(raw, 'dashboardIncluded') && Array.isArray(raw.dashboardIncluded)) {
    setDashboardIncluded(next, programs, raw.dashboardIncluded);
  }
  const sof = normalizeSof(raw.sof);
  if (sof) next.sof = sof;
  return next;
}

function migrateV1(raw, programs) {
  const next = blankState(programs);
  const undPhase = {};
  const undPbg = {};
  for (const program of programs) {
    const aggregated = aggregatePhase(raw.phase?.[program.code], program);
    next.phase[program.code] = aggregated.plan;
    if (Object.keys(aggregated.undBySystem).length) undPhase[program.code] = aggregated.undBySystem;
    const tagged = num(raw.undPbg?.[program.code]);
    if (tagged) undPbg[program.code] = tagged;
    const execution = readExecution(raw.obl?.[program.code], program);
    next.obl[program.code] = execution.obl;
    applyProvenance(next, program, null, execution.provenance);
    next.notes[program.code] = sanitizeNotes(raw.notes?.[program.code]);
  }
  next.legacy = {
    ...backupShell(LEGACY_STORAGE_KEY),
    undPhase,
    undPbg,
    raw: deepCopy(raw),
  };
  return next;
}

export function migrateState(raw, programs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Unrecognized phase-plan file');
  }
  const version = raw.version === 2 || raw.version === '2';
  if (version) {
    if (!raw.phase || typeof raw.phase !== 'object') throw new Error('Unrecognized phase-plan file');
    return normalizeV2(raw, programs);
  }
  if (!raw.phase || typeof raw.phase !== 'object') throw new Error('Unrecognized phase-plan file');
  return migrateV1(raw, programs);
}

function parseStored(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function loadState(read, programs) {
  const v2 = parseStored(read(STORAGE_KEY));
  if (v2 && typeof v2 === 'object' && !Array.isArray(v2) && (v2.version === 2 || v2.version === '2') && v2.phase && typeof v2.phase === 'object') {
    return { state: normalizeV2(v2, programs), source: 'v2' };
  }
  const v1 = parseStored(read(LEGACY_STORAGE_KEY));
  if (v1 && typeof v1 === 'object' && !Array.isArray(v1) && v1.phase && typeof v1.phase === 'object') {
    return { state: migrateV1(v1, programs), source: 'v1' };
  }
  return { state: blankState(programs), source: 'blank' };
}

export function clearActiveEntries(state, programs) {
  const next = blankState(programs);
  next.legacy = state && state.legacy ? deepCopy(state.legacy) : null;
  if (Array.isArray(state?.dashboardIncluded)) {
    setDashboardIncluded(next, programs, state.dashboardIncluded);
  }
  return next;
}

// Programs whose phase and obligations feed the appropriation dashboard.
// `dashboardIncluded` is optional. When it is missing, or not an array, every
// program is included. An empty array includes none. Phase and obligation
// amounts are never read or written here.
export function includedPrograms(programs, state) {
  const list = programs || [];
  const raw = state?.dashboardIncluded;
  if (!Array.isArray(raw)) return list.slice();
  const wanted = new Set(raw.map(code => String(code)));
  return list.filter(program => wanted.has(program.code));
}

// Stores the dashboard selection on `state` without touching phase, obligations,
// notes, provenance, or the migration backup. Selecting every current program
// removes the field so an older save (no field) and "all included" stay the same.
export function setDashboardIncluded(state, programs, codes) {
  const list = programs || [];
  const wanted = new Set((codes || []).map(code => String(code)));
  const next = [];
  for (const program of list) {
    if (wanted.has(program.code)) next.push(program.code);
  }
  if (next.length === list.length) delete state.dashboardIncluded;
  else state.dashboardIncluded = next;
  return state;
}

export function programView(program, state) {
  const plan = monthArray(state?.phase?.[program.code]);
  const exe = monthArray(state?.obl?.[program.code]);
  const cp = cum(plan);
  const ce = cum(exe);
  const tPlan = sum(plan);
  const tExe = sum(exe);
  const pbg = num(program.pbg);
  return {
    plan,
    exe,
    var: plan.map((value, index) => value - exe[index]),
    actualMinusPlan: exe.map((value, index) => value - plan[index]),
    cp,
    ce,
    cv: cp.map((value, index) => value - ce[index]),
    cumActualMinusPlan: ce.map((value, index) => value - cp[index]),
    tPlan,
    tExe,
    pbg,
    delta: pbg - tPlan,
  };
}

export function appropriation(programs, state, throughIndex) {
  const plan = emptyMonths();
  const exe = emptyMonths();
  let pbg = 0;
  for (const program of programs || []) {
    pbg += num(program.pbg);
    const view = programView(program, state);
    for (let i = 0; i < 12; i += 1) {
      plan[i] += view.plan[i];
      exe[i] += view.exe[i];
    }
  }
  const cp = cum(plan);
  const ce = cum(exe);
  const through = clampMonth(throughIndex);
  const fullYearPhased = sum(plan);
  const fullYearObl = sum(exe);
  return {
    programs: (programs || []).length,
    pbg,
    plan,
    exe,
    cp,
    ce,
    fullYearPhased,
    fullYearObl,
    unphased: pbg - fullYearPhased,
    throughIndex: through,
    cumPlan: cp[through],
    cumObl: ce[through],
    actualMinusPlan: ce[through] - cp[through],
    execOfPlan: ratio(ce[through], cp[through]),
    execOfPbg: ratio(ce[through], pbg),
    fullYearExecOfPlan: ratio(fullYearObl, fullYearPhased),
    fullYearExecOfPbg: ratio(fullYearObl, pbg),
    phasedOfPbg: ratio(fullYearPhased, pbg),
  };
}

export function narrativeFlags(view, asOfIndex) {
  const asOf = clampMonth(asOfIndex);
  const out = [];
  view.plan.forEach((planned, index) => {
    const actual = view.exe[index];
    if (planned === 0 && actual > 0) {
      out.push({ i: index, why: `Obligation ${formatMoney(actual)} in a month with no plan` });
    } else if (planned > 0 && Math.abs(planned - actual) / planned > 0.05 && (actual > 0 || index <= asOf)) {
      out.push({
        i: index,
        why: `Actual − plan ${formatMoney(actual - planned)} (${ratio(actual - planned, planned).text} of that month's plan)`,
      });
    }
  });
  return out;
}

export function legacyExclusion(state) {
  const legacy = state?.legacy;
  if (!legacy) {
    return { hasExcluded: false, undPlan: 0, undPbg: 0, programsWithPlan: 0, programsWithPbg: 0 };
  }
  let undPlan = 0;
  let undPbg = 0;
  let programsWithPlan = 0;
  let programsWithPbg = 0;
  for (const systems of Object.values(legacy.undPhase || {})) {
    let programTotal = 0;
    if (Array.isArray(systems)) programTotal = sum(monthArray(systems));
    else if (systems && typeof systems === 'object') {
      for (const values of Object.values(systems)) programTotal += sum(monthArray(values));
    }
    if (programTotal) programsWithPlan += 1;
    undPlan += programTotal;
  }
  for (const value of Object.values(legacy.undPbg || {})) {
    const amount = num(value);
    if (amount) programsWithPbg += 1;
    undPbg += amount;
  }
  return {
    hasExcluded: undPlan !== 0 || undPbg !== 0,
    undPlan,
    undPbg,
    programsWithPlan,
    programsWithPbg,
  };
}

function obligationsWereSet(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.obligationsSet === true) return true;
  if (row.obligationsSet === false) return false;
  return Object.prototype.hasOwnProperty.call(row, 'obligations');
}

function normalizeSofRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const out = {
    obligations: num(row.obligations),
    commitments: num(row.commitments),
    comments: typeof row.comments === 'string' ? row.comments.slice(0, 500) : '',
    obligationsSet: obligationsWereSet(row),
  };
  if (row.allotment != null && row.allotment !== '') out.allotment = num(row.allotment);
  if (row.pbg != null && row.pbg !== '') out.pbg = num(row.pbg);
  if (row.plan != null && row.plan !== '') out.plan = num(row.plan);
  if (row.unmatched) out.unmatched = true;
  if (typeof row.mdep === 'string') out.mdep = row.mdep.slice(0, 40);
  if (typeof row.suffix === 'string') out.suffix = row.suffix.slice(0, 40);
  if (typeof row.name === 'string') out.name = row.name.slice(0, 160);
  if (typeof row.pm === 'string') out.pm = row.pm.slice(0, 40);
  if (typeof row.sag === 'string') out.sag = row.sag.slice(0, 20);
  if (typeof row.fund === 'string') out.fund = row.fund.slice(0, 12);
  return out;
}

function normalizeSofRows(rows) {
  const out = {};
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return out;
  for (const [key, row] of Object.entries(rows)) {
    const cleanKey = String(key).slice(0, 80);
    if (!cleanKey) continue;
    const next = normalizeSofRow(row);
    if (next) out[cleanKey] = next;
  }
  return out;
}

function normalizeSofExtras(extras) {
  if (!Array.isArray(extras)) return [];
  const out = [];
  for (const row of extras.slice(0, 80)) {
    const next = normalizeSofRow(row);
    if (!next) continue;
    next.unmatched = true;
    out.push(next);
  }
  return out;
}

function normalizeSofSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
  const out = {
    rows: normalizeSofRows(snap.rows),
    extras: normalizeSofExtras(snap.extras),
  };
  if (typeof snap.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snap.asOf)) out.asOf = snap.asOf;
  return out;
}

// Optional v2 field. Absent on older saves. Never required to read a phase plan.
export function normalizeSof(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const snapshots = {};
  if (raw.snapshots && typeof raw.snapshots === 'object' && !Array.isArray(raw.snapshots)) {
    for (const [key, snap] of Object.entries(raw.snapshots)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > 11) continue;
      const next = normalizeSofSnapshot(snap);
      if (next) snapshots[String(idx)] = next;
    }
  }
  const sof = {
    rows: normalizeSofRows(raw.rows),
    extras: normalizeSofExtras(raw.extras),
    snapshots,
  };
  if (typeof raw.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.asOf)) sof.asOf = raw.asOf;
  const has = sof.asOf || Object.keys(sof.rows).length || sof.extras.length || Object.keys(sof.snapshots).length;
  return has ? sof : null;
}

function ensureSof(state) {
  if (!state.sof || typeof state.sof !== 'object' || Array.isArray(state.sof)) {
    state.sof = { rows: {}, extras: [], snapshots: {} };
  }
  if (!state.sof.rows || typeof state.sof.rows !== 'object' || Array.isArray(state.sof.rows)) state.sof.rows = {};
  if (!Array.isArray(state.sof.extras)) state.sof.extras = [];
  if (!state.sof.snapshots || typeof state.sof.snapshots !== 'object' || Array.isArray(state.sof.snapshots)) {
    state.sof.snapshots = {};
  }
  return state.sof;
}

export function priorMonthsObligation(obligations, monthIndex) {
  const end = clampMonth(monthIndex);
  const months = monthArray(obligations);
  let total = 0;
  for (let i = 0; i < end; i += 1) total += months[i];
  return total;
}

// Monthly figure for the as-of month. Prior months do not include that month,
// so a later report for the same month replaces the figure instead of stacking.
export function deriveMonthlyFromCumulative(cumulative, priorMonths) {
  return num(cumulative) - num(priorMonths);
}

export function previewSofApply(programs, state, cumulativeByCode, monthIndex) {
  const month = clampMonth(monthIndex);
  const out = [];
  const codes = cumulativeByCode && typeof cumulativeByCode === 'object' ? Object.keys(cumulativeByCode) : [];
  for (const code of codes) {
    const program = (programs || []).find(item => item.code === code);
    if (!program) continue;
    const cumulative = num(cumulativeByCode[code]);
    const prior = priorMonthsObligation(state?.obl?.[code], month);
    const derived = deriveMonthlyFromCumulative(cumulative, prior);
    out.push({
      code,
      name: program.name,
      cumulative,
      prior,
      derived,
      deobligation: derived < -0.005,
    });
  }
  return out;
}

export function rederiveObligationsFromSnapshots(state, programs) {
  const snapshots = state?.sof?.snapshots || {};
  const codes = new Set();
  for (const snap of Object.values(snapshots)) {
    for (const [code, row] of Object.entries(snap?.rows || {})) {
      if (row?.obligationsSet === true && (programs || []).some(program => program.code === code)) codes.add(code);
    }
  }
  for (const code of codes) {
    if (!Array.isArray(state.obl[code])) state.obl[code] = emptyMonths();
    let running = 0;
    for (let month = 0; month < 12; month += 1) {
      const row = snapshots[String(month)]?.rows?.[code];
      if (row && row.obligationsSet === true) {
        const derived = deriveMonthlyFromCumulative(row.obligations, running);
        state.obl[code][month] = derived;
        running += derived;
      } else {
        running += num(state.obl[code][month]);
      }
    }
  }
  return state;
}

export function replaceSofWorking(state, parsed) {
  const sof = ensureSof(state);
  sof.rows = normalizeSofRows(parsed?.rows);
  sof.extras = normalizeSofExtras(parsed?.extras);
  if (typeof parsed?.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.asOf)) sof.asOf = parsed.asOf;
  return state;
}

// Stores the cumulative snapshot for the as-of month, then rewrites monthly
// obligations from every stored snapshot. Later months that have a snapshot
// are re-derived from the updated prior-month chain.
export function applySofMonth(state, programs, spec) {
  const month = clampMonth(spec?.monthIndex);
  const sof = ensureSof(state);
  const snapshot = {
    rows: normalizeSofRows(spec?.rows),
    extras: normalizeSofExtras(spec?.extras),
  };
  if (typeof spec?.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(spec.asOf)) snapshot.asOf = spec.asOf;
  sof.snapshots[String(month)] = snapshot;
  sof.rows = deepCopy(snapshot.rows);
  sof.extras = deepCopy(snapshot.extras);
  if (snapshot.asOf) sof.asOf = snapshot.asOf;
  rederiveObligationsFromSnapshots(state, programs);
  return state;
}

export function loadSofSnapshot(state, monthIndex) {
  const snap = state?.sof?.snapshots?.[String(clampMonth(monthIndex))];
  if (!snap) return false;
  const sof = ensureSof(state);
  sof.rows = deepCopy(snap.rows || {});
  sof.extras = deepCopy(snap.extras || []);
  if (snap.asOf) sof.asOf = snap.asOf;
  return true;
}

export function listSofSnapshots(state) {
  const snapshots = state?.sof?.snapshots || {};
  return Object.keys(snapshots)
    .map(key => Number(key))
    .filter(month => Number.isInteger(month) && month >= 0 && month <= 11 && snapshots[String(month)])
    .sort((a, b) => a - b)
    .map(month => {
      const snap = snapshots[String(month)];
      const programs = Object.values(snap.rows || {}).filter(row => row && row.obligationsSet === true).length;
      return { month, asOf: snap.asOf || '', programs };
    });
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text) || /^[=+\-@]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(programs, state) {
  const header = ['Program', 'Name', 'Fund', 'Row', ...MONTHS, 'Total', 'PBG', 'PBG minus plan'];
  const lines = [header.join(',')];
  const push = (program, row, values, total, pbg, balance) => {
    lines.push([
      program.code,
      csvCell(program.name),
      program.fund,
      csvCell(row),
      ...monthArray(values).map(value => String(Math.round(value))),
      String(Math.round(num(total))),
      pbg === '' ? '' : String(Math.round(num(pbg))),
      balance === '' ? '' : String(Math.round(num(balance))),
    ].join(','));
  };
  for (const program of programs || []) {
    const view = programView(program, state);
    push(program, 'MTH Plan', view.plan, view.tPlan, view.pbg, view.delta);
    push(program, 'MTH Execution', view.exe, view.tExe, '', '');
    push(program, 'MTH Variance (plan minus execution)', view.var, sum(view.var), '', '');
    push(program, 'CML Plan', view.cp, view.cp[11], '', '');
    push(program, 'CML Execution', view.ce, view.ce[11], '', '');
    push(program, 'CML Variance (plan minus execution)', view.cv, view.cv[11], '', '');
  }
  const exclusion = legacyExclusion(state);
  if (exclusion.hasExcluded && state.legacy) {
    lines.push('EXCLUDED UNDISTRIBUTED BACKUP (not included in totals above)');
    for (const [code, systems] of Object.entries(state.legacy.undPhase || {})) {
      const program = (programs || []).find(item => item.code === code);
      const name = program ? program.name : code;
      const fund = program ? program.fund : '';
      const entries = Array.isArray(systems) ? [['UNDISTRIBUTED', systems]] : Object.entries(systems || {});
      for (const [system, values] of entries) {
        const months = monthArray(values);
        lines.push([
          code,
          csvCell(name),
          fund,
          csvCell(`UNDISTRIBUTED plan excluded — ${system}`),
          ...months.map(value => String(Math.round(value))),
          String(Math.round(sum(months))),
          '',
          '',
        ].join(','));
      }
    }
    for (const [code, value] of Object.entries(state.legacy.undPbg || {})) {
      const program = (programs || []).find(item => item.code === code);
      lines.push([
        code,
        csvCell(program ? program.name : code),
        program ? program.fund : '',
        csvCell('UNDISTRIBUTED PBG tag excluded (not extra authority)'),
        ...Array(12).fill(''),
        '',
        String(Math.round(num(value))),
        '',
      ].join(','));
    }
  }
  return lines.join('\n');
}
