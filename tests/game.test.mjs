// Правила игры работают без браузера — на этом стоят боты и тесты физики
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/core/params.js';
import { setField } from '../src/core/field.js';
import { startGame, tick } from '../src/core/game.js';
import { G } from '../src/core/state.js';
import { world } from '../src/core/rings.js';

setField(P.START_FIELD);

test('startGame без DOM начинает партию «Классики» с 8 кольцами', () => {
  startGame('classic');
  assert.equal(G.state, 'play');
  assert.equal(world.rings.length, 8);
  for (let i = 0; i < 60; i++) tick(P.STEP);
  assert.ok(G.game.t > 0.99 && G.game.t < 1.01);
});

test('подмена параметра действует на следующий шаг', () => {
  const was = P.G;
  try {
    startGame('classic');
    const y0 = world.rings.map(r => r.a.y);
    P.G = 0; // без силы тяжести кольца в спокойной воде почти не опускаются
    for (let i = 0; i < 30; i++) tick(P.STEP);
    const fall0 = Math.max(...world.rings.map((r, i) => r.a.y - y0[i]));
    startGame('classic');
    const y1 = world.rings.map(r => r.a.y);
    P.G = was;
    for (let i = 0; i < 30; i++) tick(P.STEP);
    const fall1 = Math.max(...world.rings.map((r, i) => r.a.y - y1[i]));
    assert.ok(fall1 > fall0, `с силой тяжести кольца падают глубже: ${fall1} > ${fall0}`);
  } finally { P.G = was; }
});
