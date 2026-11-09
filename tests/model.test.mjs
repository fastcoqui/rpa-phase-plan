import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_STORAGE_KEY, STORAGE_KEY, appropriation, blankState, clearActiveEntries,
  commitAmount, fiscalThroughIndex, formatMoney, includedPrograms, legacyExclusion, loadState,
  migrateState, monthFigures, narrativeFlags, parseAmount, periodSum, programView, ratio,
  setDashboardIncluded, straightLineCumulative, straightLineMonthly, toCsv,
} from '../src/model.js';

const programs = [
  { code: 'AT', name: 'Annual Training', fund: 'BASE', sag: '1A', mdep: 'PRAT', pbg: 1200, systems: ['IPPS-A', 'DTS Travel'] },
  { code: 'BA', name: 'Battle Assembly', fund: 'BASE', sag: '1B', mdep: 'PRID', pbg: 800, systems: ['IPPS-A'] },
  { code: 'SUB', name: 'Subsistence', fund: 'BASE', sag: '1A', mdep: 'PRAT', pbg: 0, systems: ['GFEBS'] },
];

function months(...values) {
  const out = Array(12).fill(0);
  values.forEach((value, index) => { out[index] = value; });
  return out;
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

function v1Fixture() {
  return {
    phase: {
      AT: {
        HQ: { 'IPPS-A': months(100), 'DTS Travel': months(40), ALL: months(140) },
        UND: { 'IPPS-A': months(9), 'DTS Travel': months(8), ALL: months(17) },
      },
      BA: { HQ: { 'IPPS-A': months(25) }, UND: { 'IPPS-A': months(2) } },
    },
    obl: { AT: months(3, 4), BA: months(1) },
    undPbg: { AT: 50, BA: 0 },
    notes: { AT: { 0: 'because' } },
    extraNote: 'keep me',
  };
}

test('money, ratios, and fiscal month', () => {
  assert.equal(formatMoney(1200), '$1,200');
  assert.equal(formatMoney(-1200), '-$1,200');
  assert.equal(formatMoney(0), '$0');
  assert.equal(ratio(1, 0).text, 'N/A');
  assert.equal(ratio(0, 0).text, 'N/A');
  assert.equal(ratio(0, 100).text, '0.0%');
  assert.equal(ratio(1, 4).text, '25.0%');
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('1.'), null);
  assert.equal(parseAmount('$1,200'), 1200);
  assert.equal(commitAmount('1.'), 1);
  assert.equal(fiscalThroughIndex(new Date(2026, 10, 7)), 1);
  assert.equal(fiscalThroughIndex(new Date(2026, 9, 1)), 0);
  assert.equal(fiscalThroughIndex(new Date(2027, 8, 30)), 11);
  assert.equal(fiscalThroughIndex(new Date(2026, 7, 1)), 0);
  assert.equal(fiscalThroughIndex(new Date(2027, 9, 1)), 11);
});

test('v1 migration combines systems once and parks Undistributed', () => {
  const raw = v1Fixture();
  const state = migrateState(raw, programs);
  assert.equal(state.phase.AT[0], 140);
  assert.equal(state.phase.BA[0], 25);
  assert.deepEqual(state.phase.SUB, months());
  assert.equal(state.obl.AT[0], 3);
  assert.equal(state.obl.AT[1], 4);
  assert.equal(state.notes.AT[0], 'because');
  assert.equal(state.legacy.raw.extraNote, 'keep me');
  assert.equal(state.legacy.undPhase.AT['IPPS-A'][0], 9);
  assert.equal(state.legacy.undPhase.AT['DTS Travel'][0], 8);
  assert.equal(state.legacy.undPhase.AT.ALL, undefined);
  assert.equal(state.legacy.undPbg.AT, 50);
  assert.equal(state.legacy.undPbg.BA, undefined);
  raw.phase.AT.HQ['IPPS-A'][0] = 999;
  assert.equal(state.phase.AT[0], 140);
  assert.equal(state.legacy.raw.phase.AT.HQ['IPPS-A'][0], 100);
  const totals = appropriation(programs, state, 0);
  assert.equal(totals.pbg, 2000);
  assert.equal(totals.fullYearPhased, 165);
  assert.notEqual(totals.fullYearPhased, 165 + 19);
  assert.equal(totals.programs, 3);
  state.phase.AT[0] = 1;
  assert.equal(state.legacy.raw.phase.AT.HQ['IPPS-A'][0], 100);
  assert.equal(state.phase.BA[0], 25);

  const exclusion = legacyExclusion(state);
  assert.equal(exclusion.hasExcluded, true);
  assert.equal(exclusion.undPlan, 19);
  assert.equal(exclusion.undPbg, 50);
});

