// Read and write a Status of Funds workbook in the template shape.
// SheetJS runs in the browser. This module does not touch storage.

import * as XLSX from 'xlsx';
import { num } from './model.js';
import { layoutKeys, programMatchKey } from './sof.js';

const MONEY = '#,##0.00';
const PCT = '0.0%';
const DATE = 'yyyy-mm-dd';

const HEADERS = [
  'RPA', 'PM', 'SAG', 'MDEP / PROGRAM DESCRIPTION', '', '',
  'PBG', 'PLAN', 'ALLOTMENT', 'OBLIGATIONS', 'COMMITMENTS', 'TOTAL EXECUTION',
  'AVAILABLE PBG', 'AVAILABLE ALLOTMENT',
  '% OF\nOBLIGATION VS PLAN', '% OF\nOBLIGATION VS PBG', '% OF\nEXECUTION VS PBG',
  '', 'COMMENTS', '',
  'EOM JUL 80% Targets', 'Obligation to meet Target', '',
  '95% PLAN TARGET', 'VARIANCE',
];

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return cellText(value).toLowerCase();
}

export function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return '';
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

export function isoToExcelSerial(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function parseAsOf(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return cellText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return excelSerialToIso(value);
  const text = cellText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const serial = Number(text);
  if (text !== '' && Number.isFinite(serial) && serial > 20000 && serial < 80000) return excelSerialToIso(serial);
  return '';
}

function findAsOf(rows) {
  for (let r = 0; r < Math.min(rows.length, 8); r += 1) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      const text = norm(row[c]);
      if (text === 'as of:' || text === 'as of') {
        const next = parseAsOf(row[c + 1]);
        if (next) return next;
      }
      const inline = /^as of:?\s*(.+)$/i.exec(cellText(row[c]));
      if (inline) {
        const parsed = parseAsOf(inline[1]);
        if (parsed) return parsed;
      }
    }
  }
  return '';
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const headers = (rows[i] || []).map(norm);
    const pbg = headers.findIndex(h => h === 'pbg');
    const obl = headers.findIndex(h => h === 'obligations' || h === 'obligation');
    if (pbg >= 0 && obl >= 0) return { index: i, headers };
  }
  return null;
}

function columnMap(headers) {
  const find = (pred) => headers.findIndex(pred);
  const pbg = find(h => h === 'pbg');
  const plan = find(h => h === 'plan');
  const allotment = find(h => h.startsWith('allotment'));
  const obligations = find(h => h === 'obligations' || h === 'obligation');
  const commitments = find(h => h.startsWith('commitment'));
  const comments = find(h => h.startsWith('comment'));
  const pm = find(h => h === 'pm');
  const sag = find(h => h === 'sag');
  let mdep = find(h => h.includes('mdep'));
  let suffix = find(h => h === 'suffix' || h.startsWith('suffix'));
  let name = find(h => h === 'description' || h === 'program' || h === 'program description' || h === 'desc');
  if (mdep >= 0 && suffix < 0) suffix = mdep + 1;
  if (mdep >= 0 && name < 0) name = mdep + 2;
  if (mdep < 0 && pbg >= 3) {
    mdep = pbg - 3;
    suffix = pbg - 2;
    name = pbg - 1;
  }
  return { pm, sag, mdep, suffix, name, pbg, plan, allotment, obligations, commitments, comments };
}

function present(value) {
  return value != null && cellText(value) !== '';
}

