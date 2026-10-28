// Записать эталонные отпечатки игры: node tools/golden-record.mjs <файл со сборкой>
// Пишет tests/golden.json — с ним сверяется tests/golden.test.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { play, scriptOf, SCENARIOS } from '../tests/harness.mjs';

const file = process.argv[2];
if (!file) throw new Error('usage: node tools/golden-record.mjs <html>');
const code = scriptOf(readFileSync(file, 'utf8'));
const golden = {};
for (const sc of SCENARIOS) {
  const { hash, calls } = play(code, sc);
  golden[sc.name] = { hash, calls };
  console.log(`${sc.name}: ${hash.slice(0, 12)} (${calls})`);
}
writeFileSync(new URL('../tests/golden.json', import.meta.url), JSON.stringify(golden, null, 2) + '\n');
console.log(`tests/golden.json: ${SCENARIOS.length} сценариев`);
