import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';

const deps = `
  const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];
  function writeVLQ(value){
    if (value === 0) return [0];
    const groups = [];
    while (value > 0) { groups.unshift(value & 0x7F); value = value >>> 7; }
    for (let i = 0; i < groups.length - 1; i++) groups[i] |= 0x80;
    return groups;
  }
  function uint16BE(v){ return [(v >> 8) & 0xFF, v & 0xFF]; }
  function uint32BE(v){ return [(v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]; }
  function stringBytes(s){ return Array.from(s).map(c => c.charCodeAt(0)); }
  function getEntryLeadGrids(entry){
    if (entry.leadGrids) return entry.leadGrids;
    if (entry.leadGrid) return [entry.leadGrid];
    return [];
  }
  function isAnyPartOfStackSoloed(entry){
    return !!entry.solo
      || !!entry.leadPatternSolo
      || getEntryLeadGrids(entry).some(g => g.solo)
      || !!(entry.drumPattern && entry.drumPattern.solo);
  }
`;

// A minimal, standalone Standard MIDI File parser -- deliberately NOT
// sharing any code with generateMidiBytes's own VLQ/byte-encoding
// helpers, so a bug in one can't be masked by using it to verify the
// other. Just enough to read back tempo, note events (with absolute
// time), and markers.
function parseMidi(bytes) {
  let pos = 0;
  const readU8 = () => bytes[pos++];
  const readU32BE = () => { const v = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3]; pos += 4; return v >>> 0; };
  const readU16BE = () => { const v = (bytes[pos] << 8) | bytes[pos+1]; pos += 2; return v; };
  const readVLQ = () => {
    let value = 0;
    while (true) {
      const b = readU8();
      value = (value << 7) | (b & 0x7F);
      if (!(b & 0x80)) break;
    }
    return value;
  };
  const readBytes = (n) => { const s = bytes.slice(pos, pos + n); pos += n; return s; };

  assert.equal(String.fromCharCode(...readBytes(4)), 'MThd');
  assert.equal(readU32BE(), 6);
  const format = readU16BE();
  const numTracks = readU16BE();
  const division = readU16BE();

  const events = [];
  let tempo = null;
  for (let t = 0; t < numTracks; t++) {
    assert.equal(String.fromCharCode(...readBytes(4)), 'MTrk');
    const trackLen = readU32BE();
    const trackEnd = pos + trackLen;
    let absTime = 0;
    while (pos < trackEnd) {
      const delta = readVLQ();
      absTime += delta;
      const statusByte = readU8();
      if (statusByte === 0xFF) {
        const metaType = readU8();
        const len = readVLQ();
        const data = readBytes(len);
        if (metaType === 0x51) tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        if (metaType === 0x06) events.push({ type: 'marker', time: absTime, text: String.fromCharCode(...data) });
        if (metaType === 0x2F) events.push({ type: 'end_of_track', time: absTime });
      } else if ((statusByte & 0xF0) === 0x90) {
        const note = readU8(), vel = readU8();
        events.push({ type: 'note_on', time: absTime, note, vel });
      } else if ((statusByte & 0xF0) === 0x80) {
        const note = readU8(), vel = readU8();
        events.push({ type: 'note_off', time: absTime, note, vel });
      } else if ((statusByte & 0xF0) === 0xB0) {
        const controller = readU8(), value = readU8();
        events.push({ type: 'control_change', time: absTime, controller, value });
      } else {
        throw new Error(`parseMidi: unrecognized status byte 0x${statusByte.toString(16)} at track offset -- likely a real encoding bug`);
      }
    }
  }
  return { format, numTracks, division, tempo, events };
}

test('a simple 3-chord progression (no shapes -- root-note fallback) has correct tempo, pitches, and timing', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: null },
    { rootIndex: 5, chordName: 'F', beats: 4, section: null },
    { rootIndex: 7, chordName: 'G', beats: 8, section: null },
  ];
  const { division, tempo, events } = parseMidi(generateMidiBytes(prog, 120));

  assert.equal(division, 480);
  assert.equal(tempo, 500000, '60,000,000 / 120bpm = 500,000 microseconds per quarter note');

  const noteOns = events.filter(e => e.type === 'note_on');
  assert.deepEqual(noteOns.map(e => e.note), [60, 65, 67], 'root notes at pitch classes 0, 5, 7 -> MIDI 60, 65, 67');
  assert.deepEqual(noteOns.map(e => e.time), [0, 1920, 3840], '4-beat, 4-beat, then 8-beat chord at 480 ticks/beat');

  const noteOffs = events.filter(e => e.type === 'note_off');
  assert.deepEqual(noteOffs.map(e => e.time), [1920, 3840, 7680], 'G (8 beats = 3840 ticks) should end at 3840+3840=7680');
});

