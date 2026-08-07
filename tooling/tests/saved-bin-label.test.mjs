import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction, extractConst } from './extract.mjs';

const NOTE_NAMES = extractConst('NOTE_NAMES');
const deps = `const NOTE_NAMES = ${JSON.stringify(NOTE_NAMES)};
const DRUM_KIT_LABELS = { rock: 'Rock', hiphop: 'Retro', jazz: 'Jazz', drummachine: 'Drum Machine' };`;
const formatSavedBinEntryLabel = extractFunction('formatSavedBinEntryLabel', { dependencies: deps });

const FIXED_DATE = new Date('2026-01-15').getTime();

test('a drum pattern entry labels by kit name and date', () => {
  const entry = { type: 'drum', payload: { kit: 'jazz' }, createdAt: FIXED_DATE };
  assert.equal(formatSavedBinEntryLabel(entry), 'Jazz Drum Pattern \u2014 Jan 15');
});

test('a lead saved from an existing chord uses that chord\'s name', () => {
  const entry = { type: 'lead', chordContext: 'Dm7', createdAt: FIXED_DATE };
  assert.equal(formatSavedBinEntryLabel(entry), 'Dm7 Lead \u2014 Jan 15');
});

test('a lead saved fresh from the editor (no chord context) falls back to key + mode', () => {
  const entry = { type: 'lead', chordContext: null, keyIndex: 7, modeName: 'Mixolydian', createdAt: FIXED_DATE };
  assert.equal(formatSavedBinEntryLabel(entry), 'G Mixolydian Lead \u2014 Jan 15');
});

test('an unrecognized drum kit key falls back to the raw kit value rather than showing undefined', () => {
  const entry = { type: 'drum', payload: { kit: 'someFutureKit' }, createdAt: FIXED_DATE };
  assert.equal(formatSavedBinEntryLabel(entry), 'someFutureKit Drum Pattern \u2014 Jan 15');
});
