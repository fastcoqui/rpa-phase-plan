import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appropriation, blankState, straightLineMonthly, sumPbg } from '../src/model.js';

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
});
