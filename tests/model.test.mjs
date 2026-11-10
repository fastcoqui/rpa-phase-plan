import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_STORAGE_KEY, STORAGE_KEY, applySofMonth, appropriation, blankState, calloutLines,
  clearActiveEntries, commitAmount, deriveMonthlyFromCumulative, fiscalMonthFromIso, fiscalThroughIndex,
  formatMoney, includedPrograms, legacyExclusion, loadState, migrateState, monthFigures, narrativeFlags,
  executionBand, obligationCallout, parseAmount, periodSum, planExecutionTone, previewSofApply, priorMonthsObligation, programView, ratio,
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

test('95% obligation callout matches the worked example and the edge cases', () => {
  const worked = obligationCallout(5374900, 345122);
  assert.equal(worked.percent.text, '6.4%');
  assert.ok(Math.abs(worked.required - 4761033) < 0.01);
  assert.equal(worked.met, false);
  assert.equal(Math.abs((0.95 * 5374900) - 345122 - 4761033) < 0.01, true);
  const lines = calloutLines(5374900, 345122);
  assert.equal(lines.line1, '$345,122 (6.4%)');
  assert.equal(lines.tone, 'low');
  assert.equal(lines.kind, 'short');
  assert.equal(lines.line2, '$4,761,033 (required to meet 95% obligation target)');
  assert.equal(calloutLines(5374900, 345122, { narrow: true }).line2, '$4,761,033 (to 95% target)');

  const exact = obligationCallout(1000, 950);
  assert.equal(exact.met, true);
  assert.equal(exact.required, 0);
  assert.equal(calloutLines(1000, 950).line2, '95% target met');
  assert.equal(calloutLines(1000, 950).tone, 'ok');

  const over = obligationCallout(1000, 1200);
  assert.equal(over.met, true);
  assert.equal(over.required, 0);
  assert.equal(over.percent.text, '120.0%');
  assert.equal(calloutLines(1000, 1200).tone, 'low');
  assert.equal(calloutLines(1000, 1200).line2, 'Over-executed by $200 (>110% of plan)');

  const under = obligationCallout(1000, 949);
  assert.equal(under.met, false);
  assert.ok(Math.abs(under.required - 1) < 0.01);

  const zeroPlan = obligationCallout(0, 0);
  assert.equal(zeroPlan.percent.text, 'N/A');
  assert.equal(zeroPlan.met, true);
  assert.equal(calloutLines(0, 10).line1, '$10 (N/A)');
  assert.equal(calloutLines(0, 10).line2, 'N/A');
  assert.equal(calloutLines(0, 10).tone, '');
  assert.equal(calloutLines(0, 10).kind, 'na');
  assert.equal(obligationCallout(0, -25).met, false);
  assert.equal(obligationCallout(0, -25).required, 25);

  const state = blankState(programs);
  state.phase.AT = months(1000000, 5374900);
  state.obl.AT = months(800000, 345122);
  state.phase.BA = months(0, 100);
  state.obl.BA = months(0, 10);
  const all = appropriation(programs, state, 1);
  const allMonth = obligationCallout(all.plan[1], all.exe[1]);
  assert.equal(allMonth.obligations, 345132);
  assert.equal(all.cumPlan, 1000000 + 5374900 + 100);
  const allCum = obligationCallout(all.cp[1], all.ce[1]);
  assert.equal(allCum.obligations, 800000 + 345132);
  assert.notEqual(allCum.required, allMonth.required);

  setDashboardIncluded(state, programs, ['AT']);
  const filtered = appropriation(includedPrograms(programs, state), state, 1);
  const filteredCallout = calloutLines(filtered.plan[1], filtered.exe[1]);
  assert.equal(filteredCallout.line1, '$345,122 (6.4%)');
  assert.equal(filteredCallout.line2, '$4,761,033 (required to meet 95% obligation target)');
  const filteredCum = calloutLines(filtered.cp[1], filtered.ce[1]);
  assert.equal(filteredCum.obligations, 800000 + 345122);
  assert.notEqual(filteredCum.line1, filteredCallout.line1);
});

