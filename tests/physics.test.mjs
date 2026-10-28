// Физика колец: без рывков, без проникновения колец друг в друга, без колец, зависших в воде.
// Бот жмёт насосы случайно; случайность задана, чтобы прогоны были одинаковыми.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/core/params.js';
import { setField, floorY, pegs } from '../src/core/field.js';
import { startGame, tick } from '../src/core/game.js';
import { world, segParams, SEG } from '../src/core/rings.js';
import { pumps } from '../src/core/pumps.js';

setField(P.START_FIELD);

function seeded(seed) {
  const was = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  return () => { Math.random = was; };
}

// Бот: пока насосы отпущены, через 0,5–1,5 с жмёт случайный с силой 0,45–1 на 0,3–0,9 с
function botPlay(sec, each) {
  let wait = 0.5;
  for (let f = 0; f < sec * 60; f++) {
    if (!pumps[0].held && !pumps[1].held && (wait -= P.STEP) <= 0) {
      const p = pumps[Math.random() < 0.5 ? 0 : 1];
      p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.3 + Math.random() * 0.6;
      wait = 0.5 + Math.random() * 1.0;
    }
    tick(P.STEP);
    each?.();
  }
}

test('нет рывков и проникновения колец друг в друга', () => {
  const restore = seeded(20261028);
  try {
    let jumps = 0, deep = 0;
    const prev = new Map();
    for (let g = 0; g < 2; g++) {
      startGame('classic');
      botPlay(120, () => {
        const rs = world.rings;
        for (const R of rs) {
          const cx = (R.a.x + R.b.x) / 2, cy = (R.a.y + R.b.y) / 2, p = prev.get(R);
          if (p && Math.hypot(cx - p[0], cy - p[1]) > 16) jumps++;
          prev.set(R, [cx, cy]);
        }
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
          const A = rs[i], B = rs[j];
          if (A.hz + B.hz - Math.abs(A.z - B.z) <= 0.5) continue;
          segParams(A.a.x, A.a.y, A.b.x, A.b.y, B.a.x, B.a.y, B.b.x, B.b.y);
          const px = A.a.x + (A.b.x - A.a.x) * SEG.s, py = A.a.y + (A.b.y - A.a.y) * SEG.s;
          const d = Math.hypot(B.a.x + (B.b.x - B.a.x) * SEG.t - px, B.a.y + (B.b.y - B.a.y) * SEG.t - py);
          if (2 * P.RIM - d > P.RIM) deep++;
        }
      });
    }
    assert.equal(jumps, 0, 'скачки центра кольца больше 16 px за кадр');
    assert.equal(deep, 0, 'кольца вошли друг в друга глубже обода');
  } finally { restore(); }
});

test('после игры без нажатий все кольца оседают', () => {
  const restore = seeded(7);
  try {
    startGame('classic');
    botPlay(60);
    for (let f = 0; f < 12 * 60; f++) tick(P.STEP);
    const floating = world.rings.filter(R => {
      const cx = (R.a.x + R.b.x) / 2, cy = (R.a.y + R.b.y) / 2;
      return R.on < 0 && !R.ground && cy < floorY(cx) - 30;
    });
    // лежащее на соседнем кольце тоже не «висит»: его держит кольцо под ним
    const hanging = floating.filter(R => !world.rings.some(o => o !== R && Math.hypot((o.a.x + o.b.x) / 2 - (R.a.x + R.b.x) / 2, (o.a.y + o.b.y) / 2 - (R.a.y + R.b.y) / 2) < 3 * P.RIM + P.RING_D / 2));
    assert.equal(hanging.length, 0, 'кольца зависли в воде');
    // «Надетое» кольцо стоит на своём столбике, а не висит в стороне на высоте полки
    const offPeg = world.rings.filter(R => R.on >= 0 && Math.abs((R.a.x + R.b.x) / 2 - pegs[R.on].x) > R.D / 2);
    assert.equal(offPeg.length, 0, 'кольцо числится надетым, но стоит в стороне от столбика');
  } finally { restore(); }
});
