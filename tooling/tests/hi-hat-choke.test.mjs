import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const chokeVoice = extractFunction('chokeVoice');

function makeMockGainParam() {
  const calls = [];
  return {
    value: 1,
    cancelAndHoldAtTime(t) { calls.push(['cancelAndHoldAtTime', t]); },
    cancelScheduledValues(t) { calls.push(['cancelScheduledValues', t]); },
    linearRampToValueAtTime(v, t) { calls.push(['linearRampToValueAtTime', v, t]); },
    _calls: calls,
  };
}
function makeMockSourceNode() {
  const calls = [];
  return { start(t) { calls.push(['start', t]); }, stop(t) { calls.push(['stop', t]); }, _calls: calls };
}

test('choking a null voice is a safe no-op', () => {
  assert.doesNotThrow(() => chokeVoice(null, 1.0));
});

test('choking reschedules the source node to stop shortly after the choke time, not its original natural duration', () => {
  const src = makeMockSourceNode();
  src.start(1.0);
  src.stop(1.0 + 2.0); // natural 2-second ring-out, as originally scheduled
  const voice = { gainNode: { gain: makeMockGainParam() }, sourceNodes: [src] };

  chokeVoice(voice, 1.2); // a closed hat fires 200ms later

  const stopCalls = src._calls.filter(c => c[0] === 'stop');
  assert.equal(stopCalls.length, 2); // the original schedule plus the new choke-triggered one
  const chokeStop = stopCalls[1][1];
  assert.ok(chokeStop > 1.2 && chokeStop < 1.3, `expected the choke stop time to land shortly after 1.2, got ${chokeStop}`);
  assert.ok(chokeStop < 1.5, 'choke stop time should be nowhere near the original 3.0s natural end');
});

test('choke uses cancelAndHoldAtTime when available, to correctly hold whatever gain the ramp was actually at', () => {
  const src = makeMockSourceNode();
  const gainParam = makeMockGainParam();
  const voice = { gainNode: { gain: gainParam }, sourceNodes: [src] };
  chokeVoice(voice, 5.0);
  const holdCall = gainParam._calls.find(c => c[0] === 'cancelAndHoldAtTime');
  assert.ok(holdCall, 'expected cancelAndHoldAtTime to be called');
  assert.equal(holdCall[1], 5.0);
});

test('choke falls back to cancelScheduledValues when cancelAndHoldAtTime is unavailable (older browser)', () => {
  const src = makeMockSourceNode();
  const gainParam = makeMockGainParam();
  delete gainParam.cancelAndHoldAtTime;
  const voice = { gainNode: { gain: gainParam }, sourceNodes: [src] };
  chokeVoice(voice, 5.0);
  const fallbackCall = gainParam._calls.find(c => c[0] === 'cancelScheduledValues');
  assert.ok(fallbackCall, 'expected cancelScheduledValues fallback to be called');
});

test('choke fades the gain to (near) silence, not an abrupt jump, to avoid a click', () => {
  const src = makeMockSourceNode();
  const gainParam = makeMockGainParam();
  const voice = { gainNode: { gain: gainParam }, sourceNodes: [src] };
  chokeVoice(voice, 2.0);
  const ramp = gainParam._calls.find(c => c[0] === 'linearRampToValueAtTime');
  assert.ok(ramp, 'expected a ramp to near-zero, not an instant value jump');
  assert.ok(ramp[1] < 0.01, 'ramp target should be near-silent');
  assert.ok(ramp[2] > 2.0 && ramp[2] < 2.05, 'fade should complete quickly (tens of ms), not linger');
});

test('choke stops every source node in a multi-oscillator voice (synthesized hats), not just the first', () => {
  const oscillators = [makeMockSourceNode(), makeMockSourceNode(), makeMockSourceNode()];
  const voice = { gainNode: { gain: makeMockGainParam() }, sourceNodes: oscillators };
  chokeVoice(voice, 3.0);
  for (const osc of oscillators) {
    assert.ok(osc._calls.some(c => c[0] === 'stop'), 'every oscillator in the voice should be stopped');
  }
});

test('choke never throws even if a source node is already stopped (real Web Audio would throw InvalidStateError)', () => {
  const src = { stop() { throw new Error('InvalidStateError: already stopped'); } };
  const voice = { gainNode: { gain: makeMockGainParam() }, sourceNodes: [src] };
  assert.doesNotThrow(() => chokeVoice(voice, 1.0));
});
