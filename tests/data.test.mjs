import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appropriation, blankState, includedPrograms, loadState, setDashboardIncluded, straightLineCumulative, straightLineMonthly, sumPbg, STORAGE_KEY } from '../src/model.js';

const programs = JSON.parse(fs.readFileSync(new URL('../src/data/programs.json', import.meta.url)));
const expected = [
  ['PRAT', 18750000, 'IPPS-A|DTS Travel'],
  ['PRAT_SUB', 0, 'GFEBS'],
  ['PRID_IDT-TRP', 1600000, 'DTS Travel'],
  ['PRID_SUB', 150000, 'GFEBS'],
  ['PRID_BA', 37262500, 'IPPS-A'],
  ['VMBH_FH', 197500, 'IPPS-A'],
  ['PRID_AABA', 0, 'IPPS-A'],
  ['TRIT_EBDL', 115192, 'IPPS-A'],
  ['TRCD_AFTP', 0, 'IPPS-A'],
  ['PRID_MDR', 134055, 'IPPS-A'],
  ['PRID_RMA', 267590, 'IPPS-A'],
  ['PRID_ATA', 11966, 'IPPS-A'],
  ['PRID_MAT', 0, 'IPPS-A'],
  ['TRIT', 8362000, 'IPPS-A|DTS Travel'],
  ['QSPV', 200000, 'IPPS-A|DTS Travel'],
  ['QSFP', 20000, 'IPPS-A|DTS Travel'],
  ['QACS', 110100, 'IPPS-A|DTS Travel'],
  ['AR1R', 50000, 'IPPS-A|DTS Travel'],
  ['GPCI', 1465000, 'IPPS-A|DTS Travel'],
  ['GPIR', 4750000, 'IPPS-A|DTS Travel'],
  ['GPIS', 1004000, 'IPPS-A|DTS Travel'],
  ['OISR', 599000, 'IPPS-A|DTS Travel'],
  ['PRSA', 2665000, 'IPPS-A|DTS Travel'],
  ['TDLP', 1450000, 'IPPS-A|DTS Travel'],
  ['TRCD', 1900000, 'IPPS-A|DTS Travel'],
  ['VTER', 62000, 'IPPS-A|DTS Travel'],
  ['TRCD_BBIR', 142800, 'IPPS-A|DTS Travel'],
  ['TRCD_BGMO', 70600, 'IPPS-A|DTS Travel'],
  ['TRCD_BHOA', 23500, 'IPPS-A|DTS Travel'],
  ['TRCD_BOSS', 13440, 'IPPS-A|DTS Travel'],
  ['TRCD_BEDI', 11200, 'IPPS-A|DTS Travel'],
];

test('catalog identities and PBG are unchanged and counted once', () => {
  assert.equal(programs.length, 31);
  assert.equal(new Set(programs.map(program => program.code)).size, 31);
  assert.deepEqual(programs.map(program => [program.code, program.pbg, program.systems.join('|')]), expected);
  assert.equal(sumPbg(programs), 81387443);
  for (const program of programs) {
    assert.equal(program.pbg, expected.find(row => row[0] === program.code)[1]);
    assert.ok(program.name && program.fund && program.mdep && program.sag);
    assert.ok(program.systems.length === 1 || program.systems.length === 2);
    if (program.systems.length === 2) assert.deepEqual(program.systems, ['IPPS-A', 'DTS Travel']);
  }
});

test('production blank state has no seeded phase dollars', () => {
  const state = blankState(programs);
  const metrics = appropriation(programs, state, 1);
  assert.equal(metrics.pbg, 81387443);
  assert.equal(metrics.programs, 31);
  assert.equal(metrics.fullYearPhased, 0);
  assert.equal(metrics.fullYearObl, 0);
  assert.equal(metrics.unphased, 81387443);
  assert.equal(metrics.cumPlan, 0);
  assert.equal(metrics.execOfPlan.text, 'N/A');
  assert.equal(metrics.execOfPbg.text, '0.0%');
  assert.equal(state.version, 2);
  assert.equal(state.legacy, null);
  assert.equal(Object.hasOwn(state, 'undPbg'), false);
  const reference = straightLineMonthly(81387443);
  assert.notEqual(reference[0], 0);
  for (const program of programs) {
    assert.deepEqual(state.phase[program.code], Array(12).fill(0));
    if (program.pbg > 0) assert.notDeepEqual(state.phase[program.code], straightLineMonthly(program.pbg));
  }
  assert.equal(Object.hasOwn(state, 'dashboardIncluded'), false);
  assert.equal(includedPrograms(programs, state).length, 31);
});