test('a real chord shape encodes every fretted string at the correct pitch, muted strings excluded', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', {
    dependencies: deps + `\nfunction lookupEntryShape(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; }`, // open C major: x32010
  });
  const { events } = parseMidi(generateMidiBytes([{ rootIndex: 0, chordName: 'C', beats: 4, section: null }], 90));
  const notes = events.filter(e => e.type === 'note_on').map(e => e.note).sort((a, b) => a - b);
  assert.deepEqual(notes, [48, 52, 55, 60, 64], 'A(fret3)=48, D(fret2)=52, G(open)=55, B(fret1)=60, E(open)=64 -- low E string muted, correctly excluded');
});

test('a muted chord produces NO event of its own -- not even an inert placeholder -- and correctly advances the timeline', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: null, muted: false },
    { rootIndex: 5, chordName: 'F', beats: 4, section: null, muted: true },
    { rootIndex: 7, chordName: 'G', beats: 4, section: null, muted: false },
  ];
  const { events } = parseMidi(generateMidiBytes(prog, 90));
  assert.equal(events.filter(e => e.type === 'control_change').length, 0, 'no control_change or other placeholder event should exist for the muted chord');
  const noteOns = events.filter(e => e.type === 'note_on');
  assert.deepEqual(noteOns.map(e => e.note), [60, 67], 'F (muted) should be entirely absent, only C and G play');
  assert.deepEqual(noteOns.map(e => e.time), [0, 3840], 'G should start at 3840 -- 1920 for C + 1920 for the skipped-but-still-timed F');
});

test('a progression ending on a muted chord still has the correct total length', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: null, muted: false },
    { rootIndex: 5, chordName: 'F', beats: 4, section: null, muted: true },
  ];
  const { events } = parseMidi(generateMidiBytes(prog, 120));
  const endOfTrack = events.find(e => e.type === 'end_of_track');
  assert.equal(endOfTrack.time, 3840, 'total length must still reflect both chords\' duration (2 x 4 beats x 480 ticks), even though the second is silent');
});

test('soloing a chord that has no other layers in its own stack only affects that chord -- other chords elsewhere are unaffected (solo is stack-scoped, not global)', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: null, muted: false, solo: false },
    { rootIndex: 5, chordName: 'F', beats: 4, section: null, muted: false, solo: true },
    { rootIndex: 7, chordName: 'G', beats: 4, section: null, muted: false, solo: false },
  ];
  const { events } = parseMidi(generateMidiBytes(prog, 90));
  const noteOns = events.filter(e => e.type === 'note_on');
  assert.deepEqual(noteOns.map(e => e.note), [60, 65, 67], 'soloing F should not silence C or G -- solo only reaches inside F\'s own stack, and F has nothing else in it to silence');
});

test('soloing a lead layer on one chord silences that chord\'s own note (same stack), but does not touch any other chord', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: null, muted: false, solo: false },
    { rootIndex: 5, chordName: 'F', beats: 4, section: null, muted: false, solo: false,
      leadGrids: [{ id: 'bass-1', slots: [], solo: true }] }, // a soloed bass layer on F's own stack
    { rootIndex: 7, chordName: 'G', beats: 4, section: null, muted: false, solo: false },
  ];
  const { events } = parseMidi(generateMidiBytes(prog, 90));
  const noteOns = events.filter(e => e.type === 'note_on');
  assert.deepEqual(noteOns.map(e => e.note), [60, 67], 'F\'s own chord note should be silenced (something else in its stack is soloed and F itself is not), but C and G -- different stacks entirely -- must still play');
});

test('a section change emits a marker event at the correct time, including after a preceding muted chord', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const prog = [
    { rootIndex: 0, chordName: 'C', beats: 4, section: 'Verse', muted: false },
    { rootIndex: 5, chordName: 'F', beats: 4, section: 'Verse', muted: true },
    { rootIndex: 7, chordName: 'G', beats: 4, section: 'Chorus', muted: false },
  ];
  const { events } = parseMidi(generateMidiBytes(prog, 90));
  const markers = events.filter(e => e.type === 'marker');
  assert.deepEqual(markers.map(m => m.text), ['Verse', 'Chorus']);
  assert.equal(markers[0].time, 0);
  assert.equal(markers[1].time, 3840, 'the Chorus marker must account for the muted F chord\'s time too, not fire early');
});

test('a chord with no available shape falls back to a single root note rather than being silently dropped', () => {
  const generateMidiBytes = extractFunction('generateMidiBytes', { dependencies: deps + '\nfunction lookupEntryShape(){ return null; }' });
  const { events } = parseMidi(generateMidiBytes([{ rootIndex: 9, chordName: 'A', beats: 4, section: null }], 90));
  const noteOns = events.filter(e => e.type === 'note_on');
  assert.equal(noteOns.length, 1);
  assert.equal(noteOns[0].note, 69, 'root note for pitch class 9 (A) at middle-C-relative octave: 60+9=69');
});
