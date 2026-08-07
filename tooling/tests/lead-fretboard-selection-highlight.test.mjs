import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatefulFunction } from './extract.mjs';

function callWith(initialState){
  const { call } = extractStatefulFunction('getSelectedLeadNotes', { initialState, mockGlobals: {} });
  return call();
}

test('a single selected slot with a note returns that one note', () => {
  const result = callWith({
    leadGridSelectedSlot: 2,
    leadGridSelectionRange: null,
    leadGridSlots: [null, null, { stringIdx: 1, fret: 3 }, null],
  });
  assert.deepEqual(result, [{ stringIdx: 1, fret: 3 }]);
});

test('a selected slot with no note (empty) returns nothing', () => {
  const result = callWith({
    leadGridSelectedSlot: 2,
    leadGridSelectionRange: null,
    leadGridSlots: [null, null, null, null],
  });
  assert.deepEqual(result, []);
});

test('no selection at all returns nothing', () => {
  const result = callWith({
    leadGridSelectedSlot: null,
    leadGridSelectionRange: null,
    leadGridSlots: [{ stringIdx: 1, fret: 3 }],
  });
  assert.deepEqual(result, []);
});

test('a range selection returns every filled note within it, skipping empty slots', () => {
  const result = callWith({
    leadGridSelectedSlot: 0,
    leadGridSelectionRange: { start: 0, end: 3 },
    leadGridSlots: [
      { stringIdx: 1, fret: 3 },
      { stringIdx: 2, fret: 5 },
      null,
      { stringIdx: 0, fret: 2 },
    ],
  });
  assert.deepEqual(result, [
    { stringIdx: 1, fret: 3 },
    { stringIdx: 2, fret: 5 },
    { stringIdx: 0, fret: 2 },
  ]);
});

test('an active range takes priority over the single-slot fallback', () => {
  const result = callWith({
    leadGridSelectedSlot: 0,
    leadGridSelectionRange: { start: 1, end: 1 },
    leadGridSlots: [{ stringIdx: 5, fret: 5 }, { stringIdx: 1, fret: 1 }],
  });
  assert.deepEqual(result, [{ stringIdx: 1, fret: 1 }], 'should use the range (slot 1), not fall back to leadGridSelectedSlot (slot 0)');
});