test('appropriation totals follow dashboardIncluded and keep excluded amounts', () => {
  const state = blankState(programs);
  const months = (novPlan, novObl) => {
    const plan = Array(12).fill(0);
    const obl = Array(12).fill(0);
    plan[1] = novPlan;
    obl[1] = novObl;
    return { plan, obl };
  };
  const prat = months(500000, 100000);
  const ba = months(800000, 200000);
  const trit = months(300000, 120000);
  const gpir = months(100000, 40000);
  state.phase.PRAT = prat.plan;
  state.obl.PRAT = prat.obl;
  state.phase.PRID_BA = ba.plan;
  state.obl.PRID_BA = ba.obl;
  state.phase.TRIT = trit.plan;
  state.obl.TRIT = trit.obl;
  state.phase.GPIR = gpir.plan;
  state.obl.GPIR = gpir.obl;
  state.notes.PRAT = { 1: 'do not drop' };
  state.legacy = { role: 'migration-backup', undPbg: { PRAT: 50 }, undPhase: { PRAT: { 'IPPS-A': [9] } } };

  const legacy = JSON.parse(JSON.stringify(state));
  delete legacy.dashboardIncluded;
  const loaded = loadState(key => key === STORAGE_KEY ? JSON.stringify(legacy) : null, programs);
  assert.equal(Object.hasOwn(loaded.state, 'dashboardIncluded'), false);
  assert.equal(loaded.state.phase.PRAT[1], 500000);
  assert.equal(loaded.state.obl.PRID_BA[1], 200000);
  assert.equal(loaded.state.notes.PRAT[1], 'do not drop');
  assert.equal(loaded.state.legacy.undPbg.PRAT, 50);
  const everyone = appropriation(includedPrograms(programs, loaded.state), loaded.state, 1);
  assert.equal(everyone.programs, 31);
  assert.equal(everyone.pbg, 81387443);
  assert.equal(everyone.cumPlan, 1700000);
  assert.equal(everyone.cumObl, 460000);
  assert.equal(straightLineCumulative(everyone.pbg)[11], 81387443);

  setDashboardIncluded(state, programs, programs.map(program => program.code).filter(code => !['PRAT', 'PRID_BA', 'TRIT'].includes(code)));
  assert.equal(state.dashboardIncluded.length, 28);
  assert.equal(state.dashboardIncluded.includes('PRAT'), false);
  assert.equal(state.dashboardIncluded.includes('GPIR'), true);
  assert.equal(state.phase.PRAT[1], 500000);
  assert.equal(state.obl.PRAT[1], 100000);
  assert.equal(state.phase.PRID_BA[1], 800000);
  assert.equal(state.notes.PRAT[1], 'do not drop');
  const filtered = appropriation(includedPrograms(programs, state), state, 1);
  assert.equal(filtered.programs, 28);
  assert.equal(filtered.pbg, 17012943);
  assert.equal(filtered.plan[1], 100000);
  assert.equal(filtered.exe[1], 40000);
  assert.equal(filtered.cumPlan, 100000);
  assert.equal(filtered.cumObl, 40000);
  assert.equal(filtered.execOfPlan.text, '40.0%');
  assert.equal(straightLineCumulative(filtered.pbg)[11], 17012943);
  assert.notEqual(filtered.pbg, 81387443);

  setDashboardIncluded(state, programs, []);
  const none = appropriation(includedPrograms(programs, state), state, 1);
  assert.equal(none.programs, 0);
  assert.equal(none.pbg, 0);
  assert.equal(none.execOfPlan.text, 'N/A');
  assert.equal(none.execOfPbg.text, 'N/A');
  assert.equal(state.phase.TRIT[1], 300000);
  assert.equal(state.obl.GPIR[1], 40000);
});
