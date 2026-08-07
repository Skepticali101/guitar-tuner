import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const computeBarCount = extractFunction('computeBarCount');

test('a chord at exactly 1 bar (beats === beatsPerBar) shows 1 segment', () => {
  assert.equal(computeBarCount(4, 4), 1);
});

test('a chord at 2 bars shows 2 segments', () => {
  assert.equal(computeBarCount(8, 4), 2);
});

test('a chord at 4 bars shows 4 segments', () => {
  assert.equal(computeBarCount(16, 4), 4);
});

test('works correctly under a non-4/4 time signature (e.g. 3/4)', () => {
  assert.equal(computeBarCount(3, 3), 1);
  assert.equal(computeBarCount(6, 3), 2);
  assert.equal(computeBarCount(9, 3), 3);
});

test('a half-bar chord still rounds up to show at least 1 segment, never 0', () => {
  assert.equal(computeBarCount(2, 4), 1);
});

test('missing/undefined beats falls back to beatsPerBar itself, showing 1 bar', () => {
  assert.equal(computeBarCount(undefined, 4), 1);
  assert.equal(computeBarCount(null, 4), 1);
  assert.equal(computeBarCount(0, 4), 1); // 0 is falsy, hits the same fallback as undefined/null
});

test('rounds rather than floors/ceils for odd, non-bar-aligned legacy data', () => {
  assert.equal(computeBarCount(7, 4), 2, '7 beats is closer to 2 bars (8) than 1 bar (4)');
  assert.equal(computeBarCount(5, 4), 1, '5 beats is closer to 1 bar (4) than 2 bars (8)');
});
