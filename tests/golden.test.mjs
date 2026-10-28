// Переработка не должна менять игру ни на бит: отпечатки всех команд Canvas совпадают с эталоном
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { play, scriptOf, SCENARIOS } from './harness.mjs';

// Что сверяем с эталоном: несжатая сборка src/ (до переработки эталон записан по прежнему index.html)
const BUILD = new URL('../build/index.dev.html', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const code = scriptOf(readFileSync(BUILD, 'utf8'));

for (const sc of SCENARIOS) {
  test(`эталон: ${sc.name}`, () => {
    const { hash, calls } = play(code, sc);
    assert.deepEqual({ hash, calls }, golden[sc.name], sc.name);
  });
}
