// Записать эталонные отпечатки игры: node tools/golden-record.mjs <файл со сборкой>
// Пишет tests/golden.json — с ним сверяется tests/golden.test.mjs. Эталон записан по исходной версии до переработки:
//   git show d739e26:index.html > old.html && node tools/golden-record.mjs old.html
import { readFileSync, writeFileSync } from 'node:fs';
import { play, scriptOf, stateOf, SCENARIOS } from '../tests/harness.mjs';

const file = process.argv[2];
if (!file) throw new Error('usage: node tools/golden-record.mjs <html>');
const code = scriptOf(readFileSync(file, 'utf8'));
const golden = {};
for (const sc of SCENARIOS) {
  const r = play(code, sc);
  golden[sc.name] = { hash: r.hash, calls: r.calls, state: stateOf(r) };
  console.log(`${sc.name}: ${r.hash.slice(0, 12)} (${r.calls})`);
}
writeFileSync(new URL('../tests/golden.json', import.meta.url), JSON.stringify(golden, null, 2) + '\n');
console.log(`tests/golden.json: ${SCENARIOS.length} сценариев`);
