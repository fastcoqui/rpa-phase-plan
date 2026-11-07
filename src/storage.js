// Prototype persistence for this browser profile only.
// Pass the page's localStorage in. Calculations stay in model.js.

import { LEGACY_STORAGE_KEY, STORAGE_KEY, loadState } from './model.js';

export function storageFacts() {
  return {
    mechanism: 'localStorage',
    indexedDB: false,
    cookies: false,
    server: false,
    autosave: 'as you type, and again when the tab is hidden or closed',
    key: STORAGE_KEY,
    legacyKey: LEGACY_STORAGE_KEY,
    transfer: 'Export JSON on the browser that has the entries, then Import that file on the other browser',
    csvImportable: false,
    importReplaces: true,
    crossDevice: false,
  };
}

export function createPrototypeStore(storage) {
  return {
    key: STORAGE_KEY,
    legacyKey: LEGACY_STORAGE_KEY,
    load(programs) {
      const read = (key) => {
        try { return storage.getItem(key); }
        catch { return null; }
      };
      return loadState(read, programs);
    },
    save(state) {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
  };
}
