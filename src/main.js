'use strict';
import { P } from './core/params.js';
import { field, W, H, NX, NY, SX, NCELLS, PEG_TIP, PEG_BOTTOM, JET_LEN, FLOOR, pegs, nozzles, setField, floorY, mkNozzle, shade, clamp } from './core/field.js';
import { u, v, u0, v0, pr, dv, curl, IX, setBnd, project, advect, vorticity, blockRect, pegWake, fluidStep, resetFluid, sample } from './core/fluid.js';
import { makePump, pumps, updatePump, inject, shelfShade, suck, resetPumps } from './core/pumps.js';
import { grav, shake, motion, screenAxes, onMotion, enableMotion, resetMotion, swirl, updateMotion } from './core/motion.js';
import { bubbles, sparks, specks, burst, updateFx, initSpecks } from './core/fx.js';
import { hooks } from './core/hooks.js';
import { G } from './core/state.js';
import { PALETTE, DUO, world, makeRing, updateDepth, engaged, phiRest, zLim, spawnRings, integrateRing, collideStatic, holeHasPeg, flopRing, updateThread, SEG, segParams, pushRing, narrowRing, shiftZ, ringPair, collidePegs, physics, updateSpin, checkThreads } from './core/rings.js';
import { actx, sfxBus, musicOn, sfxOn, audioVoices, MUSIC_STEP, MUSIC_NOTES, MUSIC_CHORDS, noteHz, soundRandom, initAudio, stopVoices, audioScene, audioTone, bubbleSound, soundCue, toggleSound, audioUpdate } from './audio.js';

setField(P.START_FIELD);
initSpecks();
// Угол игрового кадра для датчиков наклона: на телефоне кадр привязан к корпусу, на компьютере — к экрану
motion.angle = () => (touchDevice() ? gameAngle : screenAngle());
// Ядро колец сообщает о надетом кольце — звук и искры
hooks.playing = () => G.state === 'play';
hooks.onThreaded = R => {
  const good = G.mode !== 'colors' || R.on === R.ci;
  soundCue(good ? 'ring' : 'wrong');
  burst((R.a.x + R.b.x) / 2, (R.a.y + R.b.y) / 2, good ? R.col : '#ffffff', 8);
};



// ---------- Режимы и игра ----------
const MODES = {
  classic: { name: 'Классика' },
  colors: { name: 'Два цвета' },
  waves: { name: 'Волны' }
};
// Состояние партии — в src/core/state.js (G)

function toast(t) { G.toastText = t; G.toastT = 1.8; }


function startGame(m) {
  G.mode = m; initAudio(); resetFluid(); resetPumps(); resetMotion();
  if (motion.on) enableMotion();
  // Как держат телефон при старте — так кадр и закрепляем
  if (touchDevice()) { pickGameAngle(); layout(); lockScreen(); }
  world.rings = []; bubbles.length = 0; sparks.length = 0;
  G.game = { t: 0, left: 0, score: 0, wave: 1, hold: 0, presses: 0 };
  if (m === 'classic') { spawnRings(8, P.RING_D, false); toast('Надень все кольца'); }
  else if (m === 'colors') { G.game.left = 90; spawnRings(8, P.RING_D - 2, true); toast('Красные — влево, синие — вправо'); }
  else { G.game.left = 60; spawnWave(); toast('Волна 1'); }
  G.state = 'play';
  if (!tutSeen() || tut.force) tutStart();
  show(null);
  soundCue('start');
}

// ---------- Подсказка для первой игры ----------
// Поверх игры, ничего не блокирует: две блеклые полоски — зоны насосов (снизу слабо, сверху сильно),
// и палец показывает: нажми слева, веди вверх — струя сильнее; потом справа. Гаснет сама,
// когда игрок нажал по паре раз каждым насосом, и больше не показывается
// done — на случай, если хранилище недоступно (приватный режим): тогда хотя бы до перезагрузки не повторяем
const tut = { on: false, a: 0, t: 0, presses: [0, 0], force: false, done: false };
function tutSeen() { try { return tut.done || localStorage.getItem('rings_tut') === '1'; } catch (e) { return tut.done; } }
function tutStart() { Object.assign(tut, { on: true, a: 0, t: 0, presses: [0, 0], force: false }); }
function tutUpdate(dt) {
  if (!tut.on) return;
  tut.t += dt;
  const done = tut.presses[0] >= 2 && tut.presses[1] >= 2;
  tut.a = clamp(tut.a + (done ? -dt / 0.6 : dt / 0.5), 0, 1);
  if (done && tut.a <= 0) { tut.on = false; tut.done = true; try { localStorage.setItem('rings_tut', '1'); } catch (e) { } }
}

