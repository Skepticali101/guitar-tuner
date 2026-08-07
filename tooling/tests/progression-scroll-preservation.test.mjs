import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

// The bug this guards against: the progression tray's chips don't scroll
// inside the outer #progressionRow element -- they live in an inner,
// dynamically-created .progression-row div (one per section, or one
// shared row with none), which gets fully destroyed and rebuilt on
// every edit. An earlier fix preserved only the OUTER container's
// scrollLeft, which was never the element actually scrolling, so the
// tray kept visibly snapping back to the start on every mute/solo/
// mod-change/etc. This test drives the real UI end-to-end and checks
// the real (new, rebuilt) inner row's scrollLeft, not just that code
// runs without throwing.
async function withRenderedProgression(setupScript, testFn){
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
      window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
      const store = {};
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        configurable: true,
      });
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  const w = dom.window;
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  await testFn(w);
}

function getInnerRow(w){
  return w.document.getElementById('progressionRow').querySelector('.progression-row');
}

async function assertScrollPreserved(w, action){
  const innerRow = getInnerRow(w);
  innerRow.scrollLeft = 250; // simulate the user having scrolled right before the action
  await action(w);
  await new Promise(r => setTimeout(r, 30));
  const newInnerRow = getInnerRow(w); // re-query -- the row was destroyed and rebuilt, this is a different element
  assert.equal(newInnerRow.scrollLeft, 250, 'the actual scrolling inner row should keep its position, not snap back to the start');
}

const THREE_CHORD_SETUP = `
  setProgression([
    { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
    { rootIndex: 2, suffix: 'm', label: 'ii', modeName: 'Ionian', chordName: 'Dm', beats: 4, strumPattern: 'block' },
    { rootIndex: 4, suffix: 'm', label: 'iii', modeName: 'Ionian', chordName: 'Em', beats: 4, strumPattern: 'block' },
  ]);
`;

test('scroll position survives clicking Mute', async () => {
  await withRenderedProgression(THREE_CHORD_SETUP, async (w) => {
    await assertScrollPreserved(w, (w) => {
      w.document.querySelectorAll('.progression-chip')[1].querySelector('.progression-chip-mute').dispatchEvent(new w.Event('click'));
    });
  });
});

test('scroll position survives clicking Solo', async () => {
  await withRenderedProgression(THREE_CHORD_SETUP, async (w) => {
    await assertScrollPreserved(w, (w) => {
      w.document.querySelectorAll('.progression-chip')[1].querySelector('.progression-chip-solo').dispatchEvent(new w.Event('click'));
    });
  });
});

test('scroll position survives changing a chip\'s chord-type (mod) selector', async () => {
  await withRenderedProgression(THREE_CHORD_SETUP, async (w) => {
    await assertScrollPreserved(w, (w) => {
      const chip = w.document.querySelectorAll('.progression-chip')[1];
      chip.querySelector('.progression-chip-mod').dispatchEvent(new w.Event('change'));
    });
  });
});

test('scroll position survives changing a lead layer\'s own instrument (the grid-lead chip\'s tone selector)', async () => {
  const setupWithLead = `
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
      { rootIndex: 2, suffix: 'm', label: 'ii', modeName: 'Ionian', chordName: 'Dm', beats: 4, strumPattern: 'block' },
    ]);
  `;
  await withRenderedProgression(setupWithLead, async (w) => {
    await assertScrollPreserved(w, (w) => {
      const toneSelect = w.document.querySelector('.grid-lead-chip-tone-select');
      toneSelect.value = 'rhodes';
      toneSelect.dispatchEvent(new w.Event('change'));
    });
  });
});

test('Duplicate still correctly jumps to show the new chip -- the scroll-preservation fix must not break this intentional exception', async () => {
  await withRenderedProgression(
    `setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);`,
    async (w) => {
      w.document.querySelector('.progression-chip-duplicate').dispatchEvent(new w.Event('click'));
      await new Promise(r => setTimeout(r, 30));
      const check = w.document.createElement('script');
      check.textContent = `window.__progLen = progression.length;`;
      w.document.body.appendChild(check);
      assert.equal(w.__progLen, 2, 'duplicate should still actually duplicate the chord');
    }
  );
});
