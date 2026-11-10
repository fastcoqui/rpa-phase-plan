// Status of Funds layout and live figures. PLAN and PBG for a matched program
// come from the phase plan and the program catalog. Obligations on this sheet
// are cumulative fiscal-year-to-date and are not written here.

import {
  MONTHS_LONG, cumulativeThrough, fiscalMonthFromIso, num, planExecutionTone, ratio,
} from './model.js';

export function programMatchKey(mdep, suffix) {
  const m = String(mdep || '').trim().toUpperCase().replace(/\s+/g, '');
  let s = String(suffix || '').trim().toUpperCase().replace(/\s+/g, '');
  if (s === '-' || s === '—' || s === 'N/A' || s === 'NA' || s === 'NONE') s = '';
  if (s.startsWith('$')) s = s.slice(1);
  if (s && !s.startsWith('_')) s = `_${s}`;
  return `${m}${s}`;
}

function row(pm, sag, mdep, suffix, name) {
  return { pm, sag, mdep, suffix, name };
}

// Same row order and allotment groups as the RPA Status of Funds template.
// QAAP, ERPK, and FARC are on the template and are not programs in this app.
export const SOF_LAYOUT = [
  { type: 'group', id: 'base-1ab', fund: 'BASE', rows: [
    row('G3/5/7', '1A', 'PRAT', '', 'ANNUAL TRAINING'),
    row('G3/5/7', '1A', 'PRAT', '_SUB', 'ANNUAL TRAINING - Subsistence (_SUB)'),
    row('G1', '1B', 'PRID', '_IDT-TRP', 'IDT - Travel Reimbursement Program (_IDT-TRP)'),
    row('G1', '1B', 'PRID', '_SUB', 'IDT - Subsistence (_SUB)'),
    row('G1', '1B', 'PRID', '_BA', 'IDT - Battle Assembly (_BA)'),
    row('G1', '1B', 'VMBH', '_FH', 'ADA - Funeral Honors (_FH)'),
    row('G1', '1B', 'PRID', '_AABA', 'ADA - Additional Airborne Battle Assembly (_AABA)'),
    row('G1', '1B', 'TRIT', '_EBDL', 'ADA - Electronic Based Distance Learning (_EBDL)'),
    row('G1', '1B', 'TRCD', '_AFTP', 'ADA - Additional Flight Training Period (_AFTP)'),
    row('G1', '1B', 'PRID', '_MDR', 'ADA - Medical/Dental Readiness (_MDR)'),
    row('G1', '1B', 'PRID', '_RMA', 'ADA - Readiness Management Assembly (_RMA)'),
    row('G1', '1B', 'PRID', '_ATA', 'ADA - Additional Training Assembly (_ATA)'),
    row('G1', '1B', 'PRID', '_MAT', 'MATERNITY'),
  ] },
  { type: 'gap' },
  { type: 'group', id: 'base-1f', fund: 'BASE', rows: [
    row('G3/5/7', '1F', 'TRIT', '', 'SCHOOLS (MOSQ/ASI & PME)'),
  ] },
  { type: 'gap' },
  { type: 'group', id: 'base-1g', fund: 'BASE', rows: [
    row('G1', '1G', 'QAAP', '', 'SUBSTANCE ABUSE'),
    row('G1', '1G', 'QSPV', '', 'SUICIDE PREVENTION'),
    row('G1', '1G', 'QSFP', '', 'BUILDING STRONG & READY TEAMS'),
    row('G1', '1G', 'ERPK', '', 'IPPS-A'),
    row('G1', '1G', 'FARC', '', 'HOMETOWN RECRUITING'),
    row('G1', '1G', 'QACS', '', 'FAMILY PROGRAMS'),
    row('G3/5/7', '1G', 'AR1R', '', 'NET FIELDING/DISPLACED EQUIP TRNG'),
    row('G3/5/7', '1G', 'GPCI', '', 'CI/HUMINT'),
    row('G3/5/7', '1G', 'GPIR', '', 'FOUNDRY'),
    row('G3/5/7', '1G', 'GPIS', '', 'ISO'),
    row('G3/5/7', '1G', 'OISR', '', 'AISR/PED'),
    row('G3/5/7', '1G', 'PRSA', '', 'OPERATIONAL SUPPORT'),
    row('G3/5/7', '1G', 'TDLP', '', 'LANGUAGE'),
    row('G3/5/7', '1G', 'TRCD', '', 'OPERATIONAL/SUSTAINMENT TRNG'),
    row('G3/5/7', '1G', 'VTER', '', 'ANTI-TERRORISM TRNG'),
  ] },
  { type: 'subtotal', id: 'base', fund: 'BASE', label: 'BASE TOTAL' },
  { type: 'group', id: 'ooc', fund: 'OOC', rows: [
    row('G3/5/7', '1G', 'TRCD', '_BBIR', 'OOC - BOIR'),
    row('G3/5/7', '1G', 'TRCD', '_BGMO', 'OOC - BGMO'),
    row('G3/5/7', '1G', 'TRCD', '_BHOA', 'OOC - BHOA (HORN OF AFRICA)'),
    row('G3/5/7', '1G', 'TRCD', '_BOSS', 'OOC - BOSS (SPRATAN SHIELD)'),
  ] },
  { type: 'subtotal', id: 'ooc', fund: 'OOC', label: 'OOC TOTAL' },
  { type: 'group', id: 'edi', fund: 'EDI', rows: [
    row('G3/5/7', '1G', 'TRCD', '_BEDI', 'EDI - BEDI (EUR DET INIT)'),
  ] },
  { type: 'subtotal', id: 'edi', fund: 'EDI', label: 'EDI TOTAL' },
  { type: 'gap' },
  { type: 'subtotal', id: 'grand', fund: 'ALL', label: 'GRAND TOTAL' },
];

