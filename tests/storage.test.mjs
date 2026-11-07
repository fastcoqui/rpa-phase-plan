import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEGACY_STORAGE_KEY, STORAGE_KEY, blankState } from '../src/model.js';
import { createPrototypeStore, storageFacts } from '../src/storage.js';

const programs = [
  { code: 'AT', name: 'Annual Training', fund: 'BASE', pbg: 1200, systems: ['IPPS-A', 'DTS Travel'] },
];

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  let removals = 0;
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => { removals += 1; map.delete(key); },
    removals: () => removals,
    keys: () => [...map.keys()],
  };
}

test('prototype store writes only the v2 key and leaves v1 in place', () => {
  const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: '{"phase":{"AT":{"HQ":{}}}}' });
  const store = createPrototypeStore(storage);
  assert.equal(store.key, STORAGE_KEY);
  assert.equal(store.legacyKey, LEGACY_STORAGE_KEY);
  store.save(blankState(programs));
  assert.equal(storage.removals(), 0);
  assert.equal(storage.keys().includes(STORAGE_KEY), true);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), '{"phase":{"AT":{"HQ":{}}}}');
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.phase.AT, Array(12).fill(0));
  const facts = storageFacts();
  assert.equal(facts.mechanism, 'localStorage');
  assert.equal(facts.indexedDB, false);
  assert.equal(facts.server, false);
  assert.equal(facts.crossDevice, false);
  assert.equal(facts.csvImportable, false);
  assert.equal(facts.key, STORAGE_KEY);
});

test('calculation module stays free of browser storage and platform clients', () => {
  const model = fs.readFileSync(new URL('../src/model.js', import.meta.url), 'utf8');
  const storage = fs.readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(/localStorage|indexedDB|fetch\(|vantage|programs\.json/i.test(model), false);
  assert.equal(/indexedDB\s*\.|fetch\(|vantage|chart\.js|programs\.json/i.test(storage), false);
  assert.equal(/indexedDB\s*\./.test(main), false);
  assert.equal(/fetch\s*\(/.test(main), false);
  assert.equal(main.includes('IndexedDB: unused'), true);
  assert.equal(main.includes('does not connect to Army Vantage'), true);
  assert.equal(main.includes('does not claim Army Vantage compatibility'), true);
  assert.equal(main.includes('LEGACY_STORAGE_KEY'), true);
  assert.equal(main.includes('FACTS.key'), true);
  assert.equal(readme.includes(STORAGE_KEY), true);
  assert.equal(readme.includes(LEGACY_STORAGE_KEY), true);
  assert.equal(readme.includes('localStorage'), true);
  assert.equal(readme.includes('IndexedDB'), true);
  assert.equal(readme.includes('does not connect to Army Vantage'), true);
  assert.equal(readme.includes('does not claim Army Vantage compatibility'), true);
  assert.equal(/Vantage-compatible|ready for Army Vantage/i.test(readme), false);
});