test('reloading v2 does not add v1 or Undistributed again', () => {
  const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1Fixture()) });
  const first = loadState(key => storage.getItem(key), programs);
  assert.equal(first.source, 'v1');
  assert.equal(first.state.phase.AT[0], 140);
  storage.setItem(STORAGE_KEY, JSON.stringify(first.state));
  const inflated = v1Fixture();
  inflated.phase.AT.HQ['IPPS-A'] = months(5000);
  inflated.phase.AT.UND['IPPS-A'] = months(8000);
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(inflated));
  const second = loadState(key => storage.getItem(key), programs);
  assert.equal(second.source, 'v2');
  assert.equal(second.state.phase.AT[0], 140);
  assert.equal(legacyExclusion(second.state).undPlan, 19);
  const roundTrip = migrateState(JSON.parse(JSON.stringify(second.state)), programs);
  assert.deepEqual(roundTrip.phase, second.state.phase);
  assert.equal(roundTrip.phase.AT[0], 140);
  assert.equal(legacyExclusion(roundTrip).undPlan, 19);
});

test('corrupt v2 falls through to v1 and a bad import does not look like a phase file', () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: '{oops',
    [LEGACY_STORAGE_KEY]: JSON.stringify(v1Fixture()),
  });
  const loaded = loadState(key => storage.getItem(key), programs);
  assert.equal(loaded.source, 'v1');
  assert.equal(loaded.state.phase.AT[0], 140);
  assert.throws(() => migrateState({ hello: 1 }, programs), /Unrecognized/);
  assert.equal(loadState(() => null, programs).source, 'blank');
});

test('split obligations become one execution total and a memo', () => {
  const raw = {
    phase: { AT: { HQ: { 'IPPS-A': months(10), 'DTS Travel': months(5) } } },
    obl: { AT: { 'IPPS-A': months(2), 'DTS Travel': months(3), ALL: months(5) } },
  };
  const state = migrateState(raw, programs);
  assert.equal(state.obl.AT[0], 5);
  assert.equal(state.oblProvenance.AT['IPPS-A'][0], 2);
  assert.equal(state.oblProvenance.AT['DTS Travel'][0], 3);
  assert.equal(state.oblProvenance.AT.ALL, undefined);
  assert.equal(programView(programs[0], state).exe[0], 5);
});

test('provenance is not added to execution or appropriation', () => {
  const state = blankState(programs);
  state.phase.AT = months(100, 50);
  state.phase.BA = months(10);
  state.obl.AT = months(40, 10);
  state.obl.BA = months(0, 5);
  state.oblProvenance.AT['IPPS-A'] = months(999);
  state.oblProvenance.AT['DTS Travel'] = months(999);
  const view = programView(programs[0], state);
  assert.equal(view.exe[0], 40);
  assert.equal(view.var[0], 60);
  assert.equal(view.actualMinusPlan[0], -60);
  assert.equal(view.tPlan, 150);
  assert.equal(view.delta, 1050);
  const throughNov = appropriation(programs, state, 1);
  assert.equal(throughNov.pbg, 2000);
  assert.equal(throughNov.cumPlan, 160);
  assert.equal(throughNov.cumObl, 55);
  assert.equal(throughNov.actualMinusPlan, -105);
  assert.equal(throughNov.execOfPlan.text, '34.4%');
  assert.equal(throughNov.execOfPbg.text, '2.8%');
  assert.equal(throughNov.fullYearPhased, 160);
  assert.equal(throughNov.unphased, 1840);
  const throughOct = appropriation(programs, state, 0);
  assert.equal(throughOct.cumPlan, 110);
  assert.equal(throughOct.cumObl, 40);
  assert.equal(throughOct.fullYearPhased, throughNov.fullYearPhased);
  assert.equal(appropriation([programs[0]], state, 1).cumPlan, 150);
  assert.notEqual(appropriation([programs[0]], state, 1).pbg, throughNov.pbg);
  const sub = appropriation([programs[2]], blankState(programs), 0);
  assert.equal(sub.execOfPlan.text, 'N/A');
  assert.equal(sub.execOfPbg.text, 'N/A');
});

