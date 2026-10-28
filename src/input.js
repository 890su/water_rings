// Ввод: касания и мышь (насос — по половине экрана, сила — по высоте), клавиатура.
import { P } from './core/params.js';
import { clamp } from './core/field.js';
import { pumps } from './core/pumps.js';
import { shake, motion } from './core/motion.js';
import { G } from './core/state.js';
import { tut } from './core/game.js';
import { initAudio, bubbleSound } from './audio.js';
import { canvas, sw, sh, toRoot } from './view.js';
import { plug } from './platform.js';

// Левая/правая половина экрана; чем выше касание, тем сильнее струя. Шкала силы — вся высота кадра.
export function strengthFromY(y) {
  return 0.18 + 0.82 * clamp((sh - y) / sh, 0, 1);
}
export function press(side, y, id, strong) {
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
export function release(side) {
  if (pumps[side].held) bubbleSound(side, 0.3, true);
  pumps[side].held = false; pumps[side].id = null;
}
// Обработчики касаний, мыши и клавиатуры. Пауза и продолжение — из меню (ui)
export function bindInput(ui) {
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
    if (e.code === 'Escape' || e.code === 'KeyP') { if (G.state === 'play') ui.pause(); else if (G.state === 'pause') ui.resume(); return; }
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
}