function spawnWave() {
  const n = Math.min(10, 4 + G.game.wave), D = Math.max(P.RING_D - 12, P.RING_D + 2 - 3 * (G.game.wave - 1));
  spawnRings(n, D, false);
}

function gameLogic(dt) {
  G.game.t += dt;
  if (G.mode === 'classic') {
    G.game.hold = world.rings.every(r => r.on >= 0) ? G.game.hold + dt : 0;
    if (G.game.hold > 1) {
      const best = getBest('classic'), rec = best == null || G.game.t < best;
      if (rec) setBest('classic', G.game.t);
      endGame('Готово!', `Время: ${G.game.t.toFixed(1)} с · нажатий: ${G.game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best.toFixed(1)} с`);
    }
  } else if (G.mode === 'colors') {
    G.game.left -= dt;
    const good = world.rings.filter(r => r.on === r.ci).length;
    G.game.hold = good === world.rings.length ? G.game.hold + dt : 0;
    if (G.game.hold > 1) {
      const best = getBest('colors'), rec = best == null || G.game.left > best;
      if (rec) setBest('colors', G.game.left);
      endGame('Победа!', `Осталось времени: ${G.game.left.toFixed(1)} с · нажатий: ${G.game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best.toFixed(1)} с в запасе`);
    } else if (G.game.left <= 0) {
      G.game.left = 0;
      endGame('Время вышло', `Правильно надето: ${good} из ${world.rings.length} · нажатий: ${G.game.presses}`, '');
    }
  } else {
    G.game.left -= dt;
    G.game.hold = world.rings.every(r => r.on >= 0) ? G.game.hold + dt : 0;
    if (G.game.hold > 0.6) {
      for (const R of world.rings) burst((R.a.x + R.b.x) / 2, (R.a.y + R.b.y) / 2, R.col, 6);
      G.game.score += world.rings.length;
      G.game.wave++; G.game.left += 12; G.game.hold = 0;
      world.rings = []; spawnWave(); soundCue('wave');
      toast(`Волна ${G.game.wave}  +12 с`);
    } else if (G.game.left <= 0) {
      G.game.left = 0;
      const total = G.game.score + world.rings.filter(r => r.on >= 0).length;
      const best = getBest('waves'), rec = best == null || total > best;
      if (rec) setBest('waves', total);
      endGame('Время вышло', `Колец надето: ${total} · дошёл до волны ${G.game.wave} · нажатий: ${G.game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best} колец`);
    }
  }
}

function endGame(title, text, best) {
  G.state = 'over';
  resetPumps();
  document.getElementById('resTitle').textContent = title;
  document.getElementById('resText').textContent = text;
  document.getElementById('resBest').textContent = best;
  show('result');
  soundCue(title === 'Готово!' || title === 'Победа!' ? 'win' : 'end');
}

// Хранилище бывает недоступно (приватный режим, встроенные браузеры) — тогда просто без рекордов
function getBest(m) {
  let v = null;
  try { v = localStorage.getItem('rings_best_' + m); } catch (e) { }
  return v == null ? null : +v;
}
function setBest(m, v) { try { localStorage.setItem('rings_best_' + m, String(v)); } catch (e) { } }

function refreshBest() {
  const c = getBest('classic'), k = getBest('colors'), w = getBest('waves');
  document.getElementById('best-classic').textContent = c == null ? 'Надень все 8 колец на скорость' : `Рекорд: ${c.toFixed(1)} с`;
  document.getElementById('best-colors').textContent = k == null ? 'Каждый цвет — на свой столбик за 90 с' : `Рекорд: ${k.toFixed(1)} с в запасе`;
  document.getElementById('best-waves').textContent = w == null ? 'Кольца всё меньше, а их всё больше' : `Рекорд: ${w} колец`;
}

