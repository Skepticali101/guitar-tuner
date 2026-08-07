import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatefulFunction } from './extract.mjs';

const DRUM_SOUNDS_LEN = 10;
const TOTAL_SLOTS = 16;

function emptyGrid() {
  return Array(TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS_LEN).fill(false));
}
const commonMockGlobals = {
  DRUM_SOUNDS: JSON.stringify(Array(DRUM_SOUNDS_LEN).fill('x')),
  DRUM_GRID_TOTAL_SLOTS: TOTAL_SLOTS,
  document: '{ getElementById: () => ({ value: "4" }) }',
  window: '{ alert: (msg) => { throw new Error("ALERT: " + msg); } }',
};

test('Duplicate copies a single selected column forward to the next column', () => {
  const grid = emptyGrid();
  grid[2][0] = true; // kick
  grid[2][2] = true; // closedHat

  const { call, getState } = extractStatefulFunction('performDrumDuplicate', {
    initialState: {
      drumSelection: { rowStart: 0, rowEnd: 9, colStart: 2, colEnd: 2 },
      drumSelectionAnchor: { row: 0, col: 2 },
      drumSecondHalfOpen: false,
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...commonMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call();
  const { capturedGridUpdate } = getState();
  assert.deepEqual(capturedGridUpdate[3], grid[2], 'slot 3 should now match what was at slot 2');
  assert.deepEqual(capturedGridUpdate[2], grid[2], 'the original source column should be untouched');
});

test('Duplicate copies a multi-row, multi-column rectangle as a whole block', () => {
  const grid = emptyGrid();
  grid[0][1] = true; // snare at col 0
  grid[1][3] = true; // openHat at col 1

  const { call, getState } = extractStatefulFunction('performDrumDuplicate', {
    initialState: {
      drumSelection: { rowStart: 0, rowEnd: 9, colStart: 0, colEnd: 1 }, // 2-column block
      drumSelectionAnchor: { row: 0, col: 0 },
      drumSecondHalfOpen: false,
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...commonMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call();
  const { capturedGridUpdate } = getState();
  assert.deepEqual(capturedGridUpdate[2], grid[0], 'block should land starting at col 2');
  assert.deepEqual(capturedGridUpdate[3], grid[1]);
});

test('Duplicate refuses (alerts) rather than silently failing when there is no room left', () => {
  const grid = emptyGrid();
  const { call } = extractStatefulFunction('performDrumDuplicate', {
    initialState: {
      drumSelection: { rowStart: 0, rowEnd: 9, colStart: 15, colEnd: 15 }, // last column selected, nowhere to duplicate to
      drumSelectionAnchor: { row: 0, col: 15 },
      drumSecondHalfOpen: true,
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...commonMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  assert.throws(() => call(), /ALERT: No room left/);
});

test('Copy captures exactly the selected rectangle, independent of later grid mutations (deep copy, not a reference)', () => {
  const grid = emptyGrid();
  grid[2][0] = true;
  grid[2][4] = true;

  const { call, getState } = extractStatefulFunction('performDrumCopy', {
    initialState: { drumSelection: { rowStart: 0, rowEnd: 9, colStart: 2, colEnd: 2 }, drumGridSlots: grid, drumClipboard: null },
    mockGlobals: {},
  });
  call();
  const { drumClipboard } = getState();
  assert.equal(drumClipboard.numRows, 10);
  assert.equal(drumClipboard.numCols, 1);
  assert.equal(drumClipboard.data[0][0], true); // kick
  assert.equal(drumClipboard.data[4][0], true); // crash

  // mutate the source grid after copying -- the clipboard must not reflect this
  grid[2][0] = false;
  assert.equal(drumClipboard.data[0][0], true, 'clipboard should be a deep copy, unaffected by later mutation of the source');
});

test('Paste writes the clipboard content at the current selection anchor', () => {
  const grid = emptyGrid();
  const clipboard = { numRows: 1, numCols: 1, data: [[true]] };

  const { call, getState } = extractStatefulFunction('performDrumPaste', {
    initialState: {
      drumClipboard: clipboard,
      drumSelection: null,
      drumSelectionAnchor: { row: 3, col: 5 },
      drumSecondHalfOpen: false,
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...commonMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  call();
  const { capturedGridUpdate } = getState();
  assert.equal(capturedGridUpdate[5][3], true, 'expected the pasted hit at row 3, col 5 (the anchor point)');
});

test('Paste refuses rather than silently failing when the clipboard content does not fit in the remaining grid', () => {
  const grid = emptyGrid();
  const oversizedClipboard = { numRows: 1, numCols: 5, data: [[true, true, true, true, true]] };

  const { call } = extractStatefulFunction('performDrumPaste', {
    initialState: {
      drumClipboard: oversizedClipboard,
      drumSelection: null,
      drumSelectionAnchor: { row: 0, col: 14 }, // only 2 columns of room left (14, 15), clipboard needs 5
      drumSecondHalfOpen: true,
      drumGridSlots: grid,
      capturedGridUpdate: null,
    },
    mockGlobals: { ...commonMockGlobals, setDrumGridSlots: '(newSlots) => { capturedGridUpdate = newSlots; }' },
  });
  assert.throws(() => call(), /ALERT: Not enough room/);
});
