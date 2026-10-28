// Вода: stable fluids на сетке NX × NY. Массивы — экспортируемые переменные с живой привязкой,
// пересоздаются только здесь, в allocFluid (её вызывает setField).
import { P } from './params.js';
import { NX, NY, SX, NCELLS, pegs, clamp } from './field.js';

export let u, v, u0, v0, pr, dv, curl;
export function allocFluid(n) {
  [u, v, u0, v0, pr, dv, curl] = Array.from({ length: 7 }, () => new Float64Array(n));
}

export const IX = (i, j) => i + SX * j;

export function setBnd(b, x) {
  for (let j = 1; j <= NY; j++) {
    x[IX(0, j)] = b === 1 ? -x[IX(1, j)] : x[IX(1, j)];
    x[IX(NX + 1, j)] = b === 1 ? -x[IX(NX, j)] : x[IX(NX, j)];
  }
  for (let i = 1; i <= NX; i++) {
    x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
    x[IX(i, NY + 1)] = b === 2 ? -x[IX(i, NY)] : x[IX(i, NY)];
  }
  x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
  x[IX(0, NY + 1)] = 0.5 * (x[IX(1, NY + 1)] + x[IX(0, NY)]);
  x[IX(NX + 1, 0)] = 0.5 * (x[IX(NX, 0)] + x[IX(NX + 1, 1)]);
  x[IX(NX + 1, NY + 1)] = 0.5 * (x[IX(NX, NY + 1)] + x[IX(NX + 1, NY)]);
}

// Давление не обнуляем между шагами — старт с прошлого решения сходится быстрее
export function project() {
  for (let j = 1; j <= NY; j++) for (let i = 1, k = j * SX + 1; i <= NX; i++, k++) {
    dv[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + SX] - v[k - SX]);
  }
  setBnd(0, dv);
  for (let it = 0; it < 20; it++) {
    for (let j = 1; j <= NY; j++) for (let i = 1, k = j * SX + 1; i <= NX; i++, k++) {
      pr[k] = (dv[k] + pr[k - 1] + pr[k + 1] + pr[k - SX] + pr[k + SX]) * 0.25;
    }
    setBnd(0, pr);
  }
  for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
    const k = IX(i, j);
    u[k] -= 0.5 * (pr[k + 1] - pr[k - 1]);
    v[k] -= 0.5 * (pr[k + SX] - pr[k - SX]);
  }
  setBnd(1, u); setBnd(2, v);
}

export function advect(b, d, d0, uu, vv, dt) {
  const dt0 = dt / P.CELL;
  for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
    const k = IX(i, j);
    const x = clamp(i - dt0 * uu[k], 0.5, NX + 0.5), y = clamp(j - dt0 * vv[k], 0.5, NY + 0.5);
    const i0 = x | 0, j0 = y | 0, s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
    d[k] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j0 + 1)]) + s1 * (t0 * d0[IX(i0 + 1, j0)] + t1 * d0[IX(i0 + 1, j0 + 1)]);
  }
  setBnd(b, d);
}

export function vorticity(dt) {
  for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
    const k = IX(i, j);
    curl[k] = 0.5 * ((v[k + 1] - v[k - 1]) - (u[k + SX] - u[k - SX]));
  }
  for (let j = 2; j < NY; j++) for (let i = 2; i < NX; i++) {
    const k = IX(i, j);
    let nx = 0.5 * (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]));
    let ny = 0.5 * (Math.abs(curl[k + SX]) - Math.abs(curl[k - SX]));
    const len = Math.hypot(nx, ny) + 1e-5;
    // Вихри подкручиваем только в заметном потоке: иначе подкрутка сама держит вечный вихрь,
    // вода не успокаивается и кольца бесконечно висят в слабом течении
    const f = P.VORT * dt * clamp((Math.hypot(u[k], v[k]) - 20) / 80, 0, 1) / len;
    u[k] += f * ny * curl[k];
    v[k] -= f * nx * curl[k];
  }
}

// Тормозим воду в прямоугольнике пропорционально тому, какую долю клетки он закрывает;
// ku / kv — сила торможения поперёк x и y
export function blockRect(x0, x1, y0, y1, ku, kv, dt) {
  const eu = 1 - Math.exp(-ku * dt), ev = 1 - Math.exp(-kv * dt);
  for (let j = Math.max(1, Math.floor(y0 / P.CELL) + 1); j <= Math.min(NY, Math.floor(y1 / P.CELL) + 1); j++) {
    const oy = Math.max(0, Math.min(y1, j * P.CELL) - Math.max(y0, (j - 1) * P.CELL)) / P.CELL;
    for (let i = Math.max(1, Math.floor(x0 / P.CELL) + 1); i <= Math.min(NX, Math.floor(x1 / P.CELL) + 1); i++) {
      const f = oy * Math.max(0, Math.min(x1, i * P.CELL) - Math.max(x0, (i - 1) * P.CELL)) / P.CELL, k = IX(i, j);
      u[k] *= 1 - eu * f; v[k] *= 1 - ev * f;
    }
  }
}

// Штырь тонкий и поток почти не держит, но подтормаживает воду вдоль стержня — за ним срываются завихрения.
// Полка-стопор внизу — пластина поперёк струи: вертикальный поток почти не пропускает, вода обтекает её
// по краям, над полкой затишье (лежащие на ней кольца в «тени»), а с краёв срываются вихри
export function pegWake(dt) {
  for (const g of pegs) {
    blockRect(g.x - P.PEG_R, g.x + P.PEG_R, g.tip, g.bottom, P.PEG_DRAG * P.CELL / (2 * P.PEG_R), P.PEG_DRAG * P.CELL / (2 * P.PEG_R), dt);
    blockRect(g.x - P.SHELF_W / 2, g.x + P.SHELF_W / 2, g.bottom - 3, g.bottom + 4, P.SHELF_DRAG * 0.2, P.SHELF_DRAG, dt);
  }
}

export function fluidStep(dt) {
  pegWake(dt);
  vorticity(dt);
  const damp = Math.exp(-P.FLUID_DAMP * dt);
  for (let k = 0; k < NCELLS; k++) { u[k] *= damp; v[k] *= damp; }
  u0.set(u); v0.set(v);
  advect(1, u, u0, u0, v0, dt);
  advect(2, v, v0, u0, v0, dt);
  project();
}

export function resetFluid() { u.fill(0); v.fill(0); pr.fill(0); }

export function sample(f, x, y) {
  const gx = clamp(x / P.CELL + 0.5, 0.5, NX + 0.5), gy = clamp(y / P.CELL + 0.5, 0.5, NY + 0.5);
  const i0 = gx | 0, j0 = gy | 0, s = gx - i0, t = gy - j0;
  return (1 - s) * ((1 - t) * f[IX(i0, j0)] + t * f[IX(i0, j0 + 1)]) + s * ((1 - t) * f[IX(i0 + 1, j0)] + t * f[IX(i0 + 1, j0 + 1)]);
}
