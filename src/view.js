// Экран: холст, размеры игрового кадра, вырез камеры, поворот кадра и раскладка (layout).
// Переменные с живой привязкой — меняются только здесь, в layout и pickGameAngle.
import { W, H, clamp } from './core/field.js';
import { motion } from './core/motion.js';
import { touchDevice, screenAngle, native } from './platform.js';

export const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
export let sw = 0, sh = 0, dpr = 1, S = 1, tankX = 0, tankY = 0, tankW = 0, tankH = 0, hudH = 52, wide = false, wasLand = null;
export let safeL = 0, safeT = 0, safeR = 0, safeB = 0;
export const PAD = 8, GAUGE_W = 16;
// gameAngle — как стоит игровой кадр относительно «родной» ориентации устройства (в смысле screen.orientation.angle).
// Всегда основная альбомная ориентация, без переключения поля.
// низ остаётся у того же края корпуса. Если браузер сам повернул экран, кадр поворачиваем обратно на rot.
// На компьютере (без касаний) не поворачиваем ничего
export const root = document.getElementById('root');
export let gameAngle = 0, rot = 0;
export function pickGameAngle() {
  const a = screenAngle(), natLand = a % 180 === 0 ? window.innerWidth > window.innerHeight : window.innerWidth <= window.innerHeight;
  gameAngle = natLand ? 0 : 90;
}
// Координаты касания из окна браузера — в игровой кадр
export function toRoot(e) {
  const vw = window.innerWidth, vh = window.innerHeight, x = e.clientX, y = e.clientY;
  return rot === 90 ? [y, vw - x] : rot === 180 ? [vw - x, vh - y] : rot === 270 ? [vh - y, x] : [x, y];
}
// В портрете сверху полоса со счётом; в ландшафте аквариум во всю высоту, а счёт — по бокам от него
export function layout() {
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
export const pauseBtn = document.getElementById('pauseBtn');
