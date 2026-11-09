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
