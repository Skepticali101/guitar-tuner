import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction, extractConst } from './extract.mjs';

const OPEN_STRING_FREQS = extractConst('OPEN_STRING_FREQS');
const depsForTranspose = `const OPEN_STRING_FREQS = ${JSON.stringify(OPEN_STRING_FREQS)};
const MAX_LEAD_FRET = 24;
function openStringSemitonesFromLowE(i){ return Math.log2(OPEN_STRING_FREQS[i]/OPEN_STRING_FREQS[0])*12; }`;
const transposeLeadNote = extractFunction('transposeLeadNote', { dependencies: depsForTranspose });
const openStringSemitonesFromLowE = extractFunction('openStringSemitonesFromLowE', {
  dependencies: `const OPEN_STRING_FREQS = ${JSON.stringify(OPEN_STRING_FREQS)};`,
});
const shortestSemitoneInterval = extractFunction('shortestSemitoneInterval');

test('open string tuning intervals match standard guitar tuning (E-A-D-G-B-E)', () => {
  const semitones = [0, 1, 2, 3, 4, 5].map(openStringSemitonesFromLowE);
  assert.deepEqual(semitones.map(Math.round), [0, 5, 10, 15, 19, 24]);
});

test('a transpose that fits on the same string stays on the same string', () => {
  const result = transposeLeadNote({ stringIdx: 2, fret: 5 }, 3);
  assert.deepEqual(result, { stringIdx: 2, fret: 8 }, 'same hand position, just shifted up the neck, is the least surprising result');
});

test('negative transpose that fits on the same string works correctly', () => {
  const result = transposeLeadNote({ stringIdx: 3, fret: 10 }, -4);
  assert.deepEqual(result, { stringIdx: 3, fret: 6 });
});

test('when the same string would overflow past fret 24, falls back to an adjacent string that fits', () => {
  const result = transposeLeadNote({ stringIdx: 0, fret: 23 }, 5); // would need fret 28 on string 0
  assert.deepEqual(result, { stringIdx: 1, fret: 23 }, 'string 1 is the closest string that can actually play this pitch within range');
});

test('when the target pitch is genuinely unplayable (below the lowest open string), returns null rather than an invalid negative fret', () => {
  const result = transposeLeadNote({ stringIdx: 0, fret: 1 }, -3); // target is below open low E -- no string can play it
  assert.equal(result, null);
});

test('transposing null is a safe no-op', () => {
  assert.equal(transposeLeadNote(null, 5), null);
});

test('a large downward transpose prefers the closest lower string over a farther one, when multiple strings could play the pitch', () => {
  // A note high on string 5 (high E) transposed far down should land on
  // the nearest string that can still reach it, not skip past to a much
  // more distant string if a closer one also works.
  const result = transposeLeadNote({ stringIdx: 5, fret: 20 }, -8);
  // target absolute semitones = 24 + 20 - 8 = 36; string 5 needs fret 12 (36-24=12), which fits on the same string
  assert.deepEqual(result, { stringIdx: 5, fret: 12 });
});

test('shortestSemitoneInterval always takes the shorter path around the octave, never the long way', () => {
  assert.equal(shortestSemitoneInterval(0, 2), 2, 'C to D is a simple +2');
  assert.equal(shortestSemitoneInterval(0, 11), -1, 'C to B should be -1 (one semitone down), not +11 (almost a full octave up)');
  assert.equal(shortestSemitoneInterval(11, 0), 1, 'B to C should be +1, not -11');
  assert.equal(shortestSemitoneInterval(0, 0), 0, 'no change when source and target are the same');
});

test('shortestSemitoneInterval never returns something larger in magnitude than a tritone (6 semitones)', () => {
  for (let from = 0; from < 12; from++) {
    for (let to = 0; to < 12; to++) {
      const interval = shortestSemitoneInterval(from, to);
      assert.ok(Math.abs(interval) <= 6, `interval from ${from} to ${to} was ${interval}, should never exceed 6 in magnitude`);
    }
  }
});

const depsForPayload = depsForTranspose + '\nfunction transposeLeadNote(note, semitones){ if(!note) return note; const sameStringFret = note.fret + semitones; if (sameStringFret >= 0 && sameStringFret <= MAX_LEAD_FRET) { return { stringIdx: note.stringIdx, fret: sameStringFret }; } const targetAbsoluteSemitones = openStringSemitonesFromLowE(note.stringIdx) + note.fret + semitones; let best = null, bestStringDistance = Infinity; for (let s = 0; s < OPEN_STRING_FREQS.length; s++) { const neededFret = Math.round(targetAbsoluteSemitones - openStringSemitonesFromLowE(s)); if (neededFret < 0 || neededFret > MAX_LEAD_FRET) continue; const stringDistance = Math.abs(s - note.stringIdx); if (stringDistance < bestStringDistance) { bestStringDistance = stringDistance; best = { stringIdx: s, fret: neededFret }; } } return best; }';
const transposeLeadPayload = extractFunction('transposeLeadPayload', { dependencies: depsForPayload });

test('transposeLeadPayload shifts every note in a saved lead by the same interval, preserving null (empty) slots', () => {
  const payload = { id: 'x', slots: [{ stringIdx: 0, fret: 3 }, null, { stringIdx: 2, fret: 5 }], tempo: 90 };
  const result = transposeLeadPayload(payload, 2);
  assert.deepEqual(result.slots, [{ stringIdx: 0, fret: 5 }, null, { stringIdx: 2, fret: 7 }]);
  assert.equal(result.tempo, 90, 'non-pitch fields like tempo should pass through unchanged');
});

test('transposeLeadPayload with 0 semitones returns the exact same object, not a wasted copy', () => {
  const payload = { id: 'x', slots: [{ stringIdx: 0, fret: 3 }], tempo: 90 };
  assert.equal(transposeLeadPayload(payload, 0), payload);
});