test('direct and HQ rollup arrays are not added on top of system rows', () => {
  const combined = migrateState({ phase: { AT: months(70) }, obl: {} }, programs);
  assert.equal(combined.phase.AT[0], 70);
  const hqArray = migrateState({
    phase: { AT: { HQ: months(70), UND: { 'IPPS-A': months(5) } } },
    obl: {},
  }, programs);
  assert.equal(hqArray.phase.AT[0], 70);
  assert.equal(hqArray.legacy.undPhase.AT['IPPS-A'][0], 5);
  const leftover = migrateState({
    version: 2,
    phase: { AT: { HQ: { 'IPPS-A': months(10), 'DTS Travel': months(5) }, UND: { 'IPPS-A': months(100) } } },
    obl: { AT: months(1) },
    undPbg: { AT: 50 },
    legacy: null,
  }, programs);
  assert.equal(leftover.phase.AT[0], 15);
  assert.equal(leftover.obl.AT[0], 1);
  assert.equal(leftover.legacy.undPhase.AT['IPPS-A'][0], 100);
  assert.equal(leftover.legacy.undPbg.AT, 50);
  assert.equal(appropriation(programs, leftover, 0).pbg, 2000);
});

test('quarter rollups, narratives, csv, and reset keep the backup', () => {
  const state = blankState(programs);
  state.phase.AT = months(100, 100, 100, 100);
  state.obl.AT = months(0, 0, 50);
  assert.equal(periodSum(state.phase.AT, 'Q1'), 300);
  assert.equal(periodSum(state.phase.AT, 'Annual'), 400);
  assert.equal(programView(programs[0], state).cp[2], 300);
  const flags = narrativeFlags(programView(programs[0], state), 2);
  assert.ok(flags.some(flag => flag.i === 2));
  const futureOnly = narrativeFlags(programView(programs[0], state), 0);
  assert.equal(futureOnly.some(flag => flag.i === 3), false);
  const csv = toCsv(programs, state);
  const planRows = csv.split('\n').filter(line => line.includes(',MTH Plan,'));
  assert.equal(planRows.length, 3);
  assert.equal(csv.includes('EXCLUDED UNDISTRIBUTED'), false);
  assert.equal(csv.includes(',HQ,'), false);
  state.legacy = {
    role: 'migration-backup',
    excludedFromActiveTotals: true,
    undPhase: { AT: { 'IPPS-A': months(9) } },
    undPbg: { AT: 50 },
  };
  const withBackup = toCsv(programs, state);
  const marker = withBackup.split('\n').findIndex(line => line.startsWith('EXCLUDED UNDISTRIBUTED'));
  assert.ok(marker > 0);
  const activePlan = withBackup.split('\n').slice(0, marker).find(line => line.startsWith('AT,'));
  assert.match(activePlan, /^AT,.*,MTH Plan,100,/);
  assert.ok(withBackup.slice(withBackup.indexOf('EXCLUDED')).includes(',9,'));
  const cleared = clearActiveEntries(state, programs);
  assert.deepEqual(cleared.phase.AT, months());
  assert.equal(cleared.legacy.undPhase.AT['IPPS-A'][0], 9);
  assert.equal(legacyExclusion(cleared).hasExcluded, true);
  const blank = blankState(programs);
  assert.deepEqual(blank.phase.AT, months());
  assert.notDeepEqual(blank.phase.AT, straightLineMonthly(1200));
  blank.phase.AT[0] = 5;
  assert.equal(blank.phase.BA[0], 0);
});

test('selected-month figures use that month only', () => {
  const plan = months(1600000, 0, 0, 0, 400000);
  const obl = months(137244, 0, 0, 0, 0);
  const october = monthFigures(plan, obl, 0);
  assert.equal(october.plan, 1600000);
  assert.equal(october.obligations, 137244);
  assert.equal(october.actualMinusPlan, 137244 - 1600000);
  assert.equal(october.execOfPlan.text, '8.6%');
  const november = monthFigures(plan, obl, 1);
  assert.equal(november.plan, 0);
  assert.equal(november.obligations, 0);
  assert.equal(november.actualMinusPlan, 0);
  assert.equal(november.execOfPlan.text, 'N/A');
  const may = monthFigures(plan, obl, 4);
  assert.equal(may.plan, 400000);
  assert.equal(may.obligations, 0);
  assert.equal(may.execOfPlan.text, '0.0%');
  assert.notEqual(october.plan, plan.reduce((s, v) => s + v, 0));
});