test('callout status follows the plan-percent bands, including 141.4%', () => {
  const plan = 100000;
  const at = (percent) => calloutLines(plan, plan * percent / 100);
  const expectBand = (percent, tone, kind) => {
    const band = executionBand(percent / 100);
    assert.equal(band.tone, tone, `${percent} tone`);
    assert.equal(band.kind, kind, `${percent} kind`);
    assert.equal(planExecutionTone(percent / 100), tone);
    assert.equal(at(percent).tone, tone);
    assert.equal(at(percent).kind, kind);
  };
  expectBand(89.99, 'low', 'short');
  expectBand(90, 'mid', 'short');
  expectBand(94.99, 'mid', 'short');
  expectBand(95, 'ok', 'met');
  expectBand(105, 'ok', 'met');
  expectBand(105.01, 'mid', 'over105');
  expectBand(110, 'mid', 'over105');
  expectBand(110.01, 'low', 'over110');
  expectBand(141.4, 'low', 'over110');

  assert.match(at(89.99).line2, /required to meet 95% obligation target/);
  assert.match(at(90).line2, /required to meet 95% obligation target/);
  assert.match(at(94.99).line2, /required to meet 95% obligation target/);
  assert.equal(at(95).line2, '95% target met');
  assert.equal(at(105).line2, '95% target met');
  assert.equal(at(105.01).line2, `Over plan by ${formatMoney(at(105.01).overAmount)} (>105%)`);
  assert.equal(at(110).line2, `Over plan by ${formatMoney(at(110).overAmount)} (>105%)`);
  assert.equal(at(110.01).line2, `Over-executed by ${formatMoney(at(110.01).overAmount)} (>110% of plan)`);
  assert.match(at(105.01).line2, /^Over plan by \$/);
  assert.match(at(110.01).line2, /^Over-executed by \$/);

  const reported = calloutLines(245000, 346414);
  assert.equal(reported.percent.text, '141.4%');
  assert.equal(reported.tone, 'low');
  assert.equal(reported.kind, 'over110');
  assert.equal(reported.line1, '$346,414 (141.4%)');
  assert.equal(reported.line2, 'Over-executed by $101,414 (>110% of plan)');
  assert.equal(reported.overAmount, 346414 - 245000);
  assert.notEqual(reported.line2, '95% target met');
});

test('plan percent colors use unrounded bands and flag over-execution', () => {
  const tone = (percent) => planExecutionTone(percent / 100);
  assert.equal(tone(89.9), 'low');
  assert.equal(tone(90), 'mid');
  assert.equal(tone(94.9), 'mid');
  assert.equal(tone(95), 'ok');
  assert.equal(tone(100), 'ok');
  assert.equal(tone(105), 'ok');
  assert.equal(tone(105.1), 'mid');
  assert.equal(tone(110), 'mid');
  assert.equal(tone(110.1), 'low');
  assert.equal(planExecutionTone(null), '');
  assert.equal(planExecutionTone(Number.NaN), '');
  assert.equal(planExecutionTone(0), 'low');
  // Display rounding must not move a value across a band.
  assert.equal((0.8996 * 100).toFixed(1), '90.0');
  assert.equal(planExecutionTone(0.8996), 'low');
  assert.equal((0.9496 * 100).toFixed(1), '95.0');
  assert.equal(planExecutionTone(0.9496), 'mid');
  assert.equal((1.0504 * 100).toFixed(1), '105.0');
  assert.equal(planExecutionTone(1.0504), 'mid');
  assert.equal((1.1004 * 100).toFixed(1), '110.0');
  assert.equal(planExecutionTone(1.1004), 'low');
});

