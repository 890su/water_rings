// Compare actual release code with source using identical inputs and randomness.
// Hash every Canvas command, including coordinates/styles, to detect physics/render drift.
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('index.html', root), 'utf8');
const release = await readFile(new URL('dist/index.html', root), 'utf8');
const script = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.equal(source.replace(/<script>[\s\S]*?<\/script>/, ''), release.replace(/<script>[\s\S]*?<\/script>/, ''));
assert.ok(!/sourceMappingURL|sourceURL/.test(script(release)));
assert.ok(!script(release).includes('function fluidStep'));

function play(code, mode, portrait, mobile) {
  let seed = 123456789, now = 0, raf, calls = 0;
  const hash = createHash('sha256');
  const record = (...args) => { hash.update(JSON.stringify(args)); calls++; };
  const gradient = { addColorStop: (...args) => record('addColorStop', ...args) };
  const ctx = new Proxy({}, {
    get: (obj, key) => key in obj ? obj[key] : (...args) => {
      record(key, ...args);
      if (String(key).startsWith('create')) return gradient;
      if (key === 'measureText') return { width: String(args[0]).length * 8 };
    },
    set: (obj, key, value) => { record('set', key, value); obj[key] = value; return true; }
  });
  const target = () => {
    const handlers = {}, classes = new Set();
    return {
      handlers, style: {}, dataset: {}, attributes: {}, textContent: '', innerHTML: '',
      setAttribute(k, v) { this.attributes[k] = v; },
      classList: {
        toggle: (k, on) => { if (on) classes.add(k); else classes.delete(k); },
        add: k => classes.add(k), remove: k => classes.delete(k)
      },
      addEventListener: (k, fn) => (handlers[k] ??= []).push(fn),
      getContext: () => ctx, setPointerCapture: () => {},
      fire(k, props = {}) { for (const fn of handlers[k] ?? []) fn({ preventDefault() {}, ...props }); }
    };
  };
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, target()); return elements.get(id); };
  const modes = ['classic', 'colors', 'waves'].map(m => { const b = el(m); b.dataset.mode = m; return b; });
  const window = Object.assign(target(), {
    innerWidth: mobile ? 390 : 1200, innerHeight: mobile ? 844 : 760, devicePixelRatio: 2,
    matchMedia: () => ({ matches: mobile }),
    screen: { orientation: { angle: 0, type: 'portrait-primary', addEventListener() {}, async lock() {} } }
  });
  const document = Object.assign(target(), {
    hidden: false, documentElement: {},
    getElementById: el,
    querySelectorAll: selector => ({
      '[data-mode]': modes, '.toMenu': [el('toMenu')],
      '.musicBtn': [el('music-menu'), el('music-pause')], '.sfxBtn': [el('sfx-menu'), el('sfx-pause')]
    })[selector] ?? []
  });
  const storage = new Map(portrait ? [['rings_field', 'portrait']] : []);
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const sandbox = createContext({
    window, document, screen: window.screen, navigator: {}, Math: math,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    performance: { now: () => now }, requestAnimationFrame: fn => { raf = fn; }
  });
  runInContext(code, sandbox, { timeout: 5000 });
  const frames = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; assert.equal(typeof raf, 'function'); raf(now); } };
  frames(3);
  el(mode).fire('click');
  el('c').fire('pointerdown', { pointerId: 1, clientX: 60, clientY: 740 });
  frames(12);
  el('c').fire('pointermove', { pointerId: 1, clientX: 60, clientY: 500 });
  frames(12);
  el('c').fire('pointerup', { pointerId: 1 });
  window.fire('keydown', { code: 'KeyL', shiftKey: true });
  window.fire('keydown', { code: 'KeyQ' });
  frames(12);
  window.fire('keyup', { code: 'KeyL' });
  window.fire('keyup', { code: 'KeyQ' });
  window.fire('keydown', { code: 'Space' });
  frames(12);
  el('pauseBtn').fire('click'); frames(3);
  el('music-pause').fire('click'); el('sfx-pause').fire('click');
  el('resumeBtn').fire('click'); frames(3);
  el('restartBtn').fire('click'); frames(3);
  if (mobile) {
    for (const angle of [90, 270, 0]) {
      window.screen.orientation.angle = angle;
      window.innerWidth = angle ? 844 : 390; window.innerHeight = angle ? 390 : 844;
      window.fire('resize'); frames(3);
      assert.ok(parseInt(el('root').style.width) > parseInt(el('root').style.height), 'Game must stay landscape');
    }
  }
  document.hidden = true; document.fire('visibilitychange'); frames(3);
  el('toMenu').fire('click'); frames(3);
  el('music-menu').fire('click'); el('sfx-menu').fire('click');
  el('howBtn').fire('click'); frames(3);
  return {
    hash: hash.digest('hex'), calls,
    ui: [...elements].map(([id, e]) => [id, e.textContent, e.innerHTML, e.style, e.attributes]),
    storage: [...storage]
  };
}

for (const mode of ['classic', 'colors', 'waves']) {
  for (const portrait of [false, true]) {
    for (const mobile of [false, true]) {
      assert.deepEqual(play(script(release), mode, portrait, mobile), play(script(source), mode, portrait, mobile));
      console.log(`PASS ${mode}, saved portrait ${portrait}, ${mobile ? 'touch + screen rotations' : 'desktop'}: identical rendering and UI`);
    }
  }
}
console.log('Release matches source in all 12 deterministic scenarios.');
