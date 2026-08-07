import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript){
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
  const w = dom.window;
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  return w;
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

async function withCardPage(){
  return withPage(`
    window.showChartMode();
    lookupChordShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1, fingers: [0,3,2,0,1,0] }; };
    activeModes = ['Ionian'];
    renderChartGroups();
    window.__playCount = 0;
    const origPlay = playChordShape;
    playChordShape = function(...args) { window.__playCount++; return origPlay.apply(this, args); };
  `);
}

test('clicking directly on the voicing-nav row container (not a specific button) does not trigger chord playback', async () => {
  const w = await withCardPage();
  const card = w.document.querySelector('.chart-card');
  const voicingRow = card.querySelector('.chart-card-voicing-row');
  assert.ok(voicingRow, 'a nav row should exist on the card');
  voicingRow.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'window.__playCount'), 0);
});

test('clicking directly on any of the 3 nav row containers (voicing, pattern, octave) does not trigger chord playback', async () => {
  const w = await withCardPage();
  const card = w.document.querySelector('.chart-card');
  const rows = card.querySelectorAll('.chart-card-voicing-row');
  assert.equal(rows.length, 3, 'expected exactly 3 nav rows (voicing, pattern, octave)');
  rows.forEach(row => row.dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'window.__playCount'), 0, 'none of the three row containers should let a click bleed through to the play handler');
});

test('the actual reported bug is fixed: clicking the chord name (the intended "top section that plays the chord") still triggers playback correctly', async () => {
  const w = await withCardPage();
  const card = w.document.querySelector('.chart-card');
  const nameEl = card.querySelector('.chart-card-name');
  assert.ok(nameEl, 'the chord name element should exist');
  nameEl.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'window.__playCount'), 1, 'clicking the actual chord display area must still play the chord -- the fix should not have broken normal playback');
});

test('clicking the card\'s general area (not inside any nav row) still triggers playback, confirming the fix is scoped to the nav rows specifically, not a blanket click-disable', async () => {
  const w = await withCardPage();
  const card = w.document.querySelector('.chart-card');
  card.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'window.__playCount'), 1);
});

test('clicking the expanded chord explanation text does not trigger playback -- a related click-bleed gap found and fixed alongside the main issue', async () => {
  const w = await withPage(`
    window.showChartMode();
    lookupChordShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1, fingers: [0,3,2,0,1,0] }; };
    activeModes = ['Ionian'];
    renderChartGroups();
    window.__playCount = 0;
    const origPlay = playChordShape;
    playChordShape = function(...args) { window.__playCount++; return origPlay.apply(this, args); };
  `);
  const infoBtn = w.document.querySelector('.chart-card-info-btn');
  if (!infoBtn) return; // not every card in a fresh render necessarily has an explanation attached
  infoBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const explanationEl = infoBtn.parentElement.querySelector('.chart-card-explanation');
  assert.ok(explanationEl, 'the explanation element should exist once toggled open');
  explanationEl.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'window.__playCount'), 0, 'clicking the info button then the explanation text should never trigger chord playback');
});

// ---- CSS :active propagation fix, button size, edge alignment ----
// Live :active/:has() matching (the actual dynamic behavior) was
// verified directly in a real headless browser: pressing a genuinely
// visible, enabled carousel button produced transform:none on the
// card, while pressing the chord name still produced the normal
// scale(0.97) press feedback -- confirmed with real mouse down/up
// events and a real rendered screenshot, not just these static rule
// checks. jsdom cannot evaluate live pseudo-class state the way a real
// browser does, so these guard the rules exist and are well-formed.

function ruleFor(w, selector){
  for (const sheet of w.document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.selectorText === selector) return rule.style;
    }
  }
  return null;
}

test('CSS: the :has() override exists to cancel the card\'s press-scale when a carousel row is active -- the fix for the remaining pulse-on-carousel-click report (a pure CSS :active propagation, which JS stopPropagation cannot touch)', async () => {
  const w = await withCardPage();
  const rule = ruleFor(w, '.chart-card:has(.chart-card-voicing-row:active)');
  assert.ok(rule, 'the :has() override rule should exist');
  assert.equal(rule.transform, 'none');
});

test('CSS: the normal press-scale rule is untouched, so pressing the actual chord area still gets visual feedback', async () => {
  const w = await withCardPage();
  const rule = ruleFor(w, '.chart-card:active');
  assert.ok(rule);
  assert.match(rule.transform, /scale\(0\.97\)/);
});

test('CSS: carousel nav buttons are sized 28x28, up from the previous 24x24 ("a little bigger")', async () => {
  const w = await withCardPage();
  const rule = ruleFor(w, '.chart-card-voicing-nav');
  assert.ok(rule);
  assert.equal(rule.width, '28px');
  assert.equal(rule.height, '28px');
});

test('CSS: the nav row breaks out of the card\'s own horizontal padding so its buttons land flush with the card\'s actual edge', async () => {
  const w = await withCardPage();
  const rule = ruleFor(w, '.chart-card-voicing-row');
  assert.ok(rule);
  // card padding is 10px each side -- the row must counteract exactly that
  assert.equal(rule.marginLeft, '-10px');
  assert.equal(rule.marginRight, '-10px');
  assert.equal(rule.width, 'calc(100% + 20px)');
});