let demoT = 1;
function demo(dt) {
  demoT -= dt;
  if (demoT > 0) return;
  const p = pumps[Math.random() < 0.5 ? 0 : 1];
  if (!p.held) { p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.2 + Math.random() * 0.5; }
  demoT = 0.6 + Math.random() * 1.6;
}

function tick(dt) {
  if (G.state === 'menu') demo(dt);
  updateMotion(dt);
  updatePump(pumps[0], dt); updatePump(pumps[1], dt);
  inject(0); inject(1);
  fluidStep(dt);
  for (let i = 0; i < P.SUB; i++) physics(dt / P.SUB);
  checkThreads(dt);
  updateFx(dt);
  if (G.state === 'play') { gameLogic(dt); tutUpdate(dt); }
  if (G.toastT > 0) G.toastT -= dt;
}

// ---------- Экран и управление ----------
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
let sw = 0, sh = 0, dpr = 1, S = 1, tankX = 0, tankY = 0, tankW = 0, tankH = 0, hudH = 52, wide = false, wasLand = null;
let safeL = 0, safeT = 0, safeR = 0, safeB = 0;
const PAD = 8, GAUGE_W = 16;

// ---------- Ориентация ----------
// gameAngle — как стоит игровой кадр относительно «родной» ориентации устройства (в смысле screen.orientation.angle).
// Всегда основная альбомная ориентация, без переключения поля.
// низ остаётся у того же края корпуса. Если браузер сам повернул экран, кадр поворачиваем обратно на rot.
// На компьютере (без касаний) не поворачиваем ничего
const root = document.getElementById('root');
let gameAngle = 0, rot = 0;
// Телефон или планшет — основной ввод пальцем. Сенсорный ноутбук или встроенный браузер с касаниями сюда не попадают
const touchDevice = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function screenAngle() {
  const o = window.screen && window.screen.orientation;
  return (((o ? o.angle : window.orientation) || 0) % 360 + 360) % 360;
}
function pickGameAngle() {
  const a = screenAngle(), natLand = a % 180 === 0 ? window.innerWidth > window.innerHeight : window.innerWidth <= window.innerHeight;
  gameAngle = natLand ? 0 : 90;
}
// Координаты касания из окна браузера — в игровой кадр
function toRoot(e) {
  const vw = window.innerWidth, vh = window.innerHeight, x = e.clientX, y = e.clientY;
  return rot === 90 ? [y, vw - x] : rot === 180 ? [vw - x, vh - y] : rot === 270 ? [vh - y, x] : [x, y];
}
// Приложение для Android (Capacitor): модули доступны через Capacitor.Plugins, в браузере их нет
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plug = name => (native && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

// Закрепляем основную альбомную ориентацию: в приложении — нативно (кадр поворачивать не нужно),
// в браузере на Android — через полноэкранный режим, если он поддерживает блокировку.
async function lockScreen() {
  const so = plug('ScreenOrientation');
  if (so) { try { await so.lock({ orientation: 'landscape-primary' }); } catch (e) { } return; }
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape-primary');
  } catch (e) { }
}

