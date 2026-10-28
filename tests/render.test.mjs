// Отрисовка в подменённом браузере: окно любого размера не обрывает игровой цикл
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { play, scriptOf } from './harness.mjs';

const code = scriptOf(readFileSync(new URL('../build/index.dev.html', import.meta.url), 'utf8'));

// Свёрнутая панель браузера даёт окно 0×0: раньше масштаб аквариума уходил в минус,
// рамка получала отрицательный радиус, render бросал исключение — и игра замирала навсегда
for (const mobile of [false, true]) {
  test(`окно 0×0 посреди партии и обратно (${mobile ? 'touch' : 'desktop'})`, () => {
    assert.doesNotThrow(() => play(code, { mode: 'classic', mobile, shrink: true }));
  });
}
