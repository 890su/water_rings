// Правила игры: режимы, старт и конец партии, волны, рекорды, подсказка первой игры, демо в меню, игровой шаг.
// Без DOM: всё браузерное (звук, экран, оверлеи, итоги) — через hooks.
import { P } from './params.js';
import { W, H, PEG_TIP, pegs, clamp } from './field.js';
import { resetFluid, fluidStep } from './fluid.js';
import { pumps, updatePump, inject, resetPumps } from './pumps.js';
import { motion, enableMotion, resetMotion, updateMotion } from './motion.js';
import { world, spawnRings, physics, checkThreads } from './rings.js';
import { bubbles, sparks, burst, updateFx } from './fx.js';
import { G } from './state.js';
import { hooks } from './hooks.js';

export const MODES = {
  classic: { name: 'Классика' },
  colors: { name: 'Два цвета' },
  waves: { name: 'Волны' }
};
// Состояние партии — в src/core/state.js (G)

export function toast(t) { G.toastText = t; G.toastT = 1.8; }


export function startGame(m) {
  G.mode = m; hooks.audioStart(); resetFluid(); resetPumps(); resetMotion();
  if (motion.on) enableMotion();
  // Как держат телефон при старте — так кадр и закрепляем
  hooks.onStart();
  world.rings = []; bubbles.length = 0; sparks.length = 0;
  G.game = { t: 0, left: 0, score: 0, wave: 1, hold: 0, presses: 0 };
  if (m === 'classic') { spawnRings(8, P.RING_D, false); toast('Надень все кольца'); }
  else if (m === 'colors') { G.game.left = 90; spawnRings(8, P.RING_D - 2, true); toast('Красные — влево, синие — вправо'); }
  else { G.game.left = 60; spawnWave(); toast('Волна 1'); }
  G.state = 'play';
  if (!tutSeen() || tut.force) tutStart();
  hooks.show(null);
  hooks.sound('start');
}

// Поверх игры, ничего не блокирует: две блеклые полоски — зоны насосов (снизу слабо, сверху сильно),
// и палец показывает: нажми слева, веди вверх — струя сильнее; потом справа. Гаснет сама,
// когда игрок нажал по паре раз каждым насосом, и больше не показывается
// done — на случай, если хранилище недоступно (приватный режим): тогда хотя бы до перезагрузки не повторяем
export const tut = { on: false, a: 0, t: 0, presses: [0, 0], force: false, done: false };
export function tutSeen() { try { return tut.done || localStorage.getItem('rings_tut') === '1'; } catch (e) { return tut.done; } }
export function tutStart() { Object.assign(tut, { on: true, a: 0, t: 0, presses: [0, 0], force: false }); }
export function tutUpdate(dt) {
  if (!tut.on) return;
  tut.t += dt;
  const done = tut.presses[0] >= 2 && tut.presses[1] >= 2;
  tut.a = clamp(tut.a + (done ? -dt / 0.6 : dt / 0.5), 0, 1);
  if (done && tut.a <= 0) { tut.on = false; tut.done = true; try { localStorage.setItem('rings_tut', '1'); } catch (e) { } }
}

export function spawnWave() {
  const n = Math.min(10, 4 + G.game.wave), D = Math.max(P.RING_D - 12, P.RING_D + 2 - 3 * (G.game.wave - 1));
  spawnRings(n, D, false);
}

export function gameLogic(dt) {
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
      world.rings = []; spawnWave(); hooks.sound('wave');
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

export function endGame(title, text, best) {
  G.state = 'over';
  resetPumps();
  hooks.onEnd(title, text, best);
  hooks.sound(title === 'Готово!' || title === 'Победа!' ? 'win' : 'end');
}

// Хранилище бывает недоступно (приватный режим, встроенные браузеры) — тогда просто без рекордов
export function getBest(m) {
  let v = null;
  try { v = localStorage.getItem('rings_best_' + m); } catch (e) { }
  return v == null ? null : +v;
}
export function setBest(m, v) { try { localStorage.setItem('rings_best_' + m, String(v)); } catch (e) { } }


export let demoT = 1;
export function demo(dt) {
  demoT -= dt;
  if (demoT > 0) return;
  const p = pumps[Math.random() < 0.5 ? 0 : 1];
  if (!p.held) { p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.2 + Math.random() * 0.5; }
  demoT = 0.6 + Math.random() * 1.6;
}

export function tick(dt) {
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