test('saved v2 state loads unchanged', () => {
  const saved = {
    version: 2,
    phase: {
      AT: months(100.5, 40),
      BA: months(25),
      SUB: months(),
    },
    obl: {
      AT: months(10, 4),
      BA: months(1),
      SUB: months(),
    },
    oblProvenance: {
      AT: { 'IPPS-A': months(6), 'DTS Travel': months(4) },
    },
    notes: { AT: { 0: 'kept note' }, BA: {}, SUB: {} },
    legacy: {
      role: 'migration-backup',
      excludedFromActiveTotals: true,
      fromKey: 'fy27-rpa-studio-v1',
      undPhase: { AT: { 'IPPS-A': months(9), 'DTS Travel': months(8) } },
      undPbg: { AT: 50 },
      raw: { phase: { AT: { UND: { 'IPPS-A': [9] } } } },
    },
  };
  const loaded = loadState((key) => key === STORAGE_KEY ? JSON.stringify(saved) : null, programs);
  assert.equal(loaded.source, 'v2');
  assert.equal(STORAGE_KEY, 'fy27-rpa-studio-v2');
  assert.deepEqual(loaded.state.phase.AT, saved.phase.AT);
  assert.deepEqual(loaded.state.phase.BA, saved.phase.BA);
  assert.deepEqual(loaded.state.phase.SUB, saved.phase.SUB);
  assert.deepEqual(loaded.state.obl.AT, saved.obl.AT);
  assert.deepEqual(loaded.state.obl.BA, saved.obl.BA);
  assert.deepEqual(loaded.state.oblProvenance.AT['IPPS-A'], saved.oblProvenance.AT['IPPS-A']);
  assert.deepEqual(loaded.state.oblProvenance.AT['DTS Travel'], saved.oblProvenance.AT['DTS Travel']);
  assert.equal(loaded.state.notes.AT[0], 'kept note');
  assert.equal(loaded.state.legacy.undPhase.AT['IPPS-A'][0], 9);
  assert.equal(loaded.state.legacy.undPhase.AT['DTS Travel'][0], 8);
  assert.equal(loaded.state.legacy.undPbg.AT, 50);
  assert.equal(loaded.state.legacy.raw.phase.AT.UND['IPPS-A'][0], 9);
  assert.equal(programView(programs[0], loaded.state).exe[0], 10);
  assert.equal(programView(programs[0], loaded.state).plan[0], 100.5);
  assert.equal(Object.hasOwn(loaded.state, 'dashboardIncluded'), false);
  assert.deepEqual(includedPrograms(programs, loaded.state).map(program => program.code), ['AT', 'BA', 'SUB']);
  assert.equal(appropriation(includedPrograms(programs, loaded.state), loaded.state, 0).pbg, 2000);
});

