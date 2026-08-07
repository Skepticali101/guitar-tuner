import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const audioBufferToWavBlob = extractFunction('audioBufferToWavBlob');

function mockAudioBuffer(channels, sampleRate, length){
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length,
    getChannelData(ch) { return channels[ch]; },
  };
}

async function blobToDataView(blob){
  const buf = await blob.arrayBuffer();
  return new DataView(buf);
}

test('produces a correctly-sized file: 44-byte header plus interleaved 16-bit samples', async () => {
  const buffer = mockAudioBuffer([new Float32Array([0, 0.5, -0.5, 1.0]), new Float32Array([0, -1.0, 0.25, -0.25])], 44100, 4);
  const blob = audioBufferToWavBlob(buffer);
  assert.equal(blob.size, 44 + 4 * 2 * 2, '44-byte header + 4 frames * 2 channels * 2 bytes/sample');
});

test('WAV header fields are correct: RIFF/WAVE signatures, PCM format, channel count, sample rate, bit depth', async () => {
  const buffer = mockAudioBuffer([new Float32Array([0]), new Float32Array([0])], 48000, 1);
  const view = await blobToDataView(audioBufferToWavBlob(buffer));
  const readStr = (offset, len) => { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i)); return s; };
  assert.equal(readStr(0, 4), 'RIFF');
  assert.equal(readStr(8, 4), 'WAVE');
  assert.equal(readStr(12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1, 'PCM format code');
  assert.equal(view.getUint16(22, true), 2, 'channel count');
  assert.equal(view.getUint32(24, true), 48000, 'sample rate');
  assert.equal(view.getUint16(34, true), 16, 'bits per sample');
  assert.equal(readStr(36, 4), 'data');
});

test('float samples are converted to 16-bit PCM with correct scaling, rounded not truncated', async () => {
  const buffer = mockAudioBuffer([new Float32Array([0, 0.5, -0.5, 1.0]), new Float32Array([0, -1.0, 0.25, -0.25])], 44100, 4);
  const view = await blobToDataView(audioBufferToWavBlob(buffer));
  const samples = [];
  for (let i = 0; i < 8; i++) samples.push(view.getInt16(44 + i * 2, true));
  const left = [samples[0], samples[2], samples[4], samples[6]];
  const right = [samples[1], samples[3], samples[5], samples[7]];
  assert.deepEqual(left, [0, 16384, -16384, 32767]);
  assert.deepEqual(right, [0, -32768, 8192, -8192]);
});

test('samples outside the valid -1..1 range are clamped, not wrapped into a noise burst', async () => {
  const buffer = mockAudioBuffer([new Float32Array([1.5, -1.5])], 44100, 2); // a stray peak slightly over full scale
  const view = await blobToDataView(audioBufferToWavBlob(buffer));
  assert.equal(view.getInt16(44, true), 32767, 'should clamp to max positive, not wrap around to a small or negative value');
  assert.equal(view.getInt16(46, true), -32768, 'should clamp to max negative');
});

test('mono audio encodes correctly with a single channel of interleaved data (i.e. not interleaved at all)', async () => {
  const buffer = mockAudioBuffer([new Float32Array([1.0, 0, -1.0])], 22050, 3);
  const view = await blobToDataView(audioBufferToWavBlob(buffer));
  assert.equal(view.getUint16(22, true), 1, 'channel count should be 1');
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), -32768);
});

test('the RIFF chunk size field correctly reflects the total file size minus 8 bytes', async () => {
  const buffer = mockAudioBuffer([new Float32Array([0, 0, 0])], 44100, 3);
  const view = await blobToDataView(audioBufferToWavBlob(buffer));
  const totalSize = 44 + 3 * 1 * 2;
  assert.equal(view.getUint32(4, true), totalSize - 8, 'RIFF chunk size is total file size minus the 8-byte RIFF header itself');
});