// В портрете сверху полоса со счётом; в ландшафте аквариум во всю высоту, а счёт — по бокам от него
function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  pickGameAngle();
  if (native) { gameAngle = screenAngle(); rot = 0; }
  else rot = touchDevice() ? ((gameAngle - screenAngle()) % 360 + 360) % 360 : 0;
  const side = rot === 90 || rot === 270;
  sw = side ? vh : vw; sh = side ? vw : vh;
  root.style.width = sw + 'px'; root.style.height = sh + 'px';
  root.classList.toggle('short', sh < 520);
  root.style.transform = rot === 90 ? `translate(${vw}px,0) rotate(90deg)` : rot === 180 ? `translate(${vw}px,${vh}px) rotate(180deg)`
    : rot === 270 ? `translate(0,${vh}px) rotate(270deg)` : '';
  canvas.width = Math.round(sw * dpr); canvas.height = Math.round(sh * dpr);
  canvas.style.width = sw + 'px'; canvas.style.height = sh + 'px';
  // Вырез под камеру: приложение рисует весь экран, а счёт, колбы и аквариум держим вне выреза.
  // Размеры выреза присылает Android (MainActivity), в браузере их нет
  const si = (native && window.__safeInsets) || {};
  safeL = si.l || 0; safeT = si.t || 0; safeR = si.r || 0; safeB = si.b || 0;
  if (native) { root.style.setProperty('--safe-l', safeL + 'px'); root.style.setProperty('--safe-r', safeR + 'px'); }
  const uw = sw - safeL - safeR, uh = sh - safeT - safeB;
  wide = (uw - (uh - 2 * PAD) * W / H) / 2 >= 72;
  hudH = wide ? 0 : clamp(uh * 0.07, 48, 64);
  const availW = uw - 2 * PAD, availH = uh - hudH - 2 * PAD;
  S = Math.min(availW / W, availH / H);
  tankW = W * S; tankH = H * S;
  tankX = safeL + (uw - tankW) / 2; tankY = safeT + hudH + (availH - tankH) / 2 + PAD;
  pauseBtn.style.left = (wide ? sw - safeR - PAD - GAUGE_W - 10 - 44 : safeL + uw / 2 + 44) + 'px';
  pauseBtn.style.top = safeT + (wide ? PAD : Math.max(2, (hudH - 44) / 2 + 2)) + 'px';
  // Телефон повернули — наклон отсчитываем заново от нового положения
  const land = sw > sh;
  if (wasLand !== null && land !== wasLand) motion.m0 = motion.z0 = null;
  wasLand = land;
}

// Левая/правая половина экрана; чем выше касание, тем сильнее струя. Шкала силы — вся высота кадра.
function strengthFromY(y) {
  return 0.18 + 0.82 * clamp((sh - y) / sh, 0, 1);
}

function press(side, y, id, strong) {
  const p = pumps[side];
  p.held = true; p.id = id; p.auto = 0; p.boost = 0;
  p.y = p.lastY = y == null ? 0 : y; p.lastT = performance.now();
  p.base = y == null ? (strong ? 1 : 0.65) : strengthFromY(y);
  const ms = 6 + Math.round(p.base * 24), hap = plug('Haptics');
  if (hap) hap.vibrate({ duration: ms }).catch(() => { });
  else if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { }
  bubbleSound(side, p.base);
  if (G.state === 'play') { G.game.presses++; if (tut.on) tut.presses[side]++; }
}
function release(side) {
  if (pumps[side].held) bubbleSound(side, 0.3, true);
  pumps[side].held = false; pumps[side].id = null;
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  initAudio();
  const [x, y] = toRoot(e);
  if (G.state !== 'play') return;
  press(x < sw / 2 ? 0 : 1, y, e.pointerId);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
}, { passive: false });

canvas.addEventListener('pointermove', e => {
  for (let s = 0; s < 2; s++) {
    const p = pumps[s];
    if (!p.held || p.id !== e.pointerId) continue;
    const y = toRoot(e)[1], now = performance.now(), vy = (y - p.lastY) / Math.max(1, now - p.lastT) * 1000;
    if (vy < -400) p.boost = Math.min(0.4, Math.max(p.boost, (-vy - 400) / 2500));
    p.y = p.lastY = y; p.lastT = now;
    p.base = strengthFromY(y);
  }
});
const endPointer = e => { for (let s = 0; s < 2; s++) if (pumps[s].id === e.pointerId) release(s); };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

const KEYS = { KeyA: 0, ArrowLeft: 0, KeyL: 1, ArrowRight: 1 };
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.state === 'play') pauseGame(); else if (G.state === 'pause') resumeGame(); return; }
  // Без телефона: Q / E — наклон, пробел — стукнуть по аквариуму снизу
  if (e.code === 'KeyQ' || e.code === 'KeyE') { motion.keyTilt = e.code === 'KeyQ' ? -1 : 1; return; }
  if (e.code === 'Space') { e.preventDefault(); shake.x = (Math.random() - 0.5) * 1600; shake.y = -4000;
    if (G.state === 'play') { initAudio(); bubbleSound(0, 1); bubbleSound(1, 1); } return; }
  const s = KEYS[e.code];
  if (s === undefined || e.repeat || G.state !== 'play') return;
  initAudio();
  press(s, null, 'key', e.shiftKey);
});
window.addEventListener('keyup', e => {
  if ((e.code === 'KeyQ' && motion.keyTilt < 0) || (e.code === 'KeyE' && motion.keyTilt > 0)) motion.keyTilt = 0;
  const s = KEYS[e.code]; if (s !== undefined && pumps[s].id === 'key') release(s);
});

