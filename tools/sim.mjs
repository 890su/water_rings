// Прогон партий "Классики" без браузера для подбора сложности.
// node tools/sim.mjs <games> <maxSec> ALIGN=20,G=200
import { applyOverrides, P, W, H, PEG_TIP, startGame, tick, G, world, pumps } from './core.mjs';

const [games = 20, maxSec = 600, overridesArg = ''] = process.argv.slice(2);
const overrides = applyOverrides(overridesArg);

const t0 = Date.now();
const times = [], stats = { lifts: 0, threads: 0, losses: 0, onEnd: 0, sec: 0 };
for (let g = 0; g < +games; g++) {
  startGame('classic');
  let wait = 0.5;
  const above = new Map(), prevOn = new Map();
  const steps = +maxSec * 60;
  for (let f = 0; f < steps && G.state === 'play'; f++) {
    if (!pumps[0].held && !pumps[1].held) {
      wait -= P.STEP;
      if (wait <= 0) {
        let l = 0, r = 0;
        for (const R of world.rings) if (R.on < 0 && R.a.y > H - 170) ((R.a.x + R.b.x) / 2 < W / 2 ? l++ : r++);
        let side = l === r ? (Math.random() < 0.5 ? 0 : 1) : (l > r ? 0 : 1);
        if (Math.random() < 0.2) side = 1 - side;
        const p = pumps[side];
        p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.3 + Math.random() * 0.6;
        wait = 0.5 + Math.random() * 1.0;
      }
    }
    tick(P.STEP);
    for (const R of world.rings) {
      const up = Math.max(R.a.y, R.b.y) < PEG_TIP;
      if (up && !above.get(R)) stats.lifts++;
      above.set(R, up);
      const was = prevOn.get(R) ?? -1;
      if (was < 0 && R.on >= 0) stats.threads++;
      if (was >= 0 && R.on < 0) stats.losses++;
      prevOn.set(R, R.on);
    }
  }
  stats.sec += G.game.t;
  stats.onEnd += world.rings.filter(r => r.on >= 0).length;
  times.push(G.state === 'over' ? +G.game.t.toFixed(1) : null);
}
console.log(JSON.stringify({ overrides, times, stats, ms: Date.now() - t0 }));
