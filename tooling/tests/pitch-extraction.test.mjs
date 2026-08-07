import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction, extractConst } from './extract.mjs';

const STRING_PITCH_CLASS = extractConst('STRING_PITCH_CLASS');
const getChordTonePitchClasses = extractFunction('getChordTonePitchClasses', {
  dependencies: `const STRING_PITCH_CLASS = ${JSON.stringify(STRING_PITCH_CLASS)};`,
});

test('STRING_PITCH_CLASS is standard guitar tuning (E-A-D-G-B-E)', () => {
  assert.deepEqual(STRING_PITCH_CLASS, [4, 9, 2, 7, 11, 4]);
});

test('open C major shape extracts to {C, E, G}', () => {
  const shape = { frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 };
  const result = getChordTonePitchClasses(shape);
  assert.deepEqual([...result].sort((a, b) => a - b), [0, 4, 7]);
});

test('open E minor shape extracts to {E, G, B}', () => {
  const shape = { frets: [0, 2, 2, 0, 0, 0], baseFret: 1 };
  const result = getChordTonePitchClasses(shape);
  assert.deepEqual([...result].sort((a, b) => a - b), [4, 7, 11]);
});

test('muted strings (-1) are excluded entirely', () => {
  const allMutedExceptOne = { frets: [-1, -1, -1, -1, -1, 0], baseFret: 1 };
  const result = getChordTonePitchClasses(allMutedExceptOne);
  assert.deepEqual([...result], [4]); // just the high E string, open
});

test('a barre chord at a non-trivial baseFret computes the correct transposed pitch classes', () => {
  // F major barre, baseFret 1, all strings fretted -- should be {F, A, C}
  const shape = { frets: [1, 3, 3, 2, 1, 1], baseFret: 1 };
  const result = getChordTonePitchClasses(shape);
  assert.deepEqual([...result].sort((a, b) => a - b), [0, 5, 9]); // C, F, A
});

test('duplicate pitch classes across multiple strings collapse to one entry (it is a Set)', () => {
  // both open low E and open high E are pitch class 4 -- should appear once
  const shape = { frets: [0, -1, -1, -1, -1, 0], baseFret: 1 };
  const result = getChordTonePitchClasses(shape);
  assert.equal(result.size, 1);
  assert.deepEqual([...result], [4]);
});
