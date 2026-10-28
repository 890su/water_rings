// Поле и вода: параметры читаются в момент setField, массивы воды пересоздаются под поле
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/core/params.js';
import { setField, pegs, W, H } from '../src/core/field.js';
import * as fluid from '../src/core/fluid.js';
import { pumps, pumpAt } from '../src/core/pumps.js';
import { startGame, tick } from '../src/core/game.js';
import { world } from '../src/core/rings.js';

test('setField применяет переопределённые параметры', () => {
  const was = P.L_PEG_X;
  try {
    P.L_PEG_X = 200;
    setField('landscape');
    assert.equal(pegs[0].x, 200);
    assert.equal(pegs[1].x, W - 200);
  } finally {
    P.L_PEG_X = was;
    setField('landscape');
  }
});

test('массивы воды пересоздаются под поле и видны из другого модуля', () => {
  setField('landscape');
  assert.equal(fluid.u.length, (W / P.CELL + 2) * (H / P.CELL + 2));
  assert.equal(fluid.curl.length, fluid.u.length);
});

// Поле с тремя столбиками и тремя насосами: насосы и столбики — списки любой длины
test('поле с тремя насосами: насос по касанию — по третям ширины', () => {
  try {
    setField('test3');
    assert.equal(pumps.length, 3);
    assert.equal(pegs.length, 3);
    assert.equal(pumpAt(0.1 * 900, 900), 0);
    assert.equal(pumpAt(0.5 * 900, 900), 1);
    assert.equal(pumpAt(0.9 * 900, 900), 2);
  } finally { setField('landscape'); }
  assert.equal(pumps.length, 2);
  assert.equal(pumpAt(449, 900), 0);
  assert.equal(pumpAt(450, 900), 1);
});

test('поле с тремя столбиками: партии без ошибок, кольца надеваются и на третий столбик', () => {
  const was = Math.random;
  let seed = 3;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try {
    setField('test3');
    let onThird = 0;
    for (let g = 0; g < 5 && !onThird; g++) {
      startGame('classic');
      // Бот жмёт насосы по очереди: 0,6 с нажатие с силой 0,6–1, затем 0,6 с пауза
      for (let f = 0; f < 60 * 60; f++) {
        const k = Math.floor(f / 72) % 3, p = pumps[k];
        if (f % 72 === 0) { p.held = true; p.base = 0.6 + Math.random() * 0.4; p.auto = 0.6; }
        tick(P.STEP);
        if (world.rings.some(r => r.on === 2)) { onThird++; break; }
      }
    }
    assert.ok(onThird > 0, 'ни одно кольцо не наделось на третий столбик');
  } finally { Math.random = was; setField('landscape'); }
});
