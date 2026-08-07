import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(){
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
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  return dom.window;
}

function ruleFor(w, selector){
  for (const sheet of w.document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.selectorText === selector) return rule.style;
    }
  }
  return null;
}

test('#leadMode and #drumsMode have min-width:0 -- regression guard for the flexbox overflow bug (flex children of main default to min-width:auto, which forces the whole page wider instead of letting the grid scroll internally)', async () => {
  const w = await withPage();
  assert.equal(ruleFor(w, '#leadMode').minWidth, '0px');
  assert.equal(ruleFor(w, '#drumsMode').minWidth, '0px');
});

test('the grid wrappers themselves also have min-width:0 alongside their existing overflow-x:auto', async () => {
  const w = await withPage();
  const leadWrap = ruleFor(w, '.lead-grid-wrap');
  const drumWrap = ruleFor(w, '.drum-grid-wrap');
  assert.equal(leadWrap.minWidth, '0px');
  assert.equal(leadWrap.overflowX, 'auto');
  assert.equal(drumWrap.minWidth, '0px');
  assert.equal(drumWrap.overflowX, 'auto');
});

test('.lead-grid-wrap has explicit width:100% -- regression guard for the actual root cause (confirmed via real browser layout testing, not just CSS presence): #leadMode uses align-items:center, so without an explicit width, a flex child sizes itself to its own content\'s natural width instead of filling the container, making overflow-x:auto meaningless since the box itself just grows rather than clipping/scrolling', async () => {
  const w = await withPage();
  assert.equal(ruleFor(w, '.lead-grid-wrap').width, '100%');
});

test('both Go to Progression buttons have the purple highlight class', async () => {
  const w = await withPage();
  assert.equal(w.document.getElementById('leadGoToProgressionBtn').classList.contains('go-to-progression-btn'), true);
  assert.equal(w.document.getElementById('drumGoToProgressionBtn').classList.contains('go-to-progression-btn'), true);
});

test('the purple highlight exactly matches the lead-chip\'s own purple gradient, not just a similar color', async () => {
  const w = await withPage();
  const goToProgRule = ruleFor(w, '.go-to-progression-btn');
  const leadChipRule = ruleFor(w, '.lead-chip');
  assert.equal(goToProgRule.background, leadChipRule.background, 'should be the exact same gradient, not an approximation');
});