export function layoutKeys() {
  const keys = new Set();
  for (const block of SOF_LAYOUT) {
    if (block.type !== 'group') continue;
    for (const def of block.rows) keys.add(programMatchKey(def.mdep, def.suffix));
  }
  return keys;
}

export function formatSofMoney(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const cents = Math.round(Math.abs(n) * 100) / 100;
  const text = cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${text}`;
}

function indexPrograms(programs) {
  const byKey = new Map();
  for (const program of programs || []) {
    byKey.set(programMatchKey(program.mdep, program.dollar), program);
    if (program.code) byKey.set(String(program.code).trim().toUpperCase(), program);
  }
  return byKey;
}

function figureLine(spec) {
  const program = spec.program;
  const stored = spec.stored || {};
  const pbg = program ? num(program.pbg) : num(stored.pbg);
  const plan = program
    ? cumulativeThrough(spec.state?.phase?.[program.code], spec.monthIndex)
    : num(stored.plan);
  const obligations = num(stored.obligations);
  const commitments = num(stored.commitments);
  const totalExecution = obligations + commitments;
  const availablePbg = pbg - totalExecution;
  const allotment = spec.isAnchor ? spec.allotment : null;
  const availableAllotment = spec.isAnchor && allotment != null ? allotment - spec.groupObligations : null;
  const oblVsPlan = ratio(obligations, plan);
  const oblVsPbg = ratio(obligations, pbg);
  const execVsPbg = ratio(totalExecution, pbg);
  const julTarget = pbg * 0.8;
  const plan95 = plan * 0.95;
  return {
    kind: 'data',
    key: spec.key,
    fund: spec.fund,
    groupId: spec.groupId,
    isAnchor: spec.isAnchor,
    extra: !!spec.extra,
    extraIndex: spec.extraIndex,
    unmatched: !program,
    programCode: program ? program.code : '',
    pm: spec.pm || stored.pm || '',
    sag: spec.sag || stored.sag || '',
    mdep: spec.mdep || stored.mdep || '',
    suffix: spec.suffix || stored.suffix || '',
    name: spec.name || stored.name || spec.mdep || '',
    comments: typeof stored.comments === 'string' ? stored.comments : '',
    obligationsSet: stored.obligationsSet === true,
    pbg,
    plan,
    allotment,
    obligations,
    commitments,
    totalExecution,
    availablePbg,
    availableAllotment,
    oblVsPlan,
    oblVsPbg,
    execVsPbg,
    tone: planExecutionTone(oblVsPlan.value),
    julTarget,
    obligationToJul: julTarget - obligations,
    plan95,
    variance: plan95 - obligations,
  };
}

function buildGroup(block, stored, byKey, state, monthIndex) {
  const defs = block.rows.map(def => {
    const key = programMatchKey(def.mdep, def.suffix);
    return { def, key, program: byKey.get(key) || null, row: stored[key] || null };
  });
  let allotment = null;
  for (const item of defs) {
    if (item.row && item.row.allotment != null && item.row.allotment !== '') {
      allotment = num(item.row.allotment);
      break;
    }
  }
  const groupObl = defs.reduce((total, item) => total + num(item.row?.obligations), 0);
  return defs.map((item, index) => figureLine({
    key: item.key,
    fund: block.fund,
    groupId: block.id,
    isAnchor: index === 0,
    pm: item.def.pm,
    sag: item.def.sag,
    mdep: item.def.mdep,
    suffix: item.def.suffix,
    name: item.def.name,
    program: item.program,
    stored: item.row,
    allotment,
    groupObligations: groupObl,
    state,
    monthIndex,
    extra: false,
  }));
}

function buildExtra(extra, index) {
  const fund = extra?.fund === 'OOC' || extra?.fund === 'EDI' ? extra.fund : 'BASE';
  const allotment = extra?.allotment == null || extra.allotment === '' ? null : num(extra.allotment);
  return figureLine({
    key: `extra:${index}`,
    fund,
    groupId: `extra:${index}`,
    isAnchor: true,
    extra: true,
    extraIndex: index,
    pm: extra?.pm,
    sag: extra?.sag,
    mdep: extra?.mdep,
    suffix: extra?.suffix,
    name: extra?.name,
    program: null,
    stored: extra,
    allotment,
    groupObligations: num(extra?.obligations),
    state: null,
    monthIndex: 0,
  });
}

function subtotalLine(label, id, data) {
  const pbg = data.reduce((total, row) => total + num(row.pbg), 0);
  const plan = data.reduce((total, row) => total + num(row.plan), 0);
  const obligations = data.reduce((total, row) => total + num(row.obligations), 0);
  const commitments = data.reduce((total, row) => total + num(row.commitments), 0);
  const totalExecution = obligations + commitments;
  const availablePbg = pbg - totalExecution;
  let allotment = 0;
  let availableAllotment = 0;
  for (const row of data) {
    if (row.allotment != null) allotment += num(row.allotment);
    if (row.availableAllotment != null) availableAllotment += num(row.availableAllotment);
  }
  const oblVsPlan = ratio(obligations, plan);
  const julTarget = pbg * 0.8;
  const plan95 = plan * 0.95;
  return {
    kind: 'subtotal',
    id,
    label,
    pbg,
    plan,
    allotment,
    obligations,
    commitments,
    totalExecution,
    availablePbg,
    availableAllotment,
    oblVsPlan,
    oblVsPbg: ratio(obligations, pbg),
    execVsPbg: ratio(totalExecution, pbg),
    tone: planExecutionTone(oblVsPlan.value),
    julTarget,
    obligationToJul: julTarget - obligations,
    plan95,
    variance: plan95 - obligations,
  };
}

function baseFooter(base) {
  const plan = base ? num(base.plan) : 0;
  const obligations = base ? num(base.obligations) : 0;
  const make = (label, factor, note) => {
    const target = plan * factor;
    return { label, target, toMeet: target - obligations, note };
  };
  return {
    rows: [
      make('95% Target:', 0.95, ''),
      make('100% Target:', 1, ''),
      make('105% Target:', 1.05, '(Do not exceed this amount)'),
    ],
  };
}

export function buildSofTable(programs, state, asOfIso) {
  const fiscal = fiscalMonthFromIso(asOfIso || state?.sof?.asOf || '');
  const monthIndex = fiscal.index == null ? 0 : fiscal.index;
  const stored = state?.sof?.rows && typeof state.sof.rows === 'object' ? state.sof.rows : {};
  const extras = Array.isArray(state?.sof?.extras) ? state.sof.extras : [];
  const byKey = indexPrograms(programs);
  const lines = [];
  const dataByFund = { BASE: [], OOC: [], EDI: [] };
  const extraLines = { BASE: [], OOC: [], EDI: [] };
  extras.forEach((extra, index) => {
    const line = buildExtra(extra, index);
    extraLines[line.fund].push(line);
  });

  for (const block of SOF_LAYOUT) {
    if (block.type === 'gap') {
      lines.push({ kind: 'gap' });
      continue;
    }
    if (block.type === 'group') {
      const groupLines = buildGroup(block, stored, byKey, state, monthIndex);
      dataByFund[block.fund].push(...groupLines);
      lines.push(...groupLines);
      continue;
    }
    if (block.id === 'grand') {
      const data = ['BASE', 'OOC', 'EDI'].flatMap(fund => dataByFund[fund].concat(extraLines[fund]));
      lines.push(subtotalLine('GRAND TOTAL', 'grand', data));
      continue;
    }
    const fundData = dataByFund[block.fund].concat(extraLines[block.fund]);
    lines.push(...extraLines[block.fund]);
    lines.push(subtotalLine(block.label, block.id, fundData));
  }

  const base = lines.find(line => line.kind === 'subtotal' && line.id === 'base') || null;
  return {
    asOf: fiscal.iso,
    monthIndex,
    outside: fiscal.index == null ? true : fiscal.outside,
    monthLabel: MONTHS_LONG[monthIndex],
    lines,
    footer: baseFooter(base),
  };
}
