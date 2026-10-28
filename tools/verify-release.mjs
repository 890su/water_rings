// Compare actual release code with source using identical inputs and randomness.
// Hash every Canvas command, including coordinates/styles, to detect physics/render drift.
import { readFile } from 'node:fs/promises';
import { play, scriptOf as script, SCENARIOS } from '../tests/harness.mjs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('build/index.dev.html', root), 'utf8');
const release = await readFile(new URL('dist/index.html', root), 'utf8');
assert.equal(source.replace(/<script>[\s\S]*?<\/script>/, ''), release.replace(/<script>[\s\S]*?<\/script>/, ''));
assert.ok(!/sourceMappingURL|sourceURL/.test(script(release)));
assert.ok(!script(release).includes('function fluidStep'));

for (const sc of SCENARIOS.filter(s => !s.long)) {
  assert.deepEqual(play(script(release), sc), play(script(source), sc));
  console.log(`PASS ${sc.name}: identical rendering and UI`);
}
console.log('Release matches source in all 12 deterministic scenarios.');
