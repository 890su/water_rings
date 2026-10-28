// Насосы: ход и поток каждого насоса, струя из сопла и обратное всасывание воды.
import { P } from './params.js';
import { W, H, NX, NY, SX, NCELLS, PEG_TIP, PEG_BOTTOM, JET_LEN, pegs, nozzles, clamp } from './field.js';
import { u, v, IX, sample } from './fluid.js';

export function makePump() { return { held: false, id: null, y: 0, lastY: 0, lastT: 0, base: 0, boost: 0, flow: 0, stroke: 1, emit: 0, auto: 0 }; }
// По насосу на каждое сопло поля — список подстраивает setField
export const pumps = [];
export function syncPumps() {
  while (pumps.length < nozzles.length) pumps.push(makePump());
  pumps.length = nozzles.length;
}
// Какой насос включает касание в точке x кадра шириной width: экран делится на равные зоны слева направо
export function pumpAt(x, width) { return Math.min(pumps.length - 1, Math.max(0, Math.floor(x / width * pumps.length))); }

export function updatePump(p, dt) {
  if (p.auto > 0) { p.auto -= dt; if (p.auto <= 0) p.held = false; }
  const target = p.held && p.stroke > 0.001 ? Math.min(1, p.base + p.boost) : 0;
  const k = target > p.flow ? 28 : 9;
  p.flow += (target - p.flow) * (1 - Math.exp(-k * dt));
  if (p.held) p.stroke = Math.max(0, p.stroke - p.flow * P.DRAIN * dt);
  else p.stroke = Math.min(1, p.stroke + P.REFILL * dt);
  p.boost *= Math.exp(-3 * dt);
}

// Струя — конус длиной JET_LEN: вода разгоняется вдоль всей его оси, а не только у сопла.
export function inject(side) {
  const p = pumps[side];
  if (!p.held && p.stroke < 1) suck(side, (1 - p.stroke));
  if (p.flow < 0.01) return;
  const n = nozzles[side], sp = p.flow * P.JET, len = JET_LEN * (0.5 + 0.5 * p.flow);
  const mx = n.x + n.dx * 8, my = n.y + n.dy * 8;
  const reach = len + 40;
  const i0 = Math.max(1, Math.floor((mx - reach) / P.CELL) + 1), i1 = Math.min(NX, Math.floor((mx + reach) / P.CELL) + 1);
  const j0 = Math.max(1, Math.floor((my - reach) / P.CELL) + 1), j1 = Math.min(NY, Math.floor((my + 20) / P.CELL) + 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const rx = (i - 0.5) * P.CELL - mx, ry = (j - 0.5) * P.CELL - my;
    const along = rx * n.dx + ry * n.dy;
    if (along < -P.CELL || along > len) continue;
    const perp = Math.abs(rx * n.dy - ry * n.dx), width = P.JET_W0 + Math.max(0, along) * P.JET_SPREAD;
    if (perp >= width) continue;
    const f = Math.max(0, along) / len;
    // у стенок струю гасим, иначе она "прилипает" к стеклу и уходит вдоль него
    const cx = (i - 0.5) * P.CELL, wall = clamp(Math.min(cx, W - cx) / 50, 0, 1);
    const a = 0.4 * (1 - f) * (1 - perp / width) * wall * shelfShade(mx, my, cx, (j - 0.5) * P.CELL);
    const target = sp * (1 - 0.55 * f), k = IX(i, j);
    u[k] += (n.dx * target - u[k]) * a;
    v[k] += (n.dy * target - v[k]) * a;
  }
}

// Полка-стопор заслоняет струю: точке за полкой (прямая к соплу проходит через полку) достаётся
// лишь P.SHELF_LEAK напора. Края тени размыты, а за P.SHELF_SHADOW px над полкой поток уже сомкнулся —
// кольцо на полке в тени, приподнятое выше — снова под струёй
export function shelfShade(mx, my, x, y) {
  let k = 1;
  for (const g of pegs) {
    if (y >= g.bottom || my <= g.bottom || g.bottom - y >= P.SHELF_SHADOW) continue;
    const xi = mx + (x - mx) * (my - g.bottom) / (my - y);
    const cover = clamp((P.SHELF_W / 2 + 4 - Math.abs(xi - g.x)) / 8, 0, 1) * (1 - (g.bottom - y) / P.SHELF_SHADOW);
    k *= 1 - (1 - P.SHELF_LEAK) * cover;
  }
  return k;
}

// Насос набирает воду обратно через сопло — вдоль дна к нему тянет кольца
export function suck(side, k) {
  const n = nozzles[side], R = 90, sp = P.SUCTION * Math.min(1, k * 2);
  const i0 = Math.max(1, Math.floor((n.x - R) / P.CELL) + 1), i1 = Math.min(NX, Math.floor((n.x + R) / P.CELL) + 1);
  const j0 = Math.max(1, Math.floor((n.y - R) / P.CELL) + 1);
  for (let j = j0; j <= NY; j++) for (let i = i0; i <= i1; i++) {
    const rx = n.x - (i - 0.5) * P.CELL, ry = n.y - (j - 0.5) * P.CELL, d = Math.hypot(rx, ry);
    if (d >= R || d < 1) continue;
    const a = 0.15 * (1 - d / R), k2 = IX(i, j);
    u[k2] += (rx / d * sp - u[k2]) * a;
    v[k2] += (ry / d * sp - v[k2]) * a;
  }
}

export function resetPumps() { for (const p of pumps) Object.assign(p, makePump()); }