test('dashboard inclusion filters totals and keeps every entered amount', () => {
  const state = blankState(programs);
  state.phase.AT = months(100, 50);
  const phaseRef = state.phase.AT;
  state.phase.BA = months(10, 10);
  state.phase.SUB = months(4);
  state.obl.AT = months(40, 10);
  state.obl.BA = months(0, 5);
  state.notes.AT[0] = 'kept note';
  state.legacy = {
    role: 'migration-backup',
    excludedFromActiveTotals: true,
    undPhase: { AT: { 'IPPS-A': months(9) } },
    undPbg: { AT: 50 },
  };
  const legacy = state.legacy;
  assert.equal(Object.hasOwn(state, 'dashboardIncluded'), false);
  assert.equal(includedPrograms(programs, state).length, 3);

  const savedWithoutField = JSON.parse(JSON.stringify(state));
  const legacyLoad = loadState(key => key === STORAGE_KEY ? JSON.stringify(savedWithoutField) : null, programs);
  assert.equal(legacyLoad.source, 'v2');
  assert.equal(Object.hasOwn(legacyLoad.state, 'dashboardIncluded'), false);
  assert.deepEqual(legacyLoad.state.phase.AT, months(100, 50));
  assert.deepEqual(legacyLoad.state.phase.BA, months(10, 10));
  assert.deepEqual(legacyLoad.state.obl.AT, months(40, 10));
  assert.deepEqual(legacyLoad.state.obl.BA, months(0, 5));
  assert.equal(legacyLoad.state.notes.AT[0], 'kept note');
  assert.equal(legacyLoad.state.legacy.undPbg.AT, 50);
  assert.equal(legacyLoad.state.legacy.undPhase.AT['IPPS-A'][0], 9);
  assert.equal(appropriation(includedPrograms(programs, legacyLoad.state), legacyLoad.state, 1).pbg, 2000);
  assert.equal(appropriation(includedPrograms(programs, legacyLoad.state), legacyLoad.state, 1).cumPlan, 174);

  setDashboardIncluded(state, programs, ['AT', 'NOPE', 'AT']);
  assert.equal(state.phase.AT, phaseRef);
  assert.deepEqual(state.phase.AT, months(100, 50));
  assert.deepEqual(state.dashboardIncluded, ['AT']);
  assert.equal(state.notes.AT[0], 'kept note');
  assert.equal(state.legacy, legacy);
  const onlyAT = appropriation(includedPrograms(programs, state), state, 1);
  assert.equal(onlyAT.programs, 1);
  assert.equal(onlyAT.pbg, 1200);
  assert.equal(onlyAT.plan[0], 100);
  assert.equal(onlyAT.plan[1], 50);
  assert.equal(onlyAT.cumPlan, 150);
  assert.equal(onlyAT.cumObl, 50);
  assert.equal(onlyAT.actualMinusPlan, -100);
  assert.equal(onlyAT.execOfPlan.text, '33.3%');
  assert.equal(onlyAT.execOfPbg.text, '4.2%');
  assert.equal(onlyAT.fullYearPhased, 150);
  assert.equal(onlyAT.unphased, 1050);
  assert.deepEqual(straightLineCumulative(onlyAT.pbg), straightLineCumulative(1200));
  assert.equal(straightLineCumulative(onlyAT.pbg)[11], 1200);
  assert.notEqual(onlyAT.pbg, appropriation(programs, state, 1).pbg);
  assert.equal(programView(programs[1], state).plan[0], 10);
  assert.equal(programView(programs[1], state).exe[1], 5);
  assert.equal(programView(programs[2], state).plan[0], 4);

  const roundTrip = loadState(key => key === STORAGE_KEY ? JSON.stringify(state) : null, programs);
  assert.deepEqual(roundTrip.state.dashboardIncluded, ['AT']);
  assert.deepEqual(roundTrip.state.phase.BA, months(10, 10));
  assert.deepEqual(roundTrip.state.obl.BA, months(0, 5));
  assert.equal(roundTrip.state.phase.SUB[0], 4);
  assert.equal(roundTrip.state.notes.AT[0], 'kept note');
  assert.equal(roundTrip.state.legacy.undPhase.AT['IPPS-A'][0], 9);

  setDashboardIncluded(state, programs, []);
  const none = appropriation(includedPrograms(programs, state), state, 1);
  assert.deepEqual(state.dashboardIncluded, []);
  assert.equal(none.programs, 0);
  assert.equal(none.pbg, 0);
  assert.equal(none.fullYearPhased, 0);
  assert.equal(none.fullYearObl, 0);
  assert.equal(none.unphased, 0);
  assert.equal(none.cumPlan, 0);
  assert.equal(none.cumObl, 0);
  assert.equal(none.actualMinusPlan, 0);
  assert.equal(none.execOfPlan.text, 'N/A');
  assert.equal(none.execOfPlan.value, null);
  assert.equal(none.execOfPbg.text, 'N/A');
  assert.equal(none.fullYearExecOfPlan.text, 'N/A');
  assert.equal(none.fullYearExecOfPbg.text, 'N/A');
  assert.equal(none.phasedOfPbg.text, 'N/A');
  assert.ok(none.plan.every(value => value === 0 && Number.isFinite(value)));
  assert.ok(none.cp.every(value => value === 0 && Number.isFinite(value)));
  assert.ok(straightLineCumulative(none.pbg).every(value => value === 0 && Number.isFinite(value)));
  assert.equal(Number.isFinite(none.actualMinusPlan), true);
  assert.deepEqual(state.phase.AT, months(100, 50));
  assert.deepEqual(state.obl.BA, months(0, 5));

  const cleared = clearActiveEntries(state, programs);
  assert.deepEqual(cleared.dashboardIncluded, []);
  assert.deepEqual(cleared.phase.AT, months());
  assert.equal(cleared.legacy.undPbg.AT, 50);
  assert.equal(state.phase.AT[0], 100);

  setDashboardIncluded(state, programs, programs.map(program => program.code));
  assert.equal(Object.hasOwn(state, 'dashboardIncluded'), false);
  assert.equal(includedPrograms(programs, state).length, 3);
  assert.deepEqual(state.phase.AT, months(100, 50));

  const malformed = migrateState({
    version: 2,
    phase: { AT: months(7), BA: months(3), SUB: months() },
    obl: { AT: months(2), BA: months(), SUB: months() },
    notes: { BA: { 1: 'still here' } },
    dashboardIncluded: { AT: false },
  }, programs);
  assert.equal(Object.hasOwn(malformed, 'dashboardIncluded'), false);
  assert.equal(includedPrograms(programs, malformed).length, 3);
  assert.equal(malformed.phase.AT[0], 7);
  assert.equal(malformed.phase.BA[0], 3);
  assert.equal(malformed.obl.AT[0], 2);
  assert.equal(malformed.notes.BA[1], 'still here');
  assert.equal(appropriation(includedPrograms(programs, malformed), malformed, 0).cumPlan, 10);
});
