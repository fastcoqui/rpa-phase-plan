import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL('../src/data/programs.json', import.meta.url)));
const t = d.reduce((s, p) => s + p.pbg, 0);
if (d.length !== 31 || t !== 81387443) { console.error('FAIL', d.length, t); process.exit(1); }
console.log('OK', d.length, 'programs, PBG', t);