// ---------- Меню ----------
const overlays = { menu: document.getElementById('menu'), pause: document.getElementById('pause'), result: document.getElementById('result') };
const pauseBtn = document.getElementById('pauseBtn');
function show(name) {
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== name);
  pauseBtn.classList.toggle('hidden', G.state !== 'play');
  if (name === 'menu') refreshBest();
  audioScene();
}
function pauseGame() { if (G.state !== 'play') return; G.state = 'pause'; resetPumps(); show('pause'); }
function resumeGame() { initAudio(); G.state = 'play'; show(null); }
function toMenu() { G.state = 'menu'; resetFluid(); resetPumps(); world.rings = []; spawnRings(8, P.RING_D, false); show('menu'); }

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.mode)));
document.querySelectorAll('.toMenu').forEach(b => b.addEventListener('click', toMenu));
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartBtn').addEventListener('click', () => startGame(G.mode));
document.getElementById('againBtn').addEventListener('click', () => startGame(G.mode));
pauseBtn.addEventListener('click', pauseGame);
document.getElementById('howBtn').addEventListener('click', () => { tut.force = true; startGame('classic'); });

// Кадр повёрнут относительно экрана (телефон с выключенным автоповоротом) — браузер прокручивал бы меню
// поперёк пальца. Тогда прокручиваем сами, переводя сдвиг пальца в координаты кадра
for (const o of Object.values(overlays)) {
  let lastY = null;
  o.addEventListener('touchstart', e => { lastY = rot ? toRoot(e.touches[0])[1] : null; }, { passive: true });
  o.addEventListener('touchmove', e => {
    if (lastY === null) return;
    const y = toRoot(e.touches[0])[1];
    o.scrollTop -= y - lastY; lastY = y;
    e.preventDefault();
  }, { passive: false });
  o.addEventListener('touchend', () => { lastY = null; });
}

const tiltBtn = document.getElementById('tiltBtn');
try { motion.on = localStorage.getItem('rings_tilt') !== '0'; } catch (e) { }
function refreshTilt() { tiltBtn.textContent = `Наклон и тряска: ${motion.on ? 'вкл' : 'выкл'}`; }
if (window.DeviceMotionEvent && touchDevice()) tiltBtn.classList.remove('hidden');
tiltBtn.addEventListener('click', () => {
  motion.on = !motion.on;
  try { localStorage.setItem('rings_tilt', motion.on ? '1' : '0'); } catch (e) { }
  if (motion.on) enableMotion(); else resetMotion();
  refreshTilt();
});
refreshTilt();
function refreshSoundButtons() {
  for (const [selector, label, on] of [['.musicBtn', 'Музыка', musicOn], ['.sfxBtn', 'Звуки', sfxOn]]) {
    document.querySelectorAll(selector).forEach(b => {
      b.textContent = `${label}: ${on ? 'вкл' : 'выкл'}`;
      b.setAttribute('aria-pressed', String(on));
    });
  }
}
for (const [selector, key] of [['.musicBtn', 'rings_music'], ['.sfxBtn', 'rings_sfx']]) {
  document.querySelectorAll(selector).forEach(b => b.addEventListener('click', () => {
    initAudio();
    toggleSound(key);
    try { localStorage.setItem(key, (key === 'rings_music' ? musicOn : sfxOn) ? '1' : '0'); } catch (_) { }
    if (!sfxOn) stopVoices(sfxBus);
    refreshSoundButtons(); audioScene();
  }));
}
refreshSoundButtons();
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); audioScene(); });

// Кнопка «Назад» в приложении: в игре — пауза, на паузе — продолжить, после партии — в меню, в меню — свернуть
const appPlug = plug('App');
if (appPlug) {
  appPlug.addListener('backButton', () => {
    if (G.state === 'play') pauseGame();
    else if (G.state === 'pause') resumeGame();
    else if (G.state === 'over') toMenu();
    else appPlug.minimizeApp();
  });
  appPlug.addListener('appStateChange', s => { if (!s.isActive) pauseGame(); });
}

