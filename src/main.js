'use strict';
// Точка входа: собирает ядро (src/core/) с браузерной частью, назначает хуки и запускает игровой цикл.
import { P } from './core/params.js';
import { setField } from './core/field.js';
import { motion } from './core/motion.js';
import { spawnRings } from './core/rings.js';
import { burst, initSpecks } from './core/fx.js';
import { tick } from './core/game.js';
import { hooks } from './core/hooks.js';
import { G } from './core/state.js';
import { initAudio, soundCue, audioUpdate } from './audio.js';
import { touchDevice, screenAngle, native, lockScreen } from './platform.js';
import { gameAngle, pickGameAngle, layout } from './view.js';
import { bindInput } from './input.js';
import { render } from './render.js';
import { show, pauseGame, resumeGame, bindUi } from './ui.js';

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
// Браузерная часть для правил игры (src/core/game.js)
hooks.audioStart = () => initAudio();
hooks.onStart = () => { if (touchDevice()) { pickGameAngle(); layout(); lockScreen(); } };
hooks.show = name => show(name);
hooks.sound = name => soundCue(name);
hooks.onEnd = (title, text, best) => {
  document.getElementById('resTitle').textContent = title;
  document.getElementById('resText').textContent = text;
  document.getElementById('resBest').textContent = best;
  show('result');
};

bindInput({ pause: () => pauseGame(), resume: () => resumeGame() });
bindUi();

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
