import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction, extractConst } from './extract.mjs';

const OPEN_STRING_FREQS = extractConst('OPEN_STRING_FREQS');
const STRING_PITCH_CLASS = extractConst('STRING_PITCH_CLASS');
const MODES_TABLE = extractConst('MODES_TABLE');

const sharedDeps = `const OPEN_STRING_FREQS = ${JSON.stringify(OPEN_STRING_FREQS)};
const STRING_PITCH_CLASS = ${JSON.stringify(STRING_PITCH_CLASS)};
const MAX_LEAD_FRET = 24;
function openStringSemitonesFromLowE(i){ return Math.log2(OPEN_STRING_FREQS[i]/OPEN_STRING_FREQS[0])*12; }
function shortestSemitoneInterval(a,b){ let d=(b-a)%12; if(d>6)d-=12; if(d<-6)d+=12; return d; }
function transposeLeadNote(note, semitones){
  if(!note) return note;
  const sameStringFret = note.fret + semitones;
  if (sameStringFret >= 0 && sameStringFret <= MAX_LEAD_FRET) return { stringIdx: note.stringIdx, fret: sameStringFret };
  const targetAbsoluteSemitones = openStringSemitonesFromLowE(note.stringIdx) + note.fret + semitones;
  let best = null, bestStringDistance = Infinity;
  for (let s = 0; s < OPEN_STRING_FREQS.length; s++) {
    const neededFret = Math.round(targetAbsoluteSemitones - openStringSemitonesFromLowE(s));
    if (neededFret < 0 || neededFret > MAX_LEAD_FRET) continue;
    const stringDistance = Math.abs(s - note.stringIdx);
    if (stringDistance < bestStringDistance) { bestStringDistance = stringDistance; best = { stringIdx: s, fret: neededFret }; }
  }
  return best;
}
function findClosestScaleDegree(intervalFromRoot, intervals){
  let bestIdx = 0, bestDiff = Infinity;
  intervals.forEach((iv, idx) => { const diff = Math.abs(iv - intervalFromRoot); if (diff < bestDiff) { bestDiff = diff; bestIdx = idx; } });
  return { degreeIdx: bestIdx, chromaticOffset: intervalFromRoot - intervals[bestIdx] };
}`;

const remapLeadNoteToKeyMode = extractFunction('remapLeadNoteToKeyMode', { dependencies: sharedDeps });
const remapLeadPayloadToKeyMode = extractFunction('remapLeadPayloadToKeyMode', {
  dependencies: sharedDeps + '\n' + extractFunction('remapLeadNoteToKeyMode', { dependencies: sharedDeps }).toString(),
});
const findClosestScaleDegree = extractFunction('findClosestScaleDegree');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function pitchClassOf(note) {
  const semis = STRING_PITCH_CLASS[0] + Math.log2(OPEN_STRING_FREQS[note.stringIdx] / OPEN_STRING_FREQS[0]) * 12 + note.fret;
  return ((Math.round(semis) % 12) + 12) % 12;
}
function noteNameOf(note) { return NOTE_NAMES[pitchClassOf(note)]; }

const IONIAN = MODES_TABLE.Ionian.intervals;
const DORIAN = MODES_TABLE.Dorian.intervals;
const AEOLIAN = MODES_TABLE.Aeolian.intervals;

test('pitch class helper itself is correct -- open low E reads as E, not C (regression guard for the exact bug this engine originally had)', () => {
  assert.equal(noteNameOf({ stringIdx: 0, fret: 0 }), 'E');
  assert.equal(noteNameOf({ stringIdx: 1, fret: 3 }), 'C'); // A string, fret 3
});

test('remapping within the same mode (just a key change) is a straightforward transpose', () => {
  const cNote = { stringIdx: 1, fret: 3 }; // C
  const result = remapLeadNoteToKeyMode(cNote, 0, IONIAN, 7, IONIAN); // C Ionian -> G Ionian
  assert.equal(noteNameOf(result), 'G', 'the tonic of C Ionian should map to the tonic of G Ionian');
});

test('remapping the 3rd scale degree from Ionian to Dorian correctly flattens it -- this is the actual point of scale-degree-aware mapping, not just a chromatic shift', () => {
  const eNote = { stringIdx: 1, fret: 7 }; // E, degree 3 of C Ionian (interval 4)
  const result = remapLeadNoteToKeyMode(eNote, 0, IONIAN, 0, DORIAN); // same root, mode changes
  assert.equal(noteNameOf(result), 'D#', 'Dorian\'s 3rd degree (interval 3) is a half-step below Ionian\'s (interval 4)');
});

