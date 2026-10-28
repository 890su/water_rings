// Случайность с зерном: партия воспроизводима, украшения и меню не сдвигают игровой поток
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/core/params.js';
import { setField } from '../src/core/field.js';
import { startGame, tick } from '../src/core/game.js';
import { G } from '../src/core/state.js';
import { world, spawnRings } from '../src/core/rings.js';
import { pumps } from '../src/core/pumps.js';
import { setSeed } from '../src/core/rng.js';

setField(P.START_FIELD);

// Партия с одинаковыми нажатиями: каждые 50 шагов насосы по очереди на 0,5 с; menuFrames — шагов меню до старта.
// В меню, как при запуске игры, плавают кольца — их физика тоже тянет игровой поток
function playSeeded(seed, menuFrames = 0, steps = 1800) {
  setSeed(seed);
  try {
    G.state = 'menu';
    spawnRings(8, P.RING_D, false);
    for (let i = 0; i < menuFrames; i++) tick(P.STEP);
    startGame('classic');
    for (let f = 0; f < steps; f++) {
      if (f % 50 === 0) { const p = pumps[(f / 50) % 2]; p.held = true; p.base = 0.9; p.auto = 0.5; }
      tick(P.STEP);
    }
    return world.rings.map(r => [r.a.x, r.a.y, r.b.x, r.b.y, r.z, r.phi].map(v => +v.toFixed(9)));
  } finally { setSeed(null); }
}

test('одно зерно — одна и та же партия', () => {
  assert.deepEqual(playSeeded(42), playSeeded(42));
});

test('разные зёрна — разные раскладки колец', () => {
  assert.notDeepEqual(playSeeded(1, 0, 0), playSeeded(2, 0, 0));
});

test('меню и украшения перед стартом не сдвигают игровой поток', () => {
  assert.deepEqual(playSeeded(7, 300), playSeeded(7, 0));
});
