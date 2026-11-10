import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blankState, replaceSofWorking } from '../src/model.js';
import { SOF_LAYOUT, buildSofTable, layoutKeys, programMatchKey } from '../src/sof.js';
import { excelSerialToIso, isoToExcelSerial, parseSofTable, sofToArrayBuffer } from '../src/sof-io.js';

const programs = JSON.parse(fs.readFileSync(new URL('../src/data/programs.json', import.meta.url)));
const fixture = fs.readFileSync(new URL('./fixtures/RPA_Status_of_Funds_template.xlsx', import.meta.url));

function line(table, key) {
  return table.lines.find(item => item.kind === 'data' && item.key === key);
}

test('layout matches every program by MDEP and suffix and keeps template-only rows', () => {
  const keys = layoutKeys();
  assert.equal(keys.size, 34);
  for (const program of programs) {
    assert.equal(programMatchKey(program.mdep, program.dollar), program.code);
    assert.equal(keys.has(program.code), true);
  }
  const onlyOnTemplate = [...keys].filter(key => !programs.some(program => program.code === key)).sort();
  assert.deepEqual(onlyOnTemplate, ['ERPK', 'FARC', 'QAAP']);
  const groups = SOF_LAYOUT.filter(block => block.type === 'group').map(block => block.id);
  assert.deepEqual(groups, ['base-1ab', 'base-1f', 'base-1g', 'ooc', 'edi']);
});

test('template import keeps unmatched rows and uses phase-plan PLAN', () => {
  assert.equal(excelSerialToIso(46336), '2026-11-10');
  assert.equal(isoToExcelSerial('2026-11-10'), 46336);
  const parsed = parseSofTable(fixture);
  assert.equal(parsed.asOf, '2026-11-10');
  assert.equal(parsed.extras.length, 0);
  assert.equal(parsed.rows.PRID_BA.obligationsSet, true);
  assert.ok(Math.abs(parsed.rows.PRID_BA.obligations - 1494899.43) < 0.001);
  assert.equal(parsed.rows.PRAT.allotment, 10473816);
  assert.equal(parsed.rows.QAAP.obligationsSet, true);
  assert.match(parsed.rows.TRCD_BBIR.comments, /PowerBI/);

  const state = blankState(programs);
  replaceSofWorking(state, parsed);
  assert.equal(state.sof.snapshots['1'], undefined);
  const table = buildSofTable(programs, state, parsed.asOf);
  assert.equal(table.monthIndex, 1);
  assert.equal(table.outside, false);
  const prat = line(table, 'PRAT');
  assert.equal(prat.programCode, 'PRAT');
  assert.equal(prat.unmatched, false);
  assert.equal(prat.pbg, 18750000);
  assert.equal(prat.plan, 0);
  assert.ok(Math.abs(prat.obligations - 490141.01) < 0.001);
  const qaap = line(table, 'QAAP');
  assert.equal(qaap.unmatched, true);
  assert.equal(qaap.programCode, '');
  assert.equal(qaap.name, 'SUBSTANCE ABUSE');
  for (const key of ['ERPK', 'FARC']) assert.equal(line(table, key).unmatched, true);

  const group = table.lines.filter(item => item.groupId === 'base-1ab');
  const groupObl = group.reduce((total, item) => total + item.obligations, 0);
  assert.equal(group[0].isAnchor, true);
  assert.equal(group[0].allotment, 10473816);
  assert.equal(group[1].allotment, null);
  assert.ok(Math.abs(group[0].availableAllotment - (10473816 - groupObl)) < 0.02);
  assert.equal(group[0].totalExecution, group[0].obligations + group[0].commitments);
  assert.equal(group[0].availablePbg, group[0].pbg - group[0].totalExecution);

  const base = table.lines.find(item => item.id === 'base');
  const ooc = table.lines.find(item => item.id === 'ooc');
  const edi = table.lines.find(item => item.id === 'edi');
  const grand = table.lines.find(item => item.id === 'grand');
  assert.equal(grand.pbg, 81387443);
  assert.equal(base.pbg + ooc.pbg + edi.pbg, grand.pbg);
  assert.equal(base.pbg, 81125903);
  assert.ok(Math.abs(base.obligations - 3658568.24) < 0.05);
  assert.equal(grand.obligations, base.obligations + ooc.obligations + edi.obligations);
  assert.equal(table.footer.rows[2].note, '(Do not exceed this amount)');
  assert.equal(table.footer.rows[0].target, 0);
  assert.ok(Math.abs(table.footer.rows[0].toMeet + base.obligations) < 0.02);
  assert.ok(Math.abs(table.footer.rows[2].target - base.plan * 1.05) < 0.001);
  assert.equal(table.footer.rows[1].label, '100% Target:');

  state.phase.PRAT[0] = 1000;
  state.phase.PRAT[1] = 500;
  state.phase.PRAT[2] = 9000;
  const november = buildSofTable(programs, state, '2026-11-10');
  assert.equal(line(november, 'PRAT').plan, 1500);
  assert.equal(line(buildSofTable(programs, state, '2026-10-15'), 'PRAT').plan, 1000);
  const basePlan = november.lines.find(item => item.id === 'base');
  assert.equal(basePlan.plan, 1500);
  assert.ok(Math.abs(november.footer.rows[0].target - 1425) < 0.001);
  assert.equal(november.footer.rows[1].target, 1500);
  assert.ok(Math.abs(november.footer.rows[2].target - 1575) < 0.001);
  assert.ok(Math.abs(november.footer.rows[0].toMeet - (1425 - basePlan.obligations)) < 0.02);
  assert.equal(line(november, 'PRAT').plan95, 1425);
  assert.equal(buildSofTable(programs, state, '2026-08-01').outside, true);

  const exported = sofToArrayBuffer(november);
  const again = parseSofTable(exported);
  assert.equal(again.asOf, '2026-11-10');
  assert.ok(Math.abs(again.rows.PRID_BA.obligations - parsed.rows.PRID_BA.obligations) < 0.001);
  assert.equal(again.rows.PRAT.allotment, parsed.rows.PRAT.allotment);
  assert.equal(again.rows.QAAP.mdep, 'QAAP');
  assert.equal(again.extras.length, 0);
});