['orientationchange', 'resize'].forEach(ev => window.addEventListener(ev, layout));
if (window.screen && screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', layout);

// ---------- Отрисовка ----------
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRing(R, front) {
  const a = R.a, b = R.b, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.cos(ang) < 0) ang += Math.PI;
  const s = Math.sin(R.phi), rx = R.D / 2, ry = rx * Math.max(0.07, Math.abs(s));
  const a0 = (front ? 0 : Math.PI) + (s < 0 ? Math.PI : 0);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, ang, a0, a0 + Math.PI);
  ctx.lineWidth = P.RIM * 2; ctx.strokeStyle = front ? R.col : R.dark; ctx.stroke();
  if (front) {
    const sg = s < 0 ? -1 : 1, ox = Math.sin(ang) * P.RIM * 0.4 * sg, oy = -Math.cos(ang) * P.RIM * 0.4 * sg;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rx, ry, ang, a0 + 0.35, a0 + Math.PI - 0.35);
    ctx.lineWidth = P.RIM * 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
  }
}

function render(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, sh);
  bg.addColorStop(0, '#ff6b5b'); bg.addColorStop(1, '#b52a28');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, sw, sh);

  // аквариум
  ctx.save();
  ctx.translate(tankX, tankY); ctx.scale(S, S);
  rr(0, 0, W, H, 18); ctx.clip();
  const wg = ctx.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, '#8fe0ff'); wg.addColorStop(1, '#1d6fd6');
  ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

  const tm = now / 1000;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < W / 120; i++) {
    const x0 = 40 + i * 120 + Math.sin(tm * 0.4 + i * 2) * 30;
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 40, 0); ctx.lineTo(x0 - 60, H); ctx.lineTo(x0 - 130, H); ctx.closePath(); ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const s of specks) ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);

  ctx.beginPath(); ctx.moveTo(0, H);
  for (const [x, y] of FLOOR) ctx.lineTo(x, y);
  ctx.lineTo(W, H); ctx.closePath();
  const fg = ctx.createLinearGradient(0, H - 60, 0, H);
  fg.addColorStop(0, '#f4f7fb'); fg.addColorStop(1, '#b9c6d8');
  ctx.fillStyle = fg; ctx.fill();

  for (const g of pegs) {
    const fy = floorY(g.x);
    ctx.fillStyle = 'rgba(20,50,100,0.35)'; rr(g.x - 5, g.bottom, 10, fy - g.bottom + 4, 3); ctx.fill();
  }

  // Рисуем по глубине: дальние половины колец, штыри посередине (z = 0), ближние половины
  ctx.lineCap = 'butt';
  const layers = [];
  for (let k = 0; k < pegs.length; k++) layers.push({ z: 0, k });
  for (const R of world.rings) layers.push({ z: R.z - R.hz / 2, R, front: false }, { z: R.z + R.hz / 2, R, front: true });
  layers.sort((p, q) => p.z - q.z);
  for (const it of layers) {
    if (it.R) { drawRing(it.R, it.front); continue; }
    const k = it.k, g = pegs[k];
    const pg = ctx.createLinearGradient(g.x - P.PEG_R, 0, g.x + P.PEG_R, 0);
    pg.addColorStop(0, '#8d9bb0'); pg.addColorStop(0.4, '#ffffff'); pg.addColorStop(1, '#7a879b');
    ctx.fillStyle = pg; rr(g.x - P.PEG_R, g.tip - P.PEG_R, P.PEG_R * 2, g.bottom - g.tip + P.PEG_R, P.PEG_R); ctx.fill();
    ctx.fillStyle = '#dfe6ef'; rr(g.x - P.SHELF_W / 2, g.bottom - 3, P.SHELF_W, 7, 3.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(g.x - P.SHELF_W / 2, g.bottom + 1, P.SHELF_W, 3, 1.5); ctx.fill();
    if (G.mode === 'colors' && G.state !== 'menu') {
      ctx.beginPath(); ctx.arc(g.x, g.tip, P.PEG_R + 2.5, 0, Math.PI * 2); ctx.fillStyle = DUO[k]; ctx.fill();
    }
  }

  for (const n of nozzles) {
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.atan2(n.dy, n.dx) + Math.PI / 2);
    ctx.fillStyle = '#2b3a55'; rr(-8, -4, 16, 16, 4); ctx.fill();
    ctx.fillStyle = '#111a2b'; rr(-4, -6, 8, 6, 2); ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }

  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, s.life / 0.6);
    ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.13)'; rr(10, 14, 10, H - 28, 5); ctx.fill();
  ctx.restore();

  rr(tankX - 4, tankY - 4, tankW + 8, tankH + 8, 18 * S + 4);
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();

  if (G.state === 'play' || G.state === 'pause') drawHud();
  if (tut.on && G.state === 'play') drawTutorial();

  if (G.toastT > 0 && G.state === 'play') {
    ctx.globalAlpha = Math.min(1, G.toastT / 0.4);
    ctx.font = `800 ${Math.round(clamp(tankW * 0.075, 18, 30))}px system-ui`; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,40,90,0.6)'; ctx.fillStyle = '#fff';
    ctx.strokeText(G.toastText, sw / 2, tankY + tankH * 0.3); ctx.fillText(G.toastText, sw / 2, tankY + tankH * 0.3);
    ctx.globalAlpha = 1;
  }
}

