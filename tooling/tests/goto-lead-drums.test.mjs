import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript){
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};
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
  return { w, errors };
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

test('Go to Drums (from Lead) switches to Drums mode without error', async () => {
  const { w, errors } = await withPage('showLeadMode();');
  w.document.getElementById('leadGoToDrumsBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'currentActiveMode'), 'drums');
  const realErrors = errors.filter(e => !/fonts\.googleapis|AudioContext/.test(e.message || ''));
  assert.equal(realErrors.length, 0, 'no unexpected errors: ' + realErrors.map(e => e.message).join('; '));
});

test('Go to Lead (from Drums) switches to Lead mode without error', async () => {
  const { w, errors } = await withPage('showDrumsMode();');
  w.document.getElementById('drumGoToLeadBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'currentActiveMode'), 'lead');
  const realErrors = errors.filter(e => !/fonts\.googleapis|AudioContext/.test(e.message || ''));
  assert.equal(realErrors.length, 0, 'no unexpected errors: ' + realErrors.map(e => e.message).join('; '));
});
