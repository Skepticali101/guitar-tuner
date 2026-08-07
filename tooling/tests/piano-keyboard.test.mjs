import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction, extractConst } from './extract.mjs';

const consts = {
  PIANO_WHITE_KEY_PATTERN: extractConst('PIANO_WHITE_KEY_PATTERN'),
  PIANO_WHITE_KEY_NAMES: extractConst('PIANO_WHITE_KEY_NAMES'),
  PIANO_BLACK_AFTER_WHITE: extractConst('PIANO_BLACK_AFTER_WHITE'),
  PIANO_BLACK_KEY_NAMES: extractConst('PIANO_BLACK_KEY_NAMES'),
};
const getIntervalRole = extractFunction('getIntervalRole');
const dependencies = Object.entries(consts).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n')
  + `\nconst getIntervalRole = ${getIntervalRole.toString()};`;
const renderPianoKeyboardSVG = extractFunction('renderPianoKeyboardSVG', { dependencies });

function labelsIn(svg) {
  return [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
}

test('C major (natural notes only) highlights C, E, G across both default octaves', () => {
  const svg = renderPianoKeyboardSVG(new Set([0, 4, 7]), 0);
  const labels = labelsIn(svg);
  assert.deepEqual(labels.sort(), ['C', 'C', 'E', 'E', 'G', 'G'].sort());
});

test('the root note is colored distinctly (amber) from the other chord tones', () => {
  const svg = renderPianoKeyboardSVG(new Set([0, 4, 7]), 0);
  const rootHighlights = (svg.match(/fill="var\(--amber\)"/g) || []).length;
  assert.equal(rootHighlights, 2, 'expected exactly one amber-colored C per octave shown');
});

test('E major (needs a sharp) correctly highlights and labels the black G# key, not just the white keys', () => {
  const svg = renderPianoKeyboardSVG(new Set([4, 8, 11]), 4); // E, G#, B, root=E
  const labels = labelsIn(svg);
  assert.ok(labels.includes('G#'), 'expected the black G# key to be labeled -- black-key highlighting is a separate code path from white-key highlighting and must be checked independently');
  assert.ok(labels.includes('E') && labels.includes('B'));
});

test('numOctaves option controls how many keys are rendered', () => {
  const oneOctave = renderPianoKeyboardSVG(new Set([0]), 0, { numOctaves: 1 });
  const twoOctaves = renderPianoKeyboardSVG(new Set([0]), 0, { numOctaves: 2 });
  const countRects = svg => (svg.match(/<rect/g) || []).length;
  assert.ok(countRects(twoOctaves) > countRects(oneOctave), 'two octaves should render more keys than one');
});

test('scale option (default, no scale param) omits labels below a scale of 0.5 to avoid illegible text', () => {
  const tiny = renderPianoKeyboardSVG(new Set([0, 4, 7]), 0, { scale: 0.3 });
  const labels = labelsIn(tiny);
  assert.equal(labels.length, 0, 'labels should be omitted entirely at very small scale, not rendered illegibly small');
});

test('no black key is ever placed after E or B (real piano layout has no black key there)', () => {
  // every pitch class 0-11 highlighted -- if a black key incorrectly existed after E(4) or B(11)/pc 5 or 0 in the wrong slot, this would reveal it structurally via key count
  const allPitchClasses = new Set(Array.from({ length: 12 }, (_, i) => i));
  const svg = renderPianoKeyboardSVG(allPitchClasses, 0, { numOctaves: 1 });
  const blackKeyCount = (svg.match(/fill="#1a1a1a"|fill="var\(--amber\)".*height="6[0-9]/g) || []).length;
  // structural check: exactly 5 black keys per octave (not 7, which would mean one exists after E and B too)
  const totalRects = (svg.match(/<rect/g) || []).length;
  assert.equal(totalRects, 7 + 5, 'one octave should be exactly 7 white keys + 5 black keys, never 7 white + 7 black');
});
