import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const getIntervalRole = extractFunction('getIntervalRole');

test('every interval 0-11 returns a role with the correct music-theory name', () => {
  const expected = {
    0: 'R', 1: 'b9', 2: '9', 3: 'm3', 4: 'M3', 5: '11',
    6: 'b5', 7: '5', 8: '#5', 9: '6', 10: 'b7', 11: '7',
  };
  for (const [interval, name] of Object.entries(expected)) {
    assert.equal(getIntervalRole(Number(interval)).name, name, `interval ${interval} should be "${name}"`);
  }
});

test('every interval returns a non-empty color for chord-tone coloring', () => {
  for (let i = 0; i <= 11; i++) {
    const role = getIntervalRole(i);
    assert.ok(role.color && role.color.length > 0, `interval ${i} has no color`);
  }
});

test('root, thirds, fifths, and sevenths share consistent color families with their alterations', () => {
  // m3 and M3 (both "3rd" family) should share a color; so should the two 5ths' neighbors
  assert.equal(getIntervalRole(3).color, getIntervalRole(4).color); // m3 / M3
  assert.equal(getIntervalRole(6).color, getIntervalRole(7).color); // b5 / 5
  assert.equal(getIntervalRole(7).color, getIntervalRole(8).color); // 5 / #5
});