test('pasted rows and unknown MDEP stay flagged instead of being dropped', () => {
  const csv = [
    'PM,SAG,MDEP,SUFFIX,DESCRIPTION,PBG,PLAN,ALLOTMENT,OBLIGATIONS,COMMITMENTS,COMMENTS',
    'G1,1B,PRID,_BA,IDT - Battle Assembly (_BA),1,2,100,40,5,kept',
    'G1,1G,ZZZZ,,UNKNOWN PROGRAM,9,8,3,7,1,extra row',
  ].join('\n');
  const parsed = parseSofTable(csv);
  assert.equal(parsed.rows.PRID_BA.obligations, 40);
  assert.equal(parsed.rows.PRID_BA.commitments, 5);
  assert.equal(parsed.rows.PRID_BA.comments, 'kept');
  assert.equal(parsed.extras.length, 1);
  assert.equal(parsed.extras[0].mdep, 'ZZZZ');
  assert.equal(parsed.extras[0].unmatched, true);
  const state = blankState(programs);
  state.phase.PRID_BA = [10, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  replaceSofWorking(state, { ...parsed, asOf: '2026-11-01' });
  const table = buildSofTable(programs, state, '2026-11-01');
  const ba = line(table, 'PRID_BA');
  assert.equal(ba.plan, 30);
  assert.equal(ba.pbg, 37262500);
  assert.equal(ba.obligations, 40);
  assert.equal(ba.commitments, 5);
  assert.equal(ba.totalExecution, 45);
  assert.equal(ba.comments, 'kept');
  const extra = table.lines.find(item => item.extra);
  assert.equal(extra.unmatched, true);
  assert.equal(extra.mdep, 'ZZZZ');
  assert.equal(extra.obligations, 7);
  assert.equal(extra.pbg, 9);
  assert.equal(extra.plan, 8);
  assert.equal(extra.allotment, 3);
  assert.equal(extra.availableAllotment, 3 - 7);
  const base = table.lines.find(item => item.id === 'base');
  assert.equal(base.obligations >= 40 + 7, true);
});
