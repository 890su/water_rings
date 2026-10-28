// Поле и вода: параметры читаются в момент setField, массивы воды пересоздаются под поле
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/core/params.js';
import { setField, pegs, W, H } from '../src/core/field.js';
import * as fluid from '../src/core/fluid.js';

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