test('cumulative SOF becomes the fiscal month and snapshots re-derive', () => {
  assert.equal(fiscalMonthFromIso('2026-10-01').index, 0);
  assert.equal(fiscalMonthFromIso('2026-10-01').outside, false);
  assert.equal(fiscalMonthFromIso('2026-11-10').index, 1);
  assert.equal(fiscalMonthFromIso('2027-09-30').index, 11);
  assert.equal(fiscalMonthFromIso('2026-09-30').outside, true);
  assert.equal(fiscalMonthFromIso('2026-09-30').index, 0);
  assert.equal(fiscalMonthFromIso('nope').index, null);

  const state = blankState(programs);
  state.obl.AT = months(100, 50, 9);
  state.obl.BA = months(5, 6, 7);
  assert.equal(priorMonthsObligation(state.obl.AT, 0), 0);
  assert.equal(deriveMonthlyFromCumulative(40, 0), 40);
  const october = previewSofApply(programs, state, { AT: 40 }, 0);
  assert.equal(october[0].prior, 0);
  assert.equal(october[0].derived, 40);
  assert.equal(october[0].deobligation, false);

  applySofMonth(state, programs, {
    monthIndex: 0,
    asOf: '2026-10-31',
    rows: { AT: { obligations: 100 } },
  });
  assert.equal(state.version, 2);
  assert.equal(STORAGE_KEY, 'fy27-rpa-studio-v2');
  assert.equal(state.obl.AT[0], 100);
  assert.equal(state.obl.AT[1], 50);
  assert.equal(state.obl.AT[2], 9);
  assert.deepEqual(state.obl.BA, months(5, 6, 7));

  const novemberPreview = previewSofApply(programs, state, { AT: 180 }, 1);
  assert.equal(novemberPreview[0].prior, 100);
  assert.equal(novemberPreview[0].derived, 80);
  assert.notEqual(novemberPreview[0].derived, 180 - 150);
  applySofMonth(state, programs, {
    monthIndex: 1,
    asOf: '2026-11-15',
    rows: { AT: { obligations: 180 } },
  });
  assert.equal(state.obl.AT[0], 100);
  assert.equal(state.obl.AT[1], 80);
  assert.equal(state.obl.AT[2], 9);

  applySofMonth(state, programs, {
    monthIndex: 1,
    asOf: '2026-11-20',
    rows: { AT: { obligations: 300 } },
  });
  assert.equal(state.obl.AT[1], 200);
  assert.equal(state.sof.snapshots['1'].asOf, '2026-11-20');
  assert.equal(state.sof.snapshots['1'].rows.AT.obligations, 300);
  assert.equal(state.sof.snapshots['0'].rows.AT.obligations, 100);
  assert.equal(state.obl.BA[1], 6);

  applySofMonth(state, programs, {
    monthIndex: 1,
    asOf: '2026-11-28',
    rows: { AT: { obligations: 250 } },
  });
  assert.equal(state.obl.AT[0], 100);
  assert.equal(state.obl.AT[1], 150);

  const decreased = previewSofApply(programs, state, { AT: 70 }, 1);
  assert.equal(decreased[0].derived, -30);
  assert.equal(decreased[0].deobligation, true);
  applySofMonth(state, programs, {
    monthIndex: 1,
    asOf: '2026-11-29',
    rows: { AT: { obligations: 70 } },
  });
  assert.equal(state.obl.AT[1], -30);

  applySofMonth(state, programs, {
    monthIndex: 0,
    asOf: '2026-10-31',
    rows: { AT: { obligations: 80 } },
  });
  assert.equal(state.obl.AT[0], 80);
  assert.equal(state.obl.AT[1], -10);
  assert.equal(state.obl.AT[2], 9);
  assert.equal(state.sof.snapshots['1'].rows.AT.obligations, 70);
  assert.deepEqual(state.obl.BA, months(5, 6, 7));

  const fresh = blankState(programs);
  fresh.obl.AT = months(0, 0, 9);
  applySofMonth(fresh, programs, { monthIndex: 0, asOf: '2026-10-05', rows: { AT: { obligations: 100 } } });
  applySofMonth(fresh, programs, { monthIndex: 1, asOf: '2026-11-05', rows: { AT: { obligations: 250 } } });
  assert.deepEqual(fresh.obl.AT.slice(0, 3), [100, 150, 9]);
  applySofMonth(fresh, programs, { monthIndex: 0, asOf: '2026-10-20', rows: { AT: { obligations: 80 } } });
  assert.deepEqual(fresh.obl.AT.slice(0, 3), [80, 170, 9]);

  const saved = JSON.parse(JSON.stringify(fresh));
  const loaded = loadState(key => key === STORAGE_KEY ? JSON.stringify(saved) : null, programs);
  assert.equal(loaded.state.version, 2);
  assert.equal(loaded.state.sof.asOf, '2026-10-20');
  assert.equal(loaded.state.sof.snapshots['1'].rows.AT.obligations, 250);
  assert.equal(loaded.state.obl.AT[1], 170);
  assert.equal(Object.hasOwn(blankState(programs), 'sof'), false);

  const cleared = clearActiveEntries(loaded.state, programs);
  assert.equal(Object.hasOwn(cleared, 'sof'), false);
  assert.deepEqual(cleared.obl.AT, months());
  assert.equal(formatMoney(4761033), '$4,761,033');
});
