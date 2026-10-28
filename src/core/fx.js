// Украшения: пузыри от струй, искры от надетых колец, пылинки в воде. На физику не влияют.
import { rng } from './rng.js';
import { P } from './params.js';
import { W, H, nozzles, clamp } from './field.js';
import { u, v, sample } from './fluid.js';
import { pumps } from './pumps.js';
import { grav } from './motion.js';

export const bubbles = [], sparks = [], specks = [];
// Пылинки раскладываются по размерам поля — вызывать после setField
export function initSpecks() {
  for (let i = 0; i < 90; i++) specks.push({ x: rng.fx() * W, y: rng.fx() * H });
}

export function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = rng.fx() * Math.PI * 2, s = 40 + rng.fx() * 90;
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, col });
  }
}

export function updateFx(dt) {
  for (let s = 0; s < pumps.length; s++) {
    const p = pumps[s], n = nozzles[s];
    p.emit += p.flow * 80 * dt;
    while (p.emit >= 1) {
      p.emit -= 1;
      if (bubbles.length < 320) bubbles.push({
        x: n.x + (rng.fx() - 0.5) * 10, y: n.y - 6, r: 1.2 + rng.fx() * 3.2,
        vx: n.dx * p.flow * P.JET * 0.5, vy: n.dy * p.flow * P.JET * 0.5
      });
    }
  }
  const e = 1 - Math.exp(-5 * dt);
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    // Пузырь всплывает против силы тяжести и лопается у той стенки, что сейчас сверху
    const up = 50 + b.r * 10;
    b.vx += (sample(u, b.x, b.y) - up * grav.x - b.vx) * e;
    b.vy += (sample(v, b.x, b.y) - up * grav.y - b.vy) * e;
    b.x = clamp(b.x + b.vx * dt, b.r, W - b.r);
    b.y += b.vy * dt;
    if (b.y < b.r + 1 || b.y > H - b.r - 1 || (b.x <= b.r && grav.x > 0.3) || (b.x >= W - b.r && grav.x < -0.3)) bubbles.splice(i, 1);
  }
  for (const s of specks) {
    s.x += (sample(u, s.x, s.y) + 4 * grav.x) * dt;
    s.y += (sample(v, s.x, s.y) + 4 * grav.y) * dt;
    if (s.x < 2 || s.x > W - 2 || s.y < 2 || s.y > H - 2) { s.x = 4 + rng.fx() * (W - 8); s.y = 4 + rng.fx() * (H - 8); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94;
    if (s.life <= 0) sparks.splice(i, 1);
  }
}
