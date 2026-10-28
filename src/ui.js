// Меню и оверлеи: старт режимов, пауза, итоги, рекорды, настройки звука и наклона, кнопка «Назад» в приложении.
import { resetFluid } from './core/fluid.js';
import { startGame, tut, getBest } from './core/game.js';
import { motion, enableMotion, resetMotion } from './core/motion.js';
import { P } from './core/params.js';
import { resetPumps } from './core/pumps.js';
import { world, spawnRings } from './core/rings.js';
import { G } from './core/state.js';
import { sfxBus, musicOn, sfxOn, initAudio, stopVoices, audioScene, toggleSound } from './audio.js';
import { touchDevice, plug } from './platform.js';
import { rot, toRoot, layout, pauseBtn } from './view.js';


export function refreshBest() {
  const c = getBest('classic'), k = getBest('colors'), w = getBest('waves');
  document.getElementById('best-classic').textContent = c == null ? 'Надень все 8 колец на скорость' : `Рекорд: ${c.toFixed(1)} с`;
  document.getElementById('best-colors').textContent = k == null ? 'Каждый цвет — на свой столбик за 90 с' : `Рекорд: ${k.toFixed(1)} с в запасе`;
  document.getElementById('best-waves').textContent = w == null ? 'Кольца всё меньше, а их всё больше' : `Рекорд: ${w} колец`;
}
export const overlays = { menu: document.getElementById('menu'), pause: document.getElementById('pause'), result: document.getElementById('result') };
export function show(name) {
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== name);
  pauseBtn.classList.toggle('hidden', G.state !== 'play');
  if (name === 'menu') refreshBest();
  audioScene();
}
export function pauseGame() { if (G.state !== 'play') return; G.state = 'pause'; resetPumps(); show('pause'); }
export function resumeGame() { initAudio(); G.state = 'play'; show(null); }
export function toMenu() { G.state = 'menu'; resetFluid(); resetPumps(); world.rings = []; spawnRings(8, P.RING_D, false); show('menu'); }

export const tiltBtn = document.getElementById('tiltBtn');
export function refreshTilt() { tiltBtn.textContent = `Наклон и тряска: ${motion.on ? 'вкл' : 'выкл'}`; }
export function refreshSoundButtons() {
  for (const [selector, label, on] of [['.musicBtn', 'Музыка', musicOn], ['.sfxBtn', 'Звуки', sfxOn]]) {
    document.querySelectorAll(selector).forEach(b => {
      b.textContent = `${label}: ${on ? 'вкл' : 'выкл'}`;
      b.setAttribute('aria-pressed', String(on));
    });
  }
}

// Кнопка «Назад» в приложении: в игре — пауза, на паузе — продолжить, после партии — в меню, в меню — свернуть
export const appPlug = plug('App');

// Обработчики меню и начальное состояние кнопок — вызывается из main.js один раз при запуске
export function bindUi() {
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
  try { motion.on = localStorage.getItem('rings_tilt') !== '0'; } catch (e) { }
  if (window.DeviceMotionEvent && touchDevice()) tiltBtn.classList.remove('hidden');
  tiltBtn.addEventListener('click', () => {
    motion.on = !motion.on;
    try { localStorage.setItem('rings_tilt', motion.on ? '1' : '0'); } catch (e) { }
    if (motion.on) enableMotion(); else resetMotion();
    refreshTilt();
  });
  refreshTilt();
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
}
