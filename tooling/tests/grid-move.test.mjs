import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatefulFunction } from './extract.mjs';

const DRUM_SOUNDS_LEN = 10;
const DRUM_TOTAL_SLOTS = 16;
function emptyDrumGrid() {
  return Array(DRUM_TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS_LEN).fill(false));
}
const drumMockGlobals = {
  DRUM_SOUNDS: JSON.stringify(Array(DRUM_SOUNDS_LEN).fill('x')),
  DRUM_GRID_TOTAL_SLOTS: DRUM_TOTAL_SLOTS,
  window: '{ alert: (msg) => { throw new Error("ALERT: " + msg); } }',
};

test('performDrumMove: single-cell move swaps with the destination, never silently losing what was there', () => {
  const grid = emptyDrumGrid();
  grid[2][0] = true; // kick: col 2, row 0
  grid[5][3] = true; // openHat: col 5, row 3 (the destination)

  const { call, getState } = extractStatefulFunction('performDrumMove', {
    initialState: {
      drumDragSourceCell: { row: 0, col: 2 },
      drumSelection: { rowStart: 0, rowEnd: 0, colStart: 2, colEnd: 2 },
      drumSelectionAnchor: { row: 0, col: 2 },
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...drumMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(3, 5, false); // move to row 3, col 5 -- both row and column change
  const { capturedGridUpdate } = getState();
  // the swap exchanges the two cells' boolean values directly -- a hit's
  // "identity" (which sound) comes from whichever row it ends up on, so
  // moving to a different row genuinely reassigns it to that sound
  assert.equal(capturedGridUpdate[5][3], true, 'the moved hit should now be active at the destination col/row');
  assert.equal(capturedGridUpdate[2][0], true, 'the destinations previous content should have swapped back to the source col/row, not been lost');
});

test('performDrumMove: multi-cell range move shifts the whole block together, clearing the source', () => {
  const grid = emptyDrumGrid();
  grid[0][0] = true; // kick at col 0
  grid[1][2] = true; // closedHat at col 1

  const { call, getState } = extractStatefulFunction('performDrumMove', {
    initialState: {
      drumDragSourceCell: { row: 0, col: 0 }, // drag started at the range's own top-left
      drumSelection: { rowStart: 0, rowEnd: 9, colStart: 0, colEnd: 1 },
      drumSelectionAnchor: { row: 0, col: 0 },
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...drumMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(0, 4, false); // drop at col 4 -- whole 2-col block should shift by +4
  const { capturedGridUpdate } = getState();
  assert.equal(capturedGridUpdate[4][0], true, 'kick should have moved to col 4');
  assert.equal(capturedGridUpdate[5][2], true, 'closedHat should have moved to col 5');
  assert.equal(capturedGridUpdate[0][0], false, 'original col 0 should be cleared');
  assert.equal(capturedGridUpdate[1][2], false, 'original col 1 should be cleared');
});

test('performDrumMove: refuses (alerts) rather than silently failing when the destination has no room', () => {
  const grid = emptyDrumGrid();
  const { call } = extractStatefulFunction('performDrumMove', {
    initialState: {
      drumDragSourceCell: { row: 0, col: 14 },
      drumSelection: { rowStart: 0, rowEnd: 0, colStart: 14, colEnd: 15 }, // 2-wide, already near the edge
      drumSelectionAnchor: { row: 0, col: 14 },
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...drumMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  assert.throws(() => call(0, 15, false), /ALERT: Not enough room/); // would push past column 15
});

test('performDrumMove: dropping on a locked cell is a no-op', () => {
  const grid = emptyDrumGrid();
  grid[2][0] = true;
  const { call, getState } = extractStatefulFunction('performDrumMove', {
    initialState: {
      drumDragSourceCell: { row: 0, col: 2 },
      drumSelection: { rowStart: 0, rowEnd: 0, colStart: 2, colEnd: 2 },
      drumSelectionAnchor: { row: 0, col: 2 },
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...drumMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(0, 10, true); // isLocked = true
  const { capturedGridUpdate } = getState();
  assert.equal(capturedGridUpdate, null, 'nothing should have been written -- the move should have been rejected entirely');
});

const LEAD_TOTAL_SLOTS = 32;
const leadMockGlobals = {
  LEAD_GRID_TOTAL_SLOTS: LEAD_TOTAL_SLOTS,
  window: '{ alert: (msg) => { throw new Error("ALERT: " + msg); } }',
};

test('performLeadMove: single-note move swaps with whatever note is at the destination', () => {
  const grid = Array(LEAD_TOTAL_SLOTS).fill(null);
  grid[3] = { stringIdx: 1, fret: 2 };
  grid[7] = { stringIdx: 4, fret: 0 };

  const { call, getState } = extractStatefulFunction('performLeadMove', {
    initialState: { leadDragSourceSlot: 3, leadGridSelectionRange: null, leadGridSelectedSlot: null, leadGridSlots: grid, capturedGridUpdate: null },
    mockGlobals: { ...leadMockGlobals, setLeadGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(7, false);
  const { capturedGridUpdate } = getState();
  assert.deepEqual(capturedGridUpdate[7], { stringIdx: 1, fret: 2 }, 'the dragged note should now be at slot 7');
  assert.deepEqual(capturedGridUpdate[3], { stringIdx: 4, fret: 0 }, 'the note that was at slot 7 should have swapped back, not been lost');
});

test('performLeadMove: moving a note into an empty slot leaves the source empty (no phantom duplicate)', () => {
  const grid = Array(LEAD_TOTAL_SLOTS).fill(null);
  grid[3] = { stringIdx: 1, fret: 2 };

  const { call, getState } = extractStatefulFunction('performLeadMove', {
    initialState: { leadDragSourceSlot: 3, leadGridSelectionRange: null, leadGridSelectedSlot: null, leadGridSlots: grid, capturedGridUpdate: null },
    mockGlobals: { ...leadMockGlobals, setLeadGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(10, false);
  const { capturedGridUpdate } = getState();
  assert.deepEqual(capturedGridUpdate[10], { stringIdx: 1, fret: 2 });
  assert.equal(capturedGridUpdate[3], null, 'source slot must end up empty, not still holding a copy of the note');
});

test('performLeadMove: dragging a slot inside an active range moves the WHOLE range together, shift computed from wherever inside it the drag started', () => {
  const grid = Array(LEAD_TOTAL_SLOTS).fill(null);
  grid[2] = { stringIdx: 0, fret: 0 };
  grid[3] = { stringIdx: 1, fret: 1 };
  grid[4] = { stringIdx: 2, fret: 2 };

  const { call, getState } = extractStatefulFunction('performLeadMove', {
    initialState: {
      leadDragSourceSlot: 3, // grabbed from the MIDDLE of the range, not its start
      leadGridSelectionRange: { start: 2, end: 4 },
      leadGridSelectedSlot: null,
      leadGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...leadMockGlobals, setLeadGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(8, false); // dropped at slot 8 -- shift of +5 (8 - 3)
  const { capturedGridUpdate } = getState();
  assert.deepEqual(capturedGridUpdate[7], { stringIdx: 0, fret: 0 }, 'note originally at 2 should land at 2+5=7');
  assert.deepEqual(capturedGridUpdate[8], { stringIdx: 1, fret: 1 }, 'note originally at 3 (the drag origin) should land exactly where dropped');
  assert.deepEqual(capturedGridUpdate[9], { stringIdx: 2, fret: 2 }, 'note originally at 4 should land at 4+5=9');
  assert.equal(capturedGridUpdate[2], null);
  assert.equal(capturedGridUpdate[3], null);
  assert.equal(capturedGridUpdate[4], null);
});

test('performLeadMove: refuses rather than silently failing when a range move would run off the end of the grid', () => {
  const grid = Array(LEAD_TOTAL_SLOTS).fill(null);
  grid[28] = { stringIdx: 0, fret: 0 };
  grid[29] = { stringIdx: 1, fret: 1 };

  const { call } = extractStatefulFunction('performLeadMove', {
    initialState: {
      leadDragSourceSlot: 28,
      leadGridSelectionRange: { start: 28, end: 29 },
      leadGridSelectedSlot: null,
      leadGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...leadMockGlobals, setLeadGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  assert.throws(() => call(31, false), /ALERT: Not enough room/); // would push the range past slot 31
});

test('performLeadMove: dropping on a locked slot is a no-op', () => {
  const grid = Array(LEAD_TOTAL_SLOTS).fill(null);
  grid[3] = { stringIdx: 1, fret: 2 };
  const { call, getState } = extractStatefulFunction('performLeadMove', {
    initialState: { leadDragSourceSlot: 3, leadGridSelectionRange: null, leadGridSelectedSlot: null, leadGridSlots: grid, capturedGridUpdate: null },
    mockGlobals: { ...leadMockGlobals, setLeadGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call(20, true); // isLocked = true
  const { capturedGridUpdate } = getState();
  assert.equal(capturedGridUpdate, null, 'nothing should have been written -- the move should have been rejected entirely');
});
