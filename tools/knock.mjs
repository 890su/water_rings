// Проверка: сбивают ли надетые кольца одиночное полное нажатие и долгий спам.
// node tools/knock.mjs <trials> ALIGN=20,G=200
import { applyOverrides, P, startGame, tick, G, world, pumps } from './core.mjs';

const [trials = 20, overridesArg = ''] = process.argv.slice(2);
const overrides = applyOverrides(overridesArg);

const run = sec => { for (let f = 0; f < sec * 60 && G.state === 'play'; f++) tick(P.STEP); };
const press = (side, hold) => { const p = pumps[side]; p.held = true; p.base = 1; p.auto = hold; };
// Обычная игра ботом, пока на штырях не окажется хотя бы minOn колец, потом пауза
function setup(minOn) {
  for (;;) {
    startGame('classic');
    let wait = 0.5;
    for (let f = 0; f < 600 * 60 && G.state === 'play'; f++) {
      if (!pumps[0].held && !pumps[1].held && (wait -= P.STEP) <= 0) {
        if (world.rings.filter(r => r.on >= 0).length >= minOn) { run(3); if (G.state === 'play') return true; break; }
        const p = pumps[Math.random() < 0.5 ? 0 : 1];
        p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.3 + Math.random() * 0.6;
        wait = 0.5 + Math.random() * 1.0;
      }
      tick(P.STEP);
    }
  }
}
const res = {};
for (const test of ['single', 'double', 'spam']) {
  let threaded = 0, lost = 0, trialsHit = 0;
  for (let t = 0; t < +trials; t++) {
    setup(2 + (t % 4));
    const on = world.rings.filter(r => r.on >= 0).map(r => [r, r.on]);
    if (test === 'single') { press(t % 2, 1.2); run(4); }
    else if (test === 'double') { press(0, 1.2); press(1, 1.2); run(4); }
    else { for (let i = 0; i < 10; i++) { press(i % 2, 1.0); run(1.2); } run(4); }
    const l = on.filter(([r, k]) => r.on !== k).length;
    threaded += on.length; lost += l; if (l) trialsHit++;
  }
  res[test] = { threaded, lost, trialsWithLoss: trialsHit, trials: +trials };
}
console.log(JSON.stringify({ overrides, ...res }));
