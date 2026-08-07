import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const forEachLoopedSlot = extractFunction('forEachLoopedSlot');

function emptyPattern(totalSlots, patternLengthSlots) {
  return { slots: Array(totalSlots).fill(null).map(() => Array(3).fill(false)), patternLengthSlots };
}
function collectHits(pattern, chordDurationSlots, fallbackHalf) {
  const hits = [];
  forEachLoopedSlot(
    pattern, chordDurationSlots, fallbackHalf,
    (p, i) => p.slots[i].some(Boolean),
    (targetIdx, sourceIdx) => { if (pattern.slots[sourceIdx].some(Boolean)) hits.push([targetIdx, sourceIdx]); }
  );
  return hits;
}

test('a 1-bar pattern under a chord that becomes 2 bars loops to fill the full duration', () => {
  const pattern = emptyPattern(32, 16);
  pattern.slots[0][0] = true;
  pattern.slots[8][1] = true;
  const hits = collectHits(pattern, 32, 16);
  assert.deepEqual(hits, [[0, 0], [8, 8], [16, 0], [24, 8]], 'the pattern should repeat once more, not go silent for the second bar');
});

test('a 2-bar pattern under a chord that is only 1 bar truncates -- content past the chord boundary never plays', () => {
  const pattern = emptyPattern(32, 32);
  pattern.slots[0][0] = true;
  pattern.slots[20][0] = true; // in the pattern's second bar
  const hits = collectHits(pattern, 16, 16);
  assert.deepEqual(hits, [[0, 0]], 'slot 20 is past the chord\'s 1-bar duration and must not play -- it would otherwise bleed into the next chord');
});

test('a pattern that exactly matches the chord duration plays through unchanged, no loop or cut', () => {
  const pattern = emptyPattern(16, 16);
  pattern.slots[0][0] = true;
  pattern.slots[15][0] = true;
  const hits = collectHits(pattern, 16, 16);
  assert.deepEqual(hits, [[0, 0], [15, 15]]);
});

test('backward compatibility: old saved pattern with no patternLengthSlots and a genuinely empty second half loops the first half', () => {
  const oldPattern = emptyPattern(32); // no patternLengthSlots -- simulates data saved before this field existed
  oldPattern.slots[4][0] = true;
  const hits = collectHits(oldPattern, 32, 16);
  assert.deepEqual(hits, [[4, 4], [20, 4]], 'should detect the empty second half and loop the 1-bar content to fill both bars');
});

test('backward compatibility: old saved pattern with no patternLengthSlots but real content in the second half preserves it exactly -- never silently loses old data', () => {
  const oldPattern = emptyPattern(32); // no patternLengthSlots
  oldPattern.slots[4][0] = true;
  oldPattern.slots[20][0] = true; // deliberate content someone already saved in bar 2
  const hits = collectHits(oldPattern, 32, 16);
  assert.deepEqual(hits, [[4, 4], [20, 20]], 'must play the actual saved second-half content, not loop over and discard it');
});

test('an empty pattern produces no hits regardless of loop/truncate direction', () => {
  assert.deepEqual(collectHits(emptyPattern(32, 16), 32, 16), []);
  assert.deepEqual(collectHits(emptyPattern(32, 32), 16, 16), []);
});
