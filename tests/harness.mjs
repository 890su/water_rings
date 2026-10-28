// Стенд: игра в подменённом браузере с заданной случайностью. Отпечаток всех команд Canvas
// (с координатами и стилями) ловит любое расхождение физики или отрисовки.
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const scriptOf = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];

// 12 коротких сценариев (режим × сохранённое портретное поле × сенсорный ввод), 3 длинные партии по 30 с
// и «Волны» до конца (60 с) — партия завершается и сохраняет рекорд
export const SCENARIOS = [];
for (const mode of ['classic', 'colors', 'waves']) {
  for (const portrait of [false, true]) for (const mobile of [false, true]) SCENARIOS.push({ name: `${mode}, portrait ${portrait}, ${mobile ? 'touch' : 'desktop'}`, mode, portrait, mobile });
  SCENARIOS.push({ name: `${mode}, long 30 s`, mode, long: true });
}
SCENARIOS.push({ name: 'waves, to the end 62 s', mode: 'waves', long: true, seconds: 62 });

// Отпечаток интерфейса и хранилища после короткого сценария: тексты, стили, атрибуты, классы элементов и
// сохранённые рекорды. Порядок создания элементов и ключей не важен — сортируем
export function stateOf({ ui, storage }) {
  const canon = v => v && typeof v === 'object'
    ? Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
    : v;
  const byKey = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  return createHash('sha256').update(JSON.stringify(canon([[...ui].sort(byKey), [...storage].sort(byKey)]))).digest('hex');
}

// shrink — посреди партии окно сжимается до нуля (свёрнутая панель) и разворачивается обратно
export function play(code, { mode, portrait = false, mobile = false, long = false, seconds = 30, press, shrink = false }, probe) {
  let seed = 123456789, now = 0, raf, calls = 0;
  const hash = createHash('sha256');
  const record = (...args) => { hash.update(JSON.stringify(args)); calls++; };
  const gradient = { addColorStop: (...args) => record('addColorStop', ...args) };
  const ctx = new Proxy({}, {
    get: (obj, key) => key in obj ? obj[key] : (...args) => {
      record(key, ...args);
      // Как в браузере: отрицательный радиус дуги — исключение IndexSizeError
      if ((key === 'arcTo' && args[4] < 0) || (key === 'arc' && args[2] < 0)) throw new RangeError(`${key}: negative radius ${args[key === 'arc' ? 2 : 4]}`);
      if (String(key).startsWith('create')) return gradient;
      if (key === 'measureText') return { width: String(args[0]).length * 8 };
    },
    set: (obj, key, value) => { record('set', key, value); obj[key] = value; return true; }
  });
  const target = () => {
    const handlers = {}, classes = new Set();
    return {
      handlers, classes, style: {}, dataset: {}, attributes: {}, textContent: '', innerHTML: '',
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
  const uiState = () => ({
    ui: [...elements].map(([id, e]) => [id, e.textContent, e.innerHTML, e.style, e.attributes, [...e.classes].sort()]),
    storage: [...storage]
  });
  runInContext(code, sandbox, { timeout: 5000 });
  const frames = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; assert.equal(typeof raf, 'function'); raf(now); } };
  frames(3);
  el(mode).fire('click');
  if (long) {
    // Длинная партия: каждые period кадров нажатие на hold кадров; насос и высота касания (доля высоты окна) — по кругу.
    // По умолчанию: насосы по очереди, каждые 40 кадров на 25 кадров, высота 0,25 / 0,6 / 0,9
    const { period = 40, hold = 25, heights = [0.25, 0.6, 0.9], sides = [0, 1] } = press ?? {};
    for (let f = 0, k = 0; f < seconds * 60; f++) {
      if (f % period === 0) {
        const side = sides[k % sides.length], h = heights[k % heights.length];
        el('c').fire('pointerdown', { pointerId: 9, clientX: side ? window.innerWidth - 60 : 60, clientY: window.innerHeight * (1 - h) });
        k++;
      }
      if (f % period === hold) el('c').fire('pointerup', { pointerId: 9 });
      frames(1);
    }
    // probe — выражение, вычисляемое в песочнице после партии (для исследования исходной версии; эталоны его не используют)
    if (probe) return { hash: hash.digest('hex'), calls, probe: runInContext(probe, sandbox) };
    return { hash: hash.digest('hex'), calls, ...uiState() };
  }
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
  if (shrink) {
    const was = [window.innerWidth, window.innerHeight];
    window.innerWidth = window.innerHeight = 0; window.fire('resize'); frames(3);
    [window.innerWidth, window.innerHeight] = was; window.fire('resize'); frames(3);
  }
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
  return { hash: hash.digest('hex'), calls, ...uiState() };
}
