import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

// Simple in-memory localStorage polyfill -- Node has no global
// localStorage, and these functions need a real one to exercise for
// real rather than mocking away the thing actually being tested.
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const loadSavedBin = extractFunction('loadSavedBin', { dependencies: `const SAVED_BIN_KEY = 'ftr-saved-bin-v1';` });
const writeSavedBin = extractFunction('writeSavedBin', { dependencies: `const SAVED_BIN_KEY = 'ftr-saved-bin-v1';` });
const sharedCrudDeps = `const SAVED_BIN_KEY = 'ftr-saved-bin-v1';
const loadSavedBin = ${loadSavedBin.toString()};
const writeSavedBin = ${writeSavedBin.toString()};`;
const addToSavedBin = extractFunction('addToSavedBin', { dependencies: sharedCrudDeps });
const removeFromSavedBin = extractFunction('removeFromSavedBin', { dependencies: sharedCrudDeps });
const renameSavedBinEntry = extractFunction('renameSavedBinEntry', { dependencies: sharedCrudDeps });

beforeEach(() => {
  for (const key in store) delete store[key];
});

test('loadSavedBin returns an empty array when nothing has been saved yet', () => {
  assert.deepEqual(loadSavedBin(), []);
});

test('addToSavedBin appends an entry and persists it', () => {
  addToSavedBin({ id: 'a', type: 'lead' });
  assert.deepEqual(loadSavedBin(), [{ id: 'a', type: 'lead' }]);
});

test('addToSavedBin preserves existing entries when adding another', () => {
  addToSavedBin({ id: 'a', type: 'lead' });
  addToSavedBin({ id: 'b', type: 'drum' });
  const bin = loadSavedBin();
  assert.equal(bin.length, 2);
  assert.ok(bin.some(e => e.id === 'a'));
  assert.ok(bin.some(e => e.id === 'b'));
});

test('removeFromSavedBin removes only the matching entry, leaving the rest untouched', () => {
  addToSavedBin({ id: 'a', type: 'lead' });
  addToSavedBin({ id: 'b', type: 'drum' });
  removeFromSavedBin('a');
  const bin = loadSavedBin();
  assert.equal(bin.length, 1);
  assert.equal(bin[0].id, 'b');
});

test('removeFromSavedBin on a nonexistent id is a safe no-op', () => {
  addToSavedBin({ id: 'a', type: 'lead' });
  removeFromSavedBin('does-not-exist');
  assert.equal(loadSavedBin().length, 1);
});

test('renameSavedBinEntry sets a custom name on the matching entry', () => {
  addToSavedBin({ id: 'a', type: 'lead', customName: null });
  renameSavedBinEntry('a', 'My Cool Lead');
  assert.equal(loadSavedBin()[0].customName, 'My Cool Lead');
});

test('renameSavedBinEntry with an empty string clears the custom name back to null (falls back to the default label)', () => {
  addToSavedBin({ id: 'a', type: 'lead', customName: 'Old Name' });
  renameSavedBinEntry('a', '');
  assert.equal(loadSavedBin()[0].customName, null);
});

test('loadSavedBin recovers gracefully from corrupted stored data instead of throwing', () => {
  globalThis.localStorage.setItem('ftr-saved-bin-v1', 'not valid json{{{');
  assert.deepEqual(loadSavedBin(), []);
});