export function parseSofRows(rows) {
  const matrix = Array.isArray(rows) ? rows : [];
  const header = findHeader(matrix);
  if (!header) throw new Error('That file does not match the Status of Funds template. Expected PBG and OBLIGATIONS columns.');
  const cols = columnMap(header.headers);
  const known = layoutKeys();
  const parsedRows = {};
  const extras = [];
  const warnings = [];
  let fund = 'BASE';
  for (let r = header.index + 1; r < matrix.length; r += 1) {
    const row = matrix[r] || [];
    const totalSource = norm(cols.pm >= 0 ? row[cols.pm] : '');
    if (totalSource === 'base total' || totalSource === 'ooc total' || totalSource === 'edi total' || totalSource === 'grand total') {
      if (totalSource === 'base total') fund = 'OOC';
      else if (totalSource === 'ooc total') fund = 'EDI';
      else if (totalSource === 'grand total') break;
      continue;
    }
    const mdep = cellText(cols.mdep >= 0 ? row[cols.mdep] : '').toUpperCase();
    const suffix = cellText(cols.suffix >= 0 ? row[cols.suffix] : '');
    const name = cellText(cols.name >= 0 ? row[cols.name] : '');
    if (!mdep && !name) continue;
    if (/total$/.test(norm(mdep)) || /total$/.test(norm(name))) continue;
    const key = programMatchKey(mdep, suffix);
    if (!key) continue;
    const record = {
      obligations: money(cols.obligations >= 0 ? row[cols.obligations] : 0),
      commitments: money(cols.commitments >= 0 ? row[cols.commitments] : 0),
      comments: cellText(cols.comments >= 0 ? row[cols.comments] : '').slice(0, 500),
      obligationsSet: true,
      pm: cellText(cols.pm >= 0 ? row[cols.pm] : ''),
      sag: cellText(cols.sag >= 0 ? row[cols.sag] : ''),
      mdep,
      suffix,
      name,
      fund,
    };
    if (present(row[cols.allotment])) record.allotment = money(row[cols.allotment]);
    if (present(row[cols.pbg])) record.pbg = money(row[cols.pbg]);
    if (present(row[cols.plan])) record.plan = money(row[cols.plan]);
    if (known.has(key)) {
      if (parsedRows[key]) warnings.push(`Duplicate row for ${key}; kept the first.`);
      else parsedRows[key] = record;
    } else {
      extras.push({ ...record, unmatched: true });
      warnings.push(`${key} (${name || 'no description'}) is not on the Status of Funds layout or the program list.`);
    }
  }
  if (!Object.keys(parsedRows).length && !extras.length) {
    throw new Error('That file has the Status of Funds headers but no program rows.');
  }
  return { asOf: findAsOf(matrix), rows: parsedRows, extras, warnings };
}