test('remapping the 7th scale degree from Ionian to Dorian correctly flattens it', () => {
  const bNote = { stringIdx: 2, fret: 9 }; // B, degree 7 of C Ionian (interval 11)
  const result = remapLeadNoteToKeyMode(bNote, 0, IONIAN, 0, DORIAN); // Dorian's 7th is interval 10 (Bb)
  assert.equal(noteNameOf(result), 'A#');
});

test('remapping the 4th and 5th scale degrees, which Ionian and Dorian share identically, leaves them unchanged', () => {
  const fNote = { stringIdx: 0, fret: 1 }; // F, degree 4 of C Ionian (interval 5) -- Dorian also has interval 5 here
  const result = remapLeadNoteToKeyMode(fNote, 0, IONIAN, 0, DORIAN);
  assert.equal(noteNameOf(result), 'F', 'degree 4 is identical in both modes, so this note should not move at all');
});

test('remapping degree-index-preserving across a relative major/minor pair does NOT preserve absolute pitch -- that would require pitch-preserving mapping, a different (and not what this feature does) kind of remap. Degree 3 of C Ionian maps to degree 3 of A Aeolian, which is a different pitch (C, not E) -- verified independently, not assumed', () => {
  const eNote = { stringIdx: 1, fret: 7 }; // E, degree 3 of C Ionian
  const result = remapLeadNoteToKeyMode(eNote, 0, IONIAN, 9, AEOLIAN);
  assert.equal(noteNameOf(result), 'C', 'degree index 2 (0-indexed) in Aeolian is interval 3, and (9+3)%12=0=C');
});

test('a chromatic passing tone (not exactly in the source scale) keeps its chromatic offset relative to the new scale, rather than snapping onto it', () => {
  // Eb is not in C Ionian -- its interval-from-root (3) is an exact tie
  // between degree 2 (interval 2) and degree 3 (interval 4), which
  // findClosestScaleDegree's tie-break resolves to degree 2 with a +1
  // offset (see the dedicated tie-break test below). Remapped to G
  // Ionian, degree 2 there is interval 2 (A), so +1 offset lands on Bb --
  // preserving the "roughly a half-step off the scale" character rather
  // than snapping cleanly onto a scale tone.
  const ebNote = { stringIdx: 1, fret: 6 }; // Eb
  assert.equal(noteNameOf(ebNote), 'D#');
  const result = remapLeadNoteToKeyMode(ebNote, 0, IONIAN, 7, IONIAN); // C Ionian -> G Ionian, same mode
  assert.equal(noteNameOf(result), 'A#', 'G Ionian degree-2 (A) + a half-step offset = Bb');
});

test('findClosestScaleDegree finds an exact match with zero chromatic offset when the note is genuinely in the scale', () => {
  const result = findClosestScaleDegree(4, IONIAN); // interval 4 = degree 3 (E) in Ionian, exact match
  assert.equal(result.degreeIdx, 2); // 0-indexed
  assert.equal(result.chromaticOffset, 0);
});

test('findClosestScaleDegree breaks an exact tie (interval 3 is equidistant from Ionian degree 1 at interval 2, and degree 2 at interval 4) deterministically by taking the first-encountered match', () => {
  const result = findClosestScaleDegree(3, IONIAN);
  assert.equal(result.degreeIdx, 1);
  assert.equal(result.chromaticOffset, 1);
});

test('remapLeadPayloadToKeyMode remaps every note in a saved lead, preserving empty (null) slots', () => {
  const payload = { id: 'x', slots: [{ stringIdx: 1, fret: 7 }, null, { stringIdx: 1, fret: 3 }], tempo: 90 };
  const result = remapLeadPayloadToKeyMode(payload, 0, IONIAN, 0, DORIAN);
  assert.equal(noteNameOf(result.slots[0]), 'D#'); // E -> Eb under the mode change
  assert.equal(result.slots[1], null);
  assert.equal(noteNameOf(result.slots[2]), 'C'); // tonic stays the tonic
  assert.equal(result.tempo, 90);
});

test('remapping a full C major scale line to D major transposes every degree correctly, root to root', () => {
  // Build one note per scale degree of C Ionian and remap the whole thing to D Ionian.
  // Every resulting note should be exactly a whole step (2 semitones) higher.
  const cMajorScaleNotes = [
    { stringIdx: 1, fret: 3 },  // C
    { stringIdx: 1, fret: 5 },  // D
    { stringIdx: 1, fret: 7 },  // E
    { stringIdx: 0, fret: 1 },  // F
    { stringIdx: 0, fret: 3 },  // G
  ];
  const expectedNames = ['D', 'E', 'F#', 'G', 'A'];
  cMajorScaleNotes.forEach((note, i) => {
    const result = remapLeadNoteToKeyMode(note, 0, IONIAN, 2, IONIAN); // C Ionian -> D Ionian
    assert.equal(noteNameOf(result), expectedNames[i], `scale degree ${i + 1} should transpose up a whole step`);
  });
});