// Насос в углу: колба с водой — сколько её осталось в насосе. Пока жмёшь — светлеет и убывает,
// отпустил — быстро набирается; почти пустая краснеет
function drawPump(p, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(x, y, w, h, w / 2); ctx.fill();
  const ih = h - 4, fh = Math.max(0, ih * p.stroke);
  if (fh > 0.5) {
    ctx.fillStyle = p.stroke < 0.2 ? '#ff8a7a' : p.flow > 0.05 ? '#e6fbff' : '#6fd6ff';
    rr(x + 2, y + 2 + ih - fh, w - 4, fh, (w - 4) / 2); ctx.fill();
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; rr(x, y, w, h, w / 2); ctx.stroke();
}

function drawHud() {
  const gh = wide ? 72 : hudH - 14, gy = safeT + (wide ? PAD : 7), gl = safeL + PAD, gr = sw - safeR - PAD - GAUGE_W;
  drawPump(pumps[0], gl, gy, GAUGE_W, gh);
  drawPump(pumps[1], gr, gy, GAUGE_W, gh);
  let score;
  if (G.mode === 'colors') score = `${world.rings.filter(r => r.on === r.ci).length}/${world.rings.length}`;
  else if (G.mode === 'waves') score = `${G.game.score + world.rings.filter(r => r.on >= 0).length}`;
  else score = `${world.rings.filter(r => r.on >= 0).length}/${world.rings.length}`;
  const t = G.mode === 'classic' ? G.game.t.toFixed(1) : `${Math.floor(Math.ceil(G.game.left) / 60)}:${String(Math.ceil(G.game.left) % 60).padStart(2, '0')}`;
  const name = G.mode === 'waves' ? `Волна ${G.game.wave}` : MODES[G.mode].name, taps = `Нажатий: ${G.game.presses}`;
  const tcol = G.mode !== 'classic' && G.game.left < 10 ? '#ffe14d' : '#fff';
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  if (wide) {
    // Ландшафт: слева режим, время и нажатия, справа счёт
    const lx = (safeL + tankX) / 2, rx = (tankX + tankW + sw - safeR) / 2, y = gy + gh + 30;
    ctx.textAlign = 'center';
    ctx.font = '600 16px system-ui'; ctx.fillText(name, lx, y);
    ctx.font = '800 34px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, lx, y + 38); ctx.fillStyle = '#fff';
    ctx.font = '800 34px system-ui'; ctx.fillText(score, rx, y + 38);
    ctx.font = '500 13px system-ui'; ctx.globalAlpha = 0.85;
    ctx.fillText(taps, lx, y + 72); ctx.fillText('колец', rx, y + 72);
    ctx.globalAlpha = 1;
  } else {
    const y = safeT + hudH / 2 + 3, xl = gl + GAUGE_W + 8, xr = gr - 8;
    ctx.textAlign = 'left';
    ctx.font = '600 15px system-ui'; ctx.fillText(name, xl, y - 8);
    ctx.font = '500 12px system-ui'; ctx.globalAlpha = 0.85; ctx.fillText(taps, xl, y + 10); ctx.globalAlpha = 1;
    ctx.textAlign = 'right'; ctx.font = '800 20px system-ui'; ctx.fillText(score, xr, y);
    ctx.textAlign = 'center'; ctx.font = '800 26px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, sw / 2, y);
  }
  ctx.textBaseline = 'alphabetic';
}

// Зона насоса для подсказки: полоска посреди своей половины, снизу (слабо) вверх (сильно)
function tutStripe(side) {
  const x = sw * (side ? 0.75 : 0.25);
  return { x, y0: sh * 0.9, y1: Math.max(hudH + 62, sh * 0.25) };
}

function drawTutorial() {
  const A = tut.a;
  if (A <= 0) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,30,70,0.5)'; ctx.shadowBlur = 6;
  for (let s = 0; s < 2; s++) {
    const { x, y0, y1 } = tutStripe(s), w = 26;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0.26)');
    // Насосом уже понажимали — его полоска бледнеет
    ctx.globalAlpha = A * (tut.presses[s] >= 2 ? 0.35 : 1);
    ctx.fillStyle = gr; rr(x - w / 2, y1, w, y0 - y1, w / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 7, y1 + 15); ctx.lineTo(x, y1 + 8); ctx.lineTo(x + 7, y1 + 15); ctx.stroke();
  }
  ctx.globalAlpha = A * 0.95; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(clamp(sw * 0.035, 22, 32))}px system-ui`;
  ctx.strokeStyle = 'rgba(0,25,65,0.9)'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  ctx.strokeText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  ctx.fillText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  // Подписи шкалы у полоски: внизу слабо, наверху сильно
  ctx.font = `800 ${Math.round(clamp(sh * 0.06, 20, 28))}px system-ui`; ctx.globalAlpha = A;
  for (let s = 0; s < 2; s++) {
    const { x, y0, y1 } = tutStripe(s), lx = x + (s ? -36 : 36);
    ctx.textAlign = s ? 'right' : 'left';
    ctx.strokeText('сильно', lx, y1 + 16); ctx.fillText('сильно', lx, y1 + 16);
    ctx.strokeText('слабо', lx, y0 - 14); ctx.fillText('слабо', lx, y0 - 14);
  }
  // Палец не водит, а нажимает: три отдельных касания снизу вверх, каждое — появился, нажал, исчез.
  // Круг от нажатия тем больше, чем выше касание — струя сильнее. Потом то же на другой стороне
  const TAP = 0.8, side = Math.floor(tut.t / (3 * TAP)) % 2, n = Math.floor(tut.t / TAP) % 3, q = (tut.t % TAP) / TAP;
  const { x, y0, y1 } = tutStripe(side), f = [0.12, 0.5, 0.88][n], y = y0 + (y1 - y0) * f;
  const vis = q < 0.18 ? q / 0.18 : q > 0.72 ? Math.max(0, (0.95 - q) / 0.23) : 1;
  const down = clamp((q - 0.18) / 0.1, 0, 1);
  if (q > 0.26) {
    const k = clamp((q - 0.26) / 0.5, 0, 1), r = (8 + 26 * f) * (0.4 + 0.6 * k);
    ctx.globalAlpha = A * 0.45 * (1 - k * 0.7); ctx.fillStyle = '#c8f4ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = A * vis; ctx.font = '42px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('👆', x + 5, y - 3 + (1 - down) * 10);
  ctx.restore();
}

// ---------- Цикл ----------
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (G.state !== 'pause') {
    acc += dt;
    while (acc >= P.STEP) { tick(P.STEP); acc -= P.STEP; }
  }
  audioUpdate();
  render(now);
  requestAnimationFrame(frame);
}

pickGameAngle();
layout();
// В приложении ориентацию закрепляем сразу, без жеста игрока
if (native) lockScreen();
spawnRings(8, P.RING_D, false);
show('menu');
requestAnimationFrame(frame);