export function parseSofTable(input) {
  let workbook;
  if (typeof input === 'string') {
    const text = input.replace(/^\uFEFF/, '');
    workbook = XLSX.read(text, { type: 'string', cellDates: false, FS: text.includes('\t') ? '\t' : ',' });
  } else {
    workbook = XLSX.read(input, { type: 'array', cellDates: false });
  }
  const sheetName = workbook.SheetNames.find(name => name.toLowerCase().includes('status of funds')) || workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new Error('That file has no sheet to read.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  return parseSofRows(rows);
}

function colLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sumFormula(letter, rowNumbers) {
  const rows = (rowNumbers || []).filter(n => Number.isInteger(n)).sort((a, b) => a - b);
  if (!rows.length) return '0';
  const ranges = [];
  let start = rows[0];
  let prev = rows[0];
  for (let i = 1; i <= rows.length; i += 1) {
    const n = rows[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${letter}${start}` : `${letter}${start}:${letter}${prev}`);
    start = n;
    prev = n;
  }
  return `SUM(${ranges.join(',')})`;
}

function ref(letter, row) {
  return `${letter}${row}`;
}

export function buildSofSheet(table) {
  const aoa = [];
  const formulas = [];
  const merges = [{ s: { r: 1, c: 3 }, e: { r: 1, c: 5 } }];
  const asOf = Array(HEADERS.length).fill(null);
  asOf[15] = 'As of:';
  const serial = isoToExcelSerial(table?.asOf);
  if (serial != null) asOf[16] = serial;
  aoa.push(asOf);
  aoa.push(HEADERS.slice());
  if (serial != null) formulas.push({ r: 1, c: 16, v: serial, z: DATE, t: 'n' });

  const dataRows = { BASE: [], OOC: [], EDI: [] };
  const subtotalAt = {};
  let pending = null;

  const closeGroup = () => {
    if (!pending || pending.allotment == null) {
      pending = null;
      return;
    }
    formulas.push({
      r: pending.anchorRow,
      c: 13,
      f: `${ref('I', pending.anchorRow)}-SUM(${ref('J', pending.start)}:${ref('J', pending.end)})`,
      v: pending.available,
      z: MONEY,
    });
    pending = null;
  };

  const pushComputed = (excelRow) => {
    const r = excelRow;
    formulas.push({ r, c: 11, f: `${ref('J', r)}+${ref('K', r)}`, z: MONEY });
    formulas.push({ r, c: 12, f: `${ref('G', r)}-${ref('L', r)}`, z: MONEY });
    formulas.push({ r, c: 14, f: `IFERROR(${ref('J', r)}/${ref('H', r)},0)`, z: PCT });
    formulas.push({ r, c: 15, f: `IFERROR(${ref('J', r)}/${ref('G', r)},0)`, z: PCT });
    formulas.push({ r, c: 16, f: `IFERROR(${ref('L', r)}/${ref('G', r)},0)`, z: PCT });
    formulas.push({ r, c: 20, f: `${ref('G', r)}*0.8`, z: MONEY });
    formulas.push({ r, c: 21, f: `${ref('U', r)}-${ref('J', r)}`, z: MONEY });
    formulas.push({ r, c: 23, f: `${ref('H', r)}*0.95`, z: MONEY });
    formulas.push({ r, c: 24, f: `${ref('X', r)}-${ref('J', r)}`, z: MONEY });
  };

  for (const line of table?.lines || []) {
    if (line.kind === 'gap') {
      closeGroup();
      aoa.push(Array(HEADERS.length).fill(null));
      continue;
    }
    if (line.kind === 'subtotal') {
      closeGroup();
      const values = Array(HEADERS.length).fill(null);
      values[1] = line.label;
      values[6] = line.pbg;
      values[7] = line.plan;
      values[8] = line.allotment;
      values[9] = line.obligations;
      values[10] = line.commitments;
      values[11] = line.totalExecution;
      values[12] = line.availablePbg;
      values[13] = line.availableAllotment;
      values[14] = line.oblVsPlan.value || 0;
      values[15] = line.oblVsPbg.value || 0;
      values[16] = line.execVsPbg.value || 0;
      values[20] = line.julTarget;
      values[21] = line.obligationToJul;
      values[23] = line.plan95;
      values[24] = line.variance;
      aoa.push(values);
      const excelRow = aoa.length;
      merges.push({ s: { r: excelRow - 1, c: 1 }, e: { r: excelRow - 1, c: 5 } });
      subtotalAt[line.id] = excelRow;
      if (line.id === 'grand') {
        const parts = [subtotalAt.base, subtotalAt.ooc, subtotalAt.edi].filter(Boolean);
        const add = (c, letter, value, z) => formulas.push({
          r: excelRow, c, f: `SUM(${parts.map(row => ref(letter, row)).join(',')})`, v: value, z,
        });
        add(6, 'G', line.pbg, MONEY);
        add(7, 'H', line.plan, MONEY);
        add(8, 'I', line.allotment, MONEY);
        add(9, 'J', line.obligations, MONEY);
        add(10, 'K', line.commitments, MONEY);
        add(13, 'N', line.availableAllotment, MONEY);
        add(20, 'U', line.julTarget, MONEY);
        add(23, 'X', line.plan95, MONEY);
      } else {
        const rows = dataRows[line.id === 'base' ? 'BASE' : line.id === 'ooc' ? 'OOC' : 'EDI'] || [];
        const add = (c, letter, value, z) => formulas.push({
          r: excelRow, c, f: sumFormula(letter, rows), v: value, z,
        });
        add(6, 'G', line.pbg, MONEY);
        add(7, 'H', line.plan, MONEY);
        add(8, 'I', line.allotment, MONEY);
        add(9, 'J', line.obligations, MONEY);
        add(10, 'K', line.commitments, MONEY);
        add(13, 'N', line.availableAllotment, MONEY);
        add(20, 'U', line.julTarget, MONEY);
        add(23, 'X', line.plan95, MONEY);
      }
      pushComputed(excelRow);
      continue;
    }
    if (line.kind !== 'data') continue;
    if (!pending || pending.groupId !== line.groupId) {
      closeGroup();
      pending = {
        groupId: line.groupId,
        anchorRow: aoa.length + 1,
        start: aoa.length + 1,
        end: aoa.length + 1,
        allotment: line.allotment,
        available: line.availableAllotment,
      };
    } else {
      pending.end = aoa.length + 1;
    }
    const values = Array(HEADERS.length).fill(null);
    values[1] = line.pm;
    values[2] = line.sag;
    values[3] = line.mdep;
    values[4] = line.suffix || '';
    values[5] = line.unmatched ? `${line.name} (unmatched)` : line.name;
    values[6] = line.pbg;
    values[7] = line.plan;
    if (line.isAnchor && line.allotment != null) values[8] = line.allotment;
    values[9] = line.obligations;
    values[10] = line.commitments;
    values[11] = line.totalExecution;
    values[12] = line.availablePbg;
    if (line.isAnchor && line.availableAllotment != null) values[13] = line.availableAllotment;
    values[14] = line.oblVsPlan.value || 0;
    values[15] = line.oblVsPbg.value || 0;
    values[16] = line.execVsPbg.value || 0;
    values[18] = line.comments || '';
    values[20] = line.julTarget;
    values[21] = line.obligationToJul;
    values[23] = line.plan95;
    values[24] = line.variance;
    aoa.push(values);
    const excelRow = aoa.length;
    if (dataRows[line.fund]) dataRows[line.fund].push(excelRow);
    for (const col of [6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 23, 24]) {
      if (values[col] != null) formulas.push({ r: excelRow, c: col, v: values[col], z: MONEY, t: 'n' });
    }
    for (const col of [14, 15, 16]) {
      formulas.push({ r: excelRow, c: col, v: values[col] || 0, z: PCT, t: 'n' });
    }
    pushComputed(excelRow);
  }
  closeGroup();

  aoa.push(Array(HEADERS.length).fill(null));
  const baseRow = subtotalAt.base;
  for (const footer of table?.footer?.rows || []) {
    const values = Array(HEADERS.length).fill(null);
    values[7] = footer.label;
    values[8] = footer.target;
    values[9] = 'To Meet Target:';
    values[10] = footer.toMeet;
    if (footer.note) values[11] = footer.note;
    aoa.push(values);
    const excelRow = aoa.length;
    if (baseRow) {
      const factor = footer.label.startsWith('95%') ? 0.95 : footer.label.startsWith('105%') ? 1.05 : 1;
      const expr = factor === 1 ? ref('H', baseRow) : `${ref('H', baseRow)}*${factor}`;
      formulas.push({ r: excelRow, c: 8, f: expr, v: footer.target, z: MONEY });
      formulas.push({ r: excelRow, c: 10, f: `${ref('I', excelRow)}-${ref('J', baseRow)}`, v: footer.toMeet, z: MONEY });
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  for (const cell of formulas) {
    const address = colLetter(cell.c) + cell.r;
    const prior = sheet[address] || {};
    const next = { ...prior };
    if (cell.f) next.f = cell.f;
    if (cell.v != null) next.v = cell.v;
    if (cell.z) next.z = cell.z;
    if (cell.t) next.t = cell.t;
    else if (cell.f || typeof cell.v === 'number') next.t = 'n';
    sheet[address] = next;
  }
  sheet['!merges'] = merges;
  sheet['!cols'] = [
    { wch: 4 }, { wch: 14 }, { wch: 5 }, { wch: 8 }, { wch: 12 }, { wch: 48 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 15 }, { wch: 18 },
    { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 3 }, { wch: 28 }, { wch: 3 },
    { wch: 20 }, { wch: 24 }, { wch: 3 }, { wch: 18 }, { wch: 16 },
  ];
  return sheet;
}

export function sofToArrayBuffer(table) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSofSheet(table), 'RPA Status of Funds');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}
