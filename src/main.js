'use strict';
import { P } from './core/params.js';
import { field, W, H, NX, NY, SX, NCELLS, PEG_TIP, PEG_BOTTOM, JET_LEN, FLOOR, pegs, nozzles, setField, floorY, mkNozzle, shade, clamp } from './core/field.js';
import { u, v, u0, v0, pr, dv, curl, IX, setBnd, project, advect, vorticity, blockRect, pegWake, fluidStep, resetFluid, sample } from './core/fluid.js';
import { makePump, pumps, updatePump, inject, shelfShade, suck, resetPumps } from './core/pumps.js';
import { grav, shake, motion, screenAxes, onMotion, enableMotion, resetMotion, swirl, updateMotion } from './core/motion.js';

setField(P.START_FIELD);
// Угол игрового кадра для датчиков наклона: на телефоне кадр привязан к корпусу, на компьютере — к экрану
motion.angle = () => (touchDevice() ? gameAngle : screenAngle());

const PALETTE = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff9f1c', '#f15bb5', '#9ef01a'];
const DUO = ['#ff3b5c', '#2f7dff'];

// ---------- Кольца ----------
// Кольцо в профиль = два "сечения обода" (частицы), жёстко связанные на расстоянии D.
// Штырь проходит между ними, только если кольцо достаточно горизонтально и попало точно.
let rings = [];

function makeRing(x, y, ang, D, col, ci) {
  const hx = Math.cos(ang) * D / 2, hy = Math.sin(ang) * D / 2;
  const R = {
    a: { x: x - hx, y: y - hy, px: x - hx, py: y - hy },
    b: { x: x + hx, y: y + hy, px: x + hx, py: y + hy },
    D, col, dark: shade(col, 0.6), ci, on: -1, shown: -1, tinkT: 0,
    phi: P.SPIN_REST + (Math.random() < 0.5 ? 0 : Math.PI), om: 0, z: 0, pz: 0, hook: -1, support: false,
    mark: pegs.map(() => false), eng: pegs.map(() => false)
  };
  updateDepth(R);
  R.z = R.pz = (Math.random() * 2 - 1) * R.zWall;
  return R;
}

// hz — полутолщина кольца по глубине; zWall — насколько можно сдвинуться от середины до стекла;
// zHole — насколько надетое кольцо может сместиться вглубь, пока штырь остаётся в дырке
function updateDepth(R) {
  const c = R.D / 2 * Math.abs(Math.cos(R.phi));
  R.hz = c + P.RIM;
  R.zWall = Math.max(0, P.TANK_Z - R.hz);
  R.zHole = Math.max(0, c - P.RIM - P.PEG_R);
}
const engaged = R => R.on >= 0 || R.eng[0] || R.eng[1];
// Наклон «плашмя» к зрителю: при наклоне телефона на себя / от себя кольца ложатся плашмя к новому «низу»
const phiRest = () => P.SPIN_REST - Math.atan2(grav.z, Math.max(0.1, Math.hypot(grav.x, grav.y)));
const zLim = R => engaged(R) ? R.zHole : R.zWall;

function spawnRings(n, D, duo) {
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = D / 2 + P.RIM + 6 + Math.random() * (W - D - 2 * P.RIM - 12);
      y = floorY(x) - P.RIM - 6 - Math.random() * 70;
      const ok = pegs.every(g => Math.abs(x - g.x) > D / 2 + P.RIM + 6) &&
        rings.every(r => Math.hypot((r.a.x + r.b.x) / 2 - x, (r.a.y + r.b.y) / 2 - y) > D * 0.9);
      if (ok) break;
    }
    const ci = duo ? i % 2 : i % PALETTE.length;
    rings.push(makeRing(x, y, (Math.random() - 0.5) * 0.8, D, duo ? DUO[ci] : PALETTE[ci], ci));
  }
}

function integrateRing(R, dt) {
  let tx = R.b.x - R.a.x, ty = R.b.y - R.a.y;
  const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
  const ePar = Math.exp(-P.K_PAR * dt), ePerp = Math.exp(-P.K_PERP * dt);
  const onPeg = R.on >= 0, shelter = onPeg ? PEG_SHELTER : 1;
  // Надетое кольцо выравниваться не стремится, а висит на штыре с наклоном —
  // и чем сильнее наклонено (в плоскости или к зрителю), тем сильнее закусывает стержень
  let rub = 1;
  if (onPeg) {
    const dp = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
    rub = Math.exp(-P.PEG_FRICTION * (1 + P.PEG_BIND * Math.hypot((R.a.y - R.b.y) / R.D, Math.sin(dp))) * dt);
  }
  // Кольцо выравнивается поперёк силы тяжести — при наклоне телефона ложится по новому «низу».
  // Надетое — лишь слегка: иначе висит ребром к струе, и вода не может поднять его со штыря
  const level = (onPeg && !R.support && !R.ground ? PEG_ALIGN : 1) * ((R.a.x - R.b.x) * grav.x + (R.a.y - R.b.y) * grav.y) * P.ALIGN * dt;
  for (let n = 0; n < 2; n++) {
    const p = n ? R.b : R.a, lv = n ? level : -level;
    let vx = (p.x - p.px) / dt + lv * grav.x, vy = (p.y - p.py) / dt;
    vy = vy * rub + lv * grav.y;
    const fu = sample(u, p.x, p.y) * shelter, fv = sample(v, p.x, p.y) * shelter;
    // Сопротивление воды: плашмя кольцо тормозится сильнее, чем ребром — отсюда "планирование"
    const rx = vx - fu, ry = vy - fv, par = rx * tx + ry * ty;
    const ax = par * tx, ay = par * ty;
    vx = fu + ax * ePar + (rx - ax) * ePerp + (P.G * grav.x + shake.x) * dt;
    vy = fv + ay * ePar + (ry - ay) * ePerp + (P.G * grav.y + shake.y) * dt;
    const sp = Math.hypot(vx, vy);
    if (sp > P.MAXV) { vx *= P.MAXV / sp; vy *= P.MAXV / sp; }
    p.px = p.x; p.py = p.y;
    p.x += vx * dt; p.y += vy * dt;
  }
  // Поток плоский и вглубь не толкает: по z кольцо движется от соседей, стёкол, наклона и встряски
  const vz = (R.z - R.pz) * Math.exp(-P.Z_DAMP * dt) + (P.G * grav.z + shake.z) * dt * dt;
  R.pz = R.z; R.z += vz;
}

// Зацепленное кольцо (надетое или заходящее на штырь сверху) держится на стержне здесь.
// Остальные сталкиваются со штырём целиком в collidePegs — если не разошлись с ним по глубине.
function collideStatic(p, R) {
  if (p.x < P.RIM) p.x = P.RIM; else if (p.x > W - P.RIM) p.x = W - P.RIM;
  if (p.y < P.RIM) p.y = P.RIM; else if (p.y > H - P.RIM) p.y = H - P.RIM;
  for (let i = 1; i < FLOOR.length; i++) {
    const [x0, y0] = FLOOR[i - 1], [x1, y1] = FLOOR[i];
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L;
    const t = ((p.x - x0) * dx + (p.y - y0) * dy) / (L * L);
    if (t < 0 || t > 1) continue;
    const s = (p.x - x0) * nx + (p.y - y0) * ny;
    if (s < P.RIM && s > -40) { p.x += nx * (P.RIM - s); p.y += ny * (P.RIM - s); p.c = 1; }
  }
  for (let i = 1; i < FLOOR.length - 1; i++) {
    const dx = p.x - FLOOR[i][0], dy = p.y - FLOOR[i][1], d = Math.hypot(dx, dy);
    if (d < P.RIM && d > 1e-6 && FLOOR[i][1] < FLOOR[i - 1][1]) { p.x += dx / d * (P.RIM - d); p.y += dy / d * (P.RIM - d); p.c = 1; }
  }
  const md = P.RIM + P.PEG_R;
  for (let k = 0; k < pegs.length; k++) {
    const g = pegs[k];
    if (!R.eng[k] || R.hook === k) continue;
    if (p.y < g.tip) {
      const dx = p.x - g.x, dy = p.y - g.tip, d2 = dx * dx + dy * dy;
      if (d2 >= md * md) continue;
      const d = Math.sqrt(d2);
      let nx, ny;
      if (d < 1e-6) { nx = p.px < g.x ? -1 : 1; ny = 0; } else { nx = dx / d; ny = dy / d; }
      p.x = g.x + nx * md; p.y = g.tip + ny * md;
    } else {
      const stop = g.bottom - P.RIM - 3;
      if (p.y > stop) { p.y = stop; p.c = 1; }
      // Штырь в дырке: края кольца всегда по разные стороны стержня — вбок кольцо не соскользнёт,
      // сойти со штыря можно только через верхушку
      const other = p === R.a ? R.b : R.a;
      // Мягко, не больше 3 px за итерацию: если кольцо всё же оказалось сбоку, оно не перескочит через штырь рывком
      const left = p.x < other.x || (p.x === other.x && p === R.a);
      if (left) { if (p.x > g.x - md) p.x -= Math.min(3, p.x - (g.x - md)); } else if (p.x < g.x + md) p.x += Math.min(3, g.x + md - p.x);
    }
  }
}

// Проходит ли штырь сквозь дырку кольца — честно в объёме: кольцо — круг с осью a-b, повёрнутый к зрителю на phi.
// fromTop — только у самой верхушки: так кольцо может нанизаться, а ниже верхушки сбоку его не пустит обод
// tol — запас к радиусу дырки: надетое кольцо держим чуть дольше, чтобы оно не дребезжало на границе
function holeHasPeg(R, g, fromTop, tol = 0) {
  const L = Math.hypot(R.b.x - R.a.x, R.b.y - R.a.y) || 1, tx = (R.b.x - R.a.x) / L, ty = (R.b.y - R.a.y) / L;
  const c = Math.cos(R.phi), nx = ty * c, ny = -tx * c, nz = Math.sin(R.phi);
  const cx = (R.a.x + R.b.x) / 2, cy = (R.a.y + R.b.y) / 2, dx = g.x - cx, rin = R.D / 2 - P.RIM - P.PEG_R + tol;
  if (Math.abs(ny) > 0.2) {
    const y = cy - (nx * dx - nz * R.z) / ny;
    return y >= g.tip - 2 && y <= (fromTop ? g.tip + rin : g.bottom) && Math.hypot(dx, y - cy, R.z) < rin;
  }
  // Кольцо стоит почти вертикально: штырь должен лежать в его плоскости (с допуском на толщину обода —
  // упёршись в обод изнутри, кольцо доворачивается), а верхушка — войти в дырку
  if (Math.abs(nx * dx - nz * R.z) > P.PEG_R + P.RIM) return false;
  const h = Math.hypot(dx, R.z);
  if (h >= rin) return false;
  const half = Math.sqrt(rin * rin - h * h);
  return g.tip < cy + half && (!fromTop || g.tip > cy - half);
}

// Нанизанное на верхушку кольцо (хоть стоймя) повисает на ней и под своим весом переваливается
// поперёк штыря — дальше оно уже обычное надетое
function flopRing(R, g, dt) {
  const cx = (R.a.x + R.b.x) / 2, cy = (R.a.y + R.b.y) / 2, step = P.HOOK_FLOP * dt;
  const e = (Math.atan2(R.b.y - R.a.y, R.b.x - R.a.x) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
  const r = -Math.sign(e) * Math.min(Math.abs(e), step), c = Math.cos(r), s = Math.sin(r);
  const pull = (g.x - cx) * Math.min(1, 8 * dt);
  for (const p of [R.a, R.b]) {
    let rx = p.x - cx, ry = p.y - cy;
    p.x = cx + pull + rx * c - ry * s; p.y = cy + rx * s + ry * c;
    rx = p.px - cx; ry = p.py - cy;
    p.px = cx + pull + rx * c - ry * s; p.py = cy + rx * s + ry * c;
  }
  const rest = ((phiRest() - R.phi) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
  R.phi += clamp(rest, -step, step); R.om *= 0.5;
  shiftZ(R, -R.z * Math.min(1, 8 * dt));
}

// Штырь заходит в дырку, если кольцо пришло сверху, лежит достаточно плашмя и не сдвинуто по глубине так,
// что штырь упрётся в обод, — или если верхушка попала в дырку кольца, как бы оно ни стояло (нанизывание)
function updateThread(R) {
  const lo = Math.min(R.a.x, R.b.x), hi = Math.max(R.a.x, R.b.x);
  const aligned = Math.abs(R.z) <= R.zHole && R.zHole > 0;
  for (let k = 0; k < pegs.length; k++) {
    const g = pegs[k];
    const straddle = lo < g.x - P.PEG_R && hi > g.x + P.PEG_R;
    // Надето, пока стержень проходит сквозь дырку: наклонённое кольцо сходит, как только дырка поднялась над верхушкой
    if (R.on === k && ((R.a.y < g.tip && R.b.y < g.tip) || !holeHasPeg(R, g, false, 1.5))) R.on = -1;
    if (R.a.y < g.tip - P.RIM && R.b.y < g.tip - P.RIM) R.mark[k] = true;
    else if (!straddle) R.mark[k] = false;
    if (R.hook === k) {
      if (straddle && Math.abs(R.b.y - R.a.y) < R.D * 0.5) { R.hook = -1; R.mark[k] = true; }
      else if (!holeHasPeg(R, g, false, 3)) R.hook = -1;
    } else if (R.hook < 0 && R.on < 0 && !R.eng[k] && holeHasPeg(R, g, true)) { R.hook = k; R.mark[k] = true; }
    const cross = straddle ? R.a.y + (R.b.y - R.a.y) * (g.x - R.a.x) / (R.b.x - R.a.x) : H;
    R.eng[k] = R.on === k || R.hook === k || (straddle && R.mark[k] && (R.eng[k] || (aligned && cross < g.tip + 2 * P.RIM)));
    if (R.on < 0 && R.hook < 0 && R.eng[k] && R.a.y > g.tip + 1 && R.b.y > g.tip + 1) R.on = k;
  }
}

// Ближайшие точки отрезков AB и CD: параметры s на AB и t на CD (Ericson, RTCD 5.1.9)
const SEG = { s: 0, t: 0 };
function segParams(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy, rx = ax - cx, ry = ay - cy;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  const c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  SEG.s = s; SEG.t = t;
}

// Сдвинуть точку отрезка-кольца с параметром s на (dx, dy), раздав сдвиг двум концам
function pushRing(R, s, dx, dy) {
  const w = 1 / ((1 - s) * (1 - s) + s * s);
  R.a.x += dx * w * (1 - s); R.a.y += dy * w * (1 - s);
  R.b.x += dx * w * s; R.b.y += dy * w * s;
}

// Кольцо — отрезок толщиной в обод. Разминуться можно в плоскости или по глубине;
// выбираем путь короче, если стёкла (или штырь в дырке) оставляют для него место.
// Развернуть кольцо к зрителю так, чтобы по глубине оно занимало не больше hz
function narrowRing(R, hz) {
  const need = Math.acos(clamp((hz - P.RIM) / (R.D / 2), 0, 1));
  const dp = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2, sg = dp < 0 ? -1 : 1;
  if (Math.abs(dp) >= need) return;
  R.phi += sg * (need - Math.abs(dp));
  if (R.om * sg < 0) R.om = 0;
  updateDepth(R);
}

// Сдвиг по глубине без отскока — иначе кольцо продолжает уплывать от толчка
function shiftZ(R, dz) { R.z += dz; R.pz += dz; }

function ringPair(A, B) {
  const dz = B.z - A.z, sg = dz < 0 ? -1 : 1;
  let penZ = A.hz + B.hz - Math.abs(dz);
  if (penZ <= 0) return;
  segParams(A.a.x, A.a.y, A.b.x, A.b.y, B.a.x, B.a.y, B.b.x, B.b.y);
  const s = SEG.s, t = SEG.t;
  const px = A.a.x + (A.b.x - A.a.x) * s, py = A.a.y + (A.b.y - A.a.y) * s;
  let nx = B.a.x + (B.b.x - B.a.x) * t - px, ny = B.a.y + (B.b.y - B.a.y) * t - py;
  const d = Math.hypot(nx, ny), md = 2 * P.RIM;
  if (d >= md) return;
  // Глубоко вошли друг в друга — значит, одно проплывало перед другим и начало ложиться плашмя.
  // Лечь ему не даём, пока не разминутся, вместо того чтобы отшвыривать вбок
  if (d < P.RIM) {
    const F = !engaged(A) && (engaged(B) || A.hz <= B.hz) ? A : !engaged(B) ? B : null;
    if (F) { narrowRing(F, Math.max(P.RIM, F.hz - penZ)); penZ = A.hz + B.hz - Math.abs(dz); if (penZ <= 0) return; }
  }
  const roomA = Math.max(0, zLim(A) + sg * A.z), roomB = Math.max(0, zLim(B) - sg * B.z);
  if ((penZ < md - d || d < P.RIM) && penZ <= roomA + roomB) {
    const mA = Math.min(roomA, Math.max(penZ / 2, penZ - roomB));
    shiftZ(A, -sg * mA); shiftZ(B, sg * (penZ - mA));
    return;
  }
  if (d < 1e-6) {
    nx = A.a.y - A.b.y; ny = A.b.x - A.a.x;
    if (nx * ((B.a.x + B.b.x) - (A.a.x + A.b.x)) + ny * ((B.a.y + B.b.y) - (A.a.y + A.b.y)) < 0) { nx = -nx; ny = -ny; }
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  } else { nx /= d; ny /= d; }
  const h = (md - d) / 2;
  pushRing(A, s, -nx * h, -ny * h);
  pushRing(B, t, nx * h, ny * h);
  // Надетые на один штырь: верхнее лежит на нижнем — значит, может выровняться в стопку
  if (A.on >= 0 && A.on === B.on && Math.abs(ny) > 0.7) (ny > 0 ? A : B).support = true;
}

// Незацепленное кольцо и штырь: стержень с верхушкой твёрдые, если кольцо не ушло мимо по глубине
function collidePegs(R) {
  for (let k = 0; k < pegs.length; k++) {
    if (R.eng[k]) continue;
    const g = pegs[k], penZ = R.hz + P.PEG_R - Math.abs(R.z);
    if (penZ <= 0) continue;
    segParams(R.a.x, R.a.y, R.b.x, R.b.y, g.x, g.tip, g.x, g.bottom);
    const s = SEG.s, qy = g.tip + (g.bottom - g.tip) * SEG.t;
    let nx = R.a.x + (R.b.x - R.a.x) * s - g.x, ny = R.a.y + (R.b.y - R.a.y) * s - qy;
    const d = Math.hypot(nx, ny), md = P.RIM + P.PEG_R;
    if (d >= md) continue;
    const side = R.z < 0 ? -1 : 1;
    if (penZ < md - d && penZ <= R.zWall - Math.abs(R.z)) { shiftZ(R, side * penZ); continue; }
    // Глубоко зашло — проплывало перед штырём или за ним и начало ложиться. Держим его развёрнутым
    // и отодвинутым по глубине, пока не минует стержень, а не отшвыриваем вбок
    if (d < P.RIM) {
      const zt = clamp(Math.abs(R.z), P.PEG_R + P.RIM + 0.5, P.TANK_Z - P.RIM);
      narrowRing(R, Math.min(zt - P.PEG_R, P.TANK_Z - zt));
      shiftZ(R, side * zt - R.z);
      continue;
    }
    nx /= d; ny /= d;
    pushRing(R, s, nx * (md - d), ny * (md - d));
    // Упёршись в стержень краем, кольцо проворачивается к зрителю и соскальзывает за штырь или перед ним
    const dp = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2, tw = (dp < 0 ? -1 : 1) * (md - d) * P.PEG_TWIST;
    R.phi += tw; R.om += tw * 10;
    shiftZ(R, side * (md - d) * 0.5);
  }
}

function physics(dt) {
  for (const R of rings) {
    updateDepth(R); integrateRing(R, dt); R.support = false;
    // Верхушка вошла в дырку — кольцо нанизано, и стержень его больше не отталкивает
    // (проверяем до столкновений, иначе стержень успеет развернуть кольцо и отодвинуть его)
    if (R.hook < 0 && R.on < 0) for (let k = 0; k < pegs.length; k++) {
      if (!R.eng[k] && holeHasPeg(R, pegs[k], true)) { R.hook = k; R.mark[k] = R.eng[k] = true; break; }
    }
    if (R.hook >= 0) flopRing(R, pegs[R.hook], dt);
  }
  for (let it = 0; it < 4; it++) {
    for (const R of rings) {
      const dx = R.b.x - R.a.x, dy = R.b.y - R.a.y, d = Math.hypot(dx, dy) || 1e-6, k = (d - R.D) / d * 0.5;
      R.a.x += dx * k; R.a.y += dy * k; R.b.x -= dx * k; R.b.y -= dy * k;
    }
    for (const R of rings) {
      const lim = zLim(R), z = clamp(R.z, -lim, lim);
      if (z !== R.z) R.z = R.pz = z;
      collidePegs(R);
      collideStatic(R.a, R); collideStatic(R.b, R);
    }
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) ringPair(rings[i], rings[j]);
  }
  for (const R of rings) {
    R.ground = false;
    for (let n = 0; n < 2; n++) {
      const p = n ? R.b : R.a;
      if (p.c) { p.px = p.x - (p.x - p.px) * 0.985; p.py = p.y - (p.y - p.py) * 0.985; p.c = 0; R.ground = true; }
    }
  }
  for (const R of rings) updateThread(R);
}

function updateSpin(R, dt) {
  const cx = (R.a.x + R.b.x) / 2, cy = (R.a.y + R.b.y) / 2;
  const vx = (R.a.x - R.a.px + R.b.x - R.b.px) / 2, vy = (R.a.y - R.a.py + R.b.y - R.b.py) / 2;
  const speed = Math.hypot(vx, vy) / (P.STEP / P.SUB);
  const rel = Math.hypot(vx / (P.STEP / P.SUB) - sample(u, cx, cy), vy / (P.STEP / P.SUB) - sample(v, cx, cy));
  const target = clamp(-sample(curl, cx, cy) * P.SPIN_K, -P.SPIN_MAX, P.SPIN_MAX);
  R.om += (target - R.om) * (1 - Math.exp(-3 * dt)) + (Math.random() - 0.5) * rel * 0.02;
  // Тонущее кольцо и само разворачивается плашмя, но вихрь его легко перебарывает; легшее на дно — ложится плашмя сразу.
  // Надетое висит как повисло (трение о стержень гасит вращение), а легши на полку или на кольцо под ним —
  // выравнивается в ровную стопку. «Плашмя» — относительно силы тяжести, с учётом наклона телефона
  const rest = ((phiRest() - R.phi) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
  const settled = R.on >= 0 && (R.support || R.ground);
  if (R.on >= 0 && !settled) R.om *= Math.exp(-6 * dt);
  else if (settled || (speed < 25 && R.ground)) {
    R.om += rest * 40 * dt;
    R.om *= Math.exp(-6 * dt);
  } else R.om += rest * P.PHI_ALIGN * dt;
  R.om = clamp(R.om, -P.SPIN_MAX, P.SPIN_MAX);
  R.phi += R.om * dt;
  // Штырь в дырке не даёт кольцу встать к зрителю: наклон ограничен, пока обод не упрётся в стержень
  if (engaged(R)) {
    const maxTilt = Math.acos(Math.min(1, (Math.abs(R.z) + P.RIM + P.PEG_R) / (R.D / 2)));
    const d = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
    if (Math.abs(d) > maxTilt) {
      R.phi -= d - Math.sign(d) * maxTilt;
      if (R.om * d > 0) R.om = 0;
    }
  }
  // Завихрения понемногу гоняют кольцо вперёд-назад по глубине
  const j = (Math.random() - 0.5) * rel * P.Z_JITTER * dt;
  R.z += j; R.pz += j;
}

function checkThreads(dt) {
  for (const R of rings) {
    updateSpin(R, dt);
    R.tinkT -= dt;
    if (R.on === R.shown) continue;
    if (R.on >= 0 && state === 'play' && R.tinkT <= 0) {
      const good = mode !== 'colors' || R.on === R.ci;
      soundCue(good ? 'ring' : 'wrong');
      burst((R.a.x + R.b.x) / 2, (R.a.y + R.b.y) / 2, good ? R.col : '#ffffff', 8);
      R.tinkT = 0.6;
    }
    R.shown = R.on;
  }
}

// ---------- Эффекты ----------
const bubbles = [], sparks = [], specks = [];
for (let i = 0; i < 90; i++) specks.push({ x: Math.random() * W, y: Math.random() * H });

function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 90;
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, col });
  }
}

function updateFx(dt) {
  for (let s = 0; s < 2; s++) {
    const p = pumps[s], n = nozzles[s];
    p.emit += p.flow * 80 * dt;
    while (p.emit >= 1) {
      p.emit -= 1;
      if (bubbles.length < 320) bubbles.push({
        x: n.x + (Math.random() - 0.5) * 10, y: n.y - 6, r: 1.2 + Math.random() * 3.2,
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
    if (s.x < 2 || s.x > W - 2 || s.y < 2 || s.y > H - 2) { s.x = 4 + Math.random() * (W - 8); s.y = 4 + Math.random() * (H - 8); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94;
    if (s.life <= 0) sparks.splice(i, 1);
  }
}

// ---------- Звук ----------
// Автономный синтезатор: без файлов, шумовых петель и игрового Math.random.
let actx = null, audioMaster = null, musicBus = null, sfxBus = null;
let musicOn = true, sfxOn = true, musicStep = 0, nextMusic = 0, audioSeed = 173;
const audioVoices = new Set(), nextBubble = [0, 0];
const MUSIC_STEP = 0.375; // 80 BPM, спокойные восьмые
const MUSIC_NOTES = [
  76, 0, 79, 0, 81, 79, 0, 76, 74, 0, 72, 0, 74, 0, 0, 0,
  72, 0, 76, 0, 79, 0, 81, 0, 79, 76, 0, 74, 72, 0, 0, 0,
  74, 0, 77, 0, 81, 79, 0, 77, 76, 0, 74, 0, 72, 0, 0, 0,
  74, 0, 79, 0, 83, 0, 81, 79, 77, 0, 74, 0, 79, 0, 0, 0
];
const MUSIC_CHORDS = [[48, 55, 64], [45, 52, 60], [53, 60, 69], [43, 50, 62]];
try {
  musicOn = localStorage.getItem('rings_music') !== '0';
  sfxOn = localStorage.getItem('rings_sfx') !== '0';
} catch (_) { }
const noteHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
function soundRandom() {
  audioSeed = (Math.imul(audioSeed, 1664525) + 1013904223) >>> 0;
  return audioSeed / 4294967296;
}
function initAudio() {
  try {
    if (!actx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      actx = new Audio();
      audioMaster = actx.createGain(); audioMaster.gain.value = 0.7;
      musicBus = actx.createGain(); musicBus.gain.value = 0;
      sfxBus = actx.createGain(); sfxBus.gain.value = sfxOn ? 0.6 : 0;
      musicBus.connect(audioMaster); sfxBus.connect(audioMaster);
      audioMaster.connect(actx.destination);
      nextMusic = actx.currentTime + 0.04;
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
  } catch (e) { actx = null; }
}
function stopVoices(bus) {
  for (const v of audioVoices) if (!bus || v.bus === bus) {
    try { v.o.stop(); } catch (_) { }
    v.o.disconnect(); v.g.disconnect(); audioVoices.delete(v);
  }
}
function audioScene() {
  if (!actx) return;
  const quiet = document.hidden || state === 'pause', t = actx.currentTime;
  audioMaster.gain.setTargetAtTime(quiet ? 0 : 0.7, t, 0.04);
  musicBus.gain.setTargetAtTime(!quiet && musicOn && (state === 'play' || state === 'menu') ? 0.16 : 0, t, 0.15);
  sfxBus.gain.setTargetAtTime(sfxOn ? 0.6 : 0, t, 0.02);
  if (quiet || !musicOn || state === 'over') {
    stopVoices(quiet ? null : musicBus);
    nextMusic = t + 0.04;
  }
  if (document.hidden && actx.state === 'running') actx.suspend().catch(() => {});
}
function audioTone(freq, at, duration, volume, bus, endFreq = freq, attack = 0.012) {
  if (!actx || document.hidden || state === 'pause' || audioVoices.size >= 24) return;
  if ((bus === musicBus && !musicOn) || (bus === sfxBus && !sfxOn)) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, at);
  if (freq !== endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + duration * 0.85);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(volume, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  o.connect(g); g.connect(bus);
  const voice = { o, g, bus }; audioVoices.add(voice);
  o.onended = () => { o.disconnect(); g.disconnect(); audioVoices.delete(voice); };
  o.start(at); o.stop(at + duration + 0.025);
}
function bubbleSound(side, strength = 0.5, small = false) {
  if (!actx || !sfxOn || state !== 'play') return;
  const t = actx.currentTime, f = (side ? 420 : 340) * (0.88 + soundRandom() * 0.32);
  audioTone(f * 1.7, t, small ? 0.10 : 0.17, small ? 0.07 : 0.10 + strength * 0.045, sfxBus, f * 0.65);
  if (!small) audioTone(f * 1.15, t + 0.065, 0.13, 0.065, sfxBus, f * 0.55);
  nextBubble[side] = t + 0.15 + soundRandom() * 0.10;
}
function soundCue(name) {
  if (!actx || !sfxOn) return;
  const cues = {
    start: [72, 76, 79], ring: [84, 91], wrong: [67, 64],
    wave: [79, 84, 88, 91], win: [72, 76, 79, 84, 88],
    end: [79, 76, 72], tap: [79]
  };
  const notes = cues[name] || cues.tap, t = actx.currentTime;
  notes.forEach((n, i) => audioTone(noteHz(n), t + i * 0.09, name === 'win' ? 0.5 : 0.27,
    name === 'ring' ? 0.12 : 0.08, sfxBus));
}
function audioUpdate() {
  if (!actx || actx.state !== 'running' || document.hidden || state === 'pause') return;
  const t = actx.currentTime;
  if (musicOn && (state === 'play' || state === 'menu')) {
    if (nextMusic < t - 0.2) nextMusic = t + 0.025; // Не догоняем пропущенные ноты.
    while (nextMusic < t + 0.12) {
      const step = musicStep % MUSIC_NOTES.length, note = MUSIC_NOTES[step];
      if (note) audioTone(noteHz(note), nextMusic, 0.65, 0.095, musicBus);
      if (step % 16 === 0) for (const n of MUSIC_CHORDS[step / 16]) {
        audioTone(noteHz(n), nextMusic, 5.6, 0.035, musicBus, noteHz(n), 0.35);
      }
      nextMusic += MUSIC_STEP; musicStep++;
    }
  }
  if (state === 'play' && sfxOn) for (let side = 0; side < 2; side++) {
    const p = pumps[side];
    if (p.held && p.flow > 0.08 && t >= nextBubble[side]) bubbleSound(side, p.flow, true);
  }
}
// ---------- Конец звука ----------

// ---------- Режимы и игра ----------
const MODES = {
  classic: { name: 'Классика' },
  colors: { name: 'Два цвета' },
  waves: { name: 'Волны' }
};
let state = 'menu', mode = 'classic', game = null, toastText = '', toastT = 0;

function toast(t) { toastText = t; toastT = 1.8; }


function startGame(m) {
  mode = m; initAudio(); resetFluid(); resetPumps(); resetMotion();
  if (motion.on) enableMotion();
  // Как держат телефон при старте — так кадр и закрепляем
  if (touchDevice()) { pickGameAngle(); layout(); lockScreen(); }
  rings = []; bubbles.length = 0; sparks.length = 0;
  game = { t: 0, left: 0, score: 0, wave: 1, hold: 0, presses: 0 };
  if (m === 'classic') { spawnRings(8, P.RING_D, false); toast('Надень все кольца'); }
  else if (m === 'colors') { game.left = 90; spawnRings(8, P.RING_D - 2, true); toast('Красные — влево, синие — вправо'); }
  else { game.left = 60; spawnWave(); toast('Волна 1'); }
  state = 'play';
  if (!tutSeen() || tut.force) tutStart();
  show(null);
  soundCue('start');
}

// ---------- Подсказка для первой игры ----------
// Поверх игры, ничего не блокирует: две блеклые полоски — зоны насосов (снизу слабо, сверху сильно),
// и палец показывает: нажми слева, веди вверх — струя сильнее; потом справа. Гаснет сама,
// когда игрок нажал по паре раз каждым насосом, и больше не показывается
// done — на случай, если хранилище недоступно (приватный режим): тогда хотя бы до перезагрузки не повторяем
const tut = { on: false, a: 0, t: 0, presses: [0, 0], force: false, done: false };
function tutSeen() { try { return tut.done || localStorage.getItem('rings_tut') === '1'; } catch (e) { return tut.done; } }
function tutStart() { Object.assign(tut, { on: true, a: 0, t: 0, presses: [0, 0], force: false }); }
function tutUpdate(dt) {
  if (!tut.on) return;
  tut.t += dt;
  const done = tut.presses[0] >= 2 && tut.presses[1] >= 2;
  tut.a = clamp(tut.a + (done ? -dt / 0.6 : dt / 0.5), 0, 1);
  if (done && tut.a <= 0) { tut.on = false; tut.done = true; try { localStorage.setItem('rings_tut', '1'); } catch (e) { } }
}

function spawnWave() {
  const n = Math.min(10, 4 + game.wave), D = Math.max(P.RING_D - 12, P.RING_D + 2 - 3 * (game.wave - 1));
  spawnRings(n, D, false);
}

function gameLogic(dt) {
  game.t += dt;
  if (mode === 'classic') {
    game.hold = rings.every(r => r.on >= 0) ? game.hold + dt : 0;
    if (game.hold > 1) {
      const best = getBest('classic'), rec = best == null || game.t < best;
      if (rec) setBest('classic', game.t);
      endGame('Готово!', `Время: ${game.t.toFixed(1)} с · нажатий: ${game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best.toFixed(1)} с`);
    }
  } else if (mode === 'colors') {
    game.left -= dt;
    const good = rings.filter(r => r.on === r.ci).length;
    game.hold = good === rings.length ? game.hold + dt : 0;
    if (game.hold > 1) {
      const best = getBest('colors'), rec = best == null || game.left > best;
      if (rec) setBest('colors', game.left);
      endGame('Победа!', `Осталось времени: ${game.left.toFixed(1)} с · нажатий: ${game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best.toFixed(1)} с в запасе`);
    } else if (game.left <= 0) {
      game.left = 0;
      endGame('Время вышло', `Правильно надето: ${good} из ${rings.length} · нажатий: ${game.presses}`, '');
    }
  } else {
    game.left -= dt;
    game.hold = rings.every(r => r.on >= 0) ? game.hold + dt : 0;
    if (game.hold > 0.6) {
      for (const R of rings) burst((R.a.x + R.b.x) / 2, (R.a.y + R.b.y) / 2, R.col, 6);
      game.score += rings.length;
      game.wave++; game.left += 12; game.hold = 0;
      rings = []; spawnWave(); soundCue('wave');
      toast(`Волна ${game.wave}  +12 с`);
    } else if (game.left <= 0) {
      game.left = 0;
      const total = game.score + rings.filter(r => r.on >= 0).length;
      const best = getBest('waves'), rec = best == null || total > best;
      if (rec) setBest('waves', total);
      endGame('Время вышло', `Колец надето: ${total} · дошёл до волны ${game.wave} · нажатий: ${game.presses}`, rec ? 'Новый рекорд!' : `Рекорд: ${best} колец`);
    }
  }
}

function endGame(title, text, best) {
  state = 'over';
  resetPumps();
  document.getElementById('resTitle').textContent = title;
  document.getElementById('resText').textContent = text;
  document.getElementById('resBest').textContent = best;
  show('result');
  soundCue(title === 'Готово!' || title === 'Победа!' ? 'win' : 'end');
}

// Хранилище бывает недоступно (приватный режим, встроенные браузеры) — тогда просто без рекордов
function getBest(m) {
  let v = null;
  try { v = localStorage.getItem('rings_best_' + m); } catch (e) { }
  return v == null ? null : +v;
}
function setBest(m, v) { try { localStorage.setItem('rings_best_' + m, String(v)); } catch (e) { } }

function refreshBest() {
  const c = getBest('classic'), k = getBest('colors'), w = getBest('waves');
  document.getElementById('best-classic').textContent = c == null ? 'Надень все 8 колец на скорость' : `Рекорд: ${c.toFixed(1)} с`;
  document.getElementById('best-colors').textContent = k == null ? 'Каждый цвет — на свой столбик за 90 с' : `Рекорд: ${k.toFixed(1)} с в запасе`;
  document.getElementById('best-waves').textContent = w == null ? 'Кольца всё меньше, а их всё больше' : `Рекорд: ${w} колец`;
}

let demoT = 1;
function demo(dt) {
  demoT -= dt;
  if (demoT > 0) return;
  const p = pumps[Math.random() < 0.5 ? 0 : 1];
  if (!p.held) { p.held = true; p.base = 0.45 + Math.random() * 0.55; p.auto = 0.2 + Math.random() * 0.5; }
  demoT = 0.6 + Math.random() * 1.6;
}

function tick(dt) {
  if (state === 'menu') demo(dt);
  updateMotion(dt);
  updatePump(pumps[0], dt); updatePump(pumps[1], dt);
  inject(0); inject(1);
  fluidStep(dt);
  for (let i = 0; i < P.SUB; i++) physics(dt / P.SUB);
  checkThreads(dt);
  updateFx(dt);
  if (state === 'play') { gameLogic(dt); tutUpdate(dt); }
  if (toastT > 0) toastT -= dt;
}

// ---------- Экран и управление ----------
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
let sw = 0, sh = 0, dpr = 1, S = 1, tankX = 0, tankY = 0, tankW = 0, tankH = 0, hudH = 52, wide = false, wasLand = null;
let safeL = 0, safeT = 0, safeR = 0, safeB = 0;
const PAD = 8, GAUGE_W = 16;

// ---------- Ориентация ----------
// gameAngle — как стоит игровой кадр относительно «родной» ориентации устройства (в смысле screen.orientation.angle).
// Всегда основная альбомная ориентация, без переключения поля.
// низ остаётся у того же края корпуса. Если браузер сам повернул экран, кадр поворачиваем обратно на rot.
// На компьютере (без касаний) не поворачиваем ничего
const root = document.getElementById('root');
let gameAngle = 0, rot = 0;
// Телефон или планшет — основной ввод пальцем. Сенсорный ноутбук или встроенный браузер с касаниями сюда не попадают
const touchDevice = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
function screenAngle() {
  const o = window.screen && window.screen.orientation;
  return (((o ? o.angle : window.orientation) || 0) % 360 + 360) % 360;
}
function pickGameAngle() {
  const a = screenAngle(), natLand = a % 180 === 0 ? window.innerWidth > window.innerHeight : window.innerWidth <= window.innerHeight;
  gameAngle = natLand ? 0 : 90;
}
// Координаты касания из окна браузера — в игровой кадр
function toRoot(e) {
  const vw = window.innerWidth, vh = window.innerHeight, x = e.clientX, y = e.clientY;
  return rot === 90 ? [y, vw - x] : rot === 180 ? [vw - x, vh - y] : rot === 270 ? [vh - y, x] : [x, y];
}
// Приложение для Android (Capacitor): модули доступны через Capacitor.Plugins, в браузере их нет
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plug = name => (native && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

// Закрепляем основную альбомную ориентацию: в приложении — нативно (кадр поворачивать не нужно),
// в браузере на Android — через полноэкранный режим, если он поддерживает блокировку.
async function lockScreen() {
  const so = plug('ScreenOrientation');
  if (so) { try { await so.lock({ orientation: 'landscape-primary' }); } catch (e) { } return; }
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape-primary');
  } catch (e) { }
}

// В портрете сверху полоса со счётом; в ландшафте аквариум во всю высоту, а счёт — по бокам от него
function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  pickGameAngle();
  if (native) { gameAngle = screenAngle(); rot = 0; }
  else rot = touchDevice() ? ((gameAngle - screenAngle()) % 360 + 360) % 360 : 0;
  const side = rot === 90 || rot === 270;
  sw = side ? vh : vw; sh = side ? vw : vh;
  root.style.width = sw + 'px'; root.style.height = sh + 'px';
  root.classList.toggle('short', sh < 520);
  root.style.transform = rot === 90 ? `translate(${vw}px,0) rotate(90deg)` : rot === 180 ? `translate(${vw}px,${vh}px) rotate(180deg)`
    : rot === 270 ? `translate(0,${vh}px) rotate(270deg)` : '';
  canvas.width = Math.round(sw * dpr); canvas.height = Math.round(sh * dpr);
  canvas.style.width = sw + 'px'; canvas.style.height = sh + 'px';
  // Вырез под камеру: приложение рисует весь экран, а счёт, колбы и аквариум держим вне выреза.
  // Размеры выреза присылает Android (MainActivity), в браузере их нет
  const si = (native && window.__safeInsets) || {};
  safeL = si.l || 0; safeT = si.t || 0; safeR = si.r || 0; safeB = si.b || 0;
  if (native) { root.style.setProperty('--safe-l', safeL + 'px'); root.style.setProperty('--safe-r', safeR + 'px'); }
  const uw = sw - safeL - safeR, uh = sh - safeT - safeB;
  wide = (uw - (uh - 2 * PAD) * W / H) / 2 >= 72;
  hudH = wide ? 0 : clamp(uh * 0.07, 48, 64);
  const availW = uw - 2 * PAD, availH = uh - hudH - 2 * PAD;
  S = Math.min(availW / W, availH / H);
  tankW = W * S; tankH = H * S;
  tankX = safeL + (uw - tankW) / 2; tankY = safeT + hudH + (availH - tankH) / 2 + PAD;
  pauseBtn.style.left = (wide ? sw - safeR - PAD - GAUGE_W - 10 - 44 : safeL + uw / 2 + 44) + 'px';
  pauseBtn.style.top = safeT + (wide ? PAD : Math.max(2, (hudH - 44) / 2 + 2)) + 'px';
  // Телефон повернули — наклон отсчитываем заново от нового положения
  const land = sw > sh;
  if (wasLand !== null && land !== wasLand) motion.m0 = motion.z0 = null;
  wasLand = land;
}

// Левая/правая половина экрана; чем выше касание, тем сильнее струя. Шкала силы — вся высота кадра.
function strengthFromY(y) {
  return 0.18 + 0.82 * clamp((sh - y) / sh, 0, 1);
}

function press(side, y, id, strong) {
  const p = pumps[side];
  p.held = true; p.id = id; p.auto = 0; p.boost = 0;
  p.y = p.lastY = y == null ? 0 : y; p.lastT = performance.now();
  p.base = y == null ? (strong ? 1 : 0.65) : strengthFromY(y);
  const ms = 6 + Math.round(p.base * 24), hap = plug('Haptics');
  if (hap) hap.vibrate({ duration: ms }).catch(() => { });
  else if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { }
  bubbleSound(side, p.base);
  if (state === 'play') { game.presses++; if (tut.on) tut.presses[side]++; }
}
function release(side) {
  if (pumps[side].held) bubbleSound(side, 0.3, true);
  pumps[side].held = false; pumps[side].id = null;
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  initAudio();
  const [x, y] = toRoot(e);
  if (state !== 'play') return;
  press(x < sw / 2 ? 0 : 1, y, e.pointerId);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
}, { passive: false });

canvas.addEventListener('pointermove', e => {
  for (let s = 0; s < 2; s++) {
    const p = pumps[s];
    if (!p.held || p.id !== e.pointerId) continue;
    const y = toRoot(e)[1], now = performance.now(), vy = (y - p.lastY) / Math.max(1, now - p.lastT) * 1000;
    if (vy < -400) p.boost = Math.min(0.4, Math.max(p.boost, (-vy - 400) / 2500));
    p.y = p.lastY = y; p.lastT = now;
    p.base = strengthFromY(y);
  }
});
const endPointer = e => { for (let s = 0; s < 2; s++) if (pumps[s].id === e.pointerId) release(s); };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

const KEYS = { KeyA: 0, ArrowLeft: 0, KeyL: 1, ArrowRight: 1 };
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play') pauseGame(); else if (state === 'pause') resumeGame(); return; }
  // Без телефона: Q / E — наклон, пробел — стукнуть по аквариуму снизу
  if (e.code === 'KeyQ' || e.code === 'KeyE') { motion.keyTilt = e.code === 'KeyQ' ? -1 : 1; return; }
  if (e.code === 'Space') { e.preventDefault(); shake.x = (Math.random() - 0.5) * 1600; shake.y = -4000;
    if (state === 'play') { initAudio(); bubbleSound(0, 1); bubbleSound(1, 1); } return; }
  const s = KEYS[e.code];
  if (s === undefined || e.repeat || state !== 'play') return;
  initAudio();
  press(s, null, 'key', e.shiftKey);
});
window.addEventListener('keyup', e => {
  if ((e.code === 'KeyQ' && motion.keyTilt < 0) || (e.code === 'KeyE' && motion.keyTilt > 0)) motion.keyTilt = 0;
  const s = KEYS[e.code]; if (s !== undefined && pumps[s].id === 'key') release(s);
});

// ---------- Меню ----------
const overlays = { menu: document.getElementById('menu'), pause: document.getElementById('pause'), result: document.getElementById('result') };
const pauseBtn = document.getElementById('pauseBtn');
function show(name) {
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== name);
  pauseBtn.classList.toggle('hidden', state !== 'play');
  if (name === 'menu') refreshBest();
  audioScene();
}
function pauseGame() { if (state !== 'play') return; state = 'pause'; resetPumps(); show('pause'); }
function resumeGame() { initAudio(); state = 'play'; show(null); }
function toMenu() { state = 'menu'; resetFluid(); resetPumps(); rings = []; spawnRings(8, P.RING_D, false); show('menu'); }

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.mode)));
document.querySelectorAll('.toMenu').forEach(b => b.addEventListener('click', toMenu));
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartBtn').addEventListener('click', () => startGame(mode));
document.getElementById('againBtn').addEventListener('click', () => startGame(mode));
pauseBtn.addEventListener('click', pauseGame);
document.getElementById('howBtn').addEventListener('click', () => { tut.force = true; startGame('classic'); });

// Кадр повёрнут относительно экрана (телефон с выключенным автоповоротом) — браузер прокручивал бы меню
// поперёк пальца. Тогда прокручиваем сами, переводя сдвиг пальца в координаты кадра
for (const o of Object.values(overlays)) {
  let lastY = null;
  o.addEventListener('touchstart', e => { lastY = rot ? toRoot(e.touches[0])[1] : null; }, { passive: true });
  o.addEventListener('touchmove', e => {
    if (lastY === null) return;
    const y = toRoot(e.touches[0])[1];
    o.scrollTop -= y - lastY; lastY = y;
    e.preventDefault();
  }, { passive: false });
  o.addEventListener('touchend', () => { lastY = null; });
}

const tiltBtn = document.getElementById('tiltBtn');
try { motion.on = localStorage.getItem('rings_tilt') !== '0'; } catch (e) { }
function refreshTilt() { tiltBtn.textContent = `Наклон и тряска: ${motion.on ? 'вкл' : 'выкл'}`; }
if (window.DeviceMotionEvent && touchDevice()) tiltBtn.classList.remove('hidden');
tiltBtn.addEventListener('click', () => {
  motion.on = !motion.on;
  try { localStorage.setItem('rings_tilt', motion.on ? '1' : '0'); } catch (e) { }
  if (motion.on) enableMotion(); else resetMotion();
  refreshTilt();
});
refreshTilt();
function refreshSoundButtons() {
  for (const [selector, label, on] of [['.musicBtn', 'Музыка', musicOn], ['.sfxBtn', 'Звуки', sfxOn]]) {
    document.querySelectorAll(selector).forEach(b => {
      b.textContent = `${label}: ${on ? 'вкл' : 'выкл'}`;
      b.setAttribute('aria-pressed', String(on));
    });
  }
}
for (const [selector, key] of [['.musicBtn', 'rings_music'], ['.sfxBtn', 'rings_sfx']]) {
  document.querySelectorAll(selector).forEach(b => b.addEventListener('click', () => {
    initAudio();
    if (key === 'rings_music') musicOn = !musicOn; else sfxOn = !sfxOn;
    try { localStorage.setItem(key, (key === 'rings_music' ? musicOn : sfxOn) ? '1' : '0'); } catch (_) { }
    if (!sfxOn) stopVoices(sfxBus);
    refreshSoundButtons(); audioScene();
  }));
}
refreshSoundButtons();
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); audioScene(); });

// Кнопка «Назад» в приложении: в игре — пауза, на паузе — продолжить, после партии — в меню, в меню — свернуть
const appPlug = plug('App');
if (appPlug) {
  appPlug.addListener('backButton', () => {
    if (state === 'play') pauseGame();
    else if (state === 'pause') resumeGame();
    else if (state === 'over') toMenu();
    else appPlug.minimizeApp();
  });
  appPlug.addListener('appStateChange', s => { if (!s.isActive) pauseGame(); });
}

['orientationchange', 'resize'].forEach(ev => window.addEventListener(ev, layout));
if (window.screen && screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', layout);

// ---------- Отрисовка ----------
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRing(R, front) {
  const a = R.a, b = R.b, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.cos(ang) < 0) ang += Math.PI;
  const s = Math.sin(R.phi), rx = R.D / 2, ry = rx * Math.max(0.07, Math.abs(s));
  const a0 = (front ? 0 : Math.PI) + (s < 0 ? Math.PI : 0);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, ang, a0, a0 + Math.PI);
  ctx.lineWidth = P.RIM * 2; ctx.strokeStyle = front ? R.col : R.dark; ctx.stroke();
  if (front) {
    const sg = s < 0 ? -1 : 1, ox = Math.sin(ang) * P.RIM * 0.4 * sg, oy = -Math.cos(ang) * P.RIM * 0.4 * sg;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rx, ry, ang, a0 + 0.35, a0 + Math.PI - 0.35);
    ctx.lineWidth = P.RIM * 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
  }
}

function render(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, sh);
  bg.addColorStop(0, '#ff6b5b'); bg.addColorStop(1, '#b52a28');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, sw, sh);

  // аквариум
  ctx.save();
  ctx.translate(tankX, tankY); ctx.scale(S, S);
  rr(0, 0, W, H, 18); ctx.clip();
  const wg = ctx.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, '#8fe0ff'); wg.addColorStop(1, '#1d6fd6');
  ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

  const tm = now / 1000;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < W / 120; i++) {
    const x0 = 40 + i * 120 + Math.sin(tm * 0.4 + i * 2) * 30;
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 40, 0); ctx.lineTo(x0 - 60, H); ctx.lineTo(x0 - 130, H); ctx.closePath(); ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const s of specks) ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);

  ctx.beginPath(); ctx.moveTo(0, H);
  for (const [x, y] of FLOOR) ctx.lineTo(x, y);
  ctx.lineTo(W, H); ctx.closePath();
  const fg = ctx.createLinearGradient(0, H - 60, 0, H);
  fg.addColorStop(0, '#f4f7fb'); fg.addColorStop(1, '#b9c6d8');
  ctx.fillStyle = fg; ctx.fill();

  for (const g of pegs) {
    const fy = floorY(g.x);
    ctx.fillStyle = 'rgba(20,50,100,0.35)'; rr(g.x - 5, g.bottom, 10, fy - g.bottom + 4, 3); ctx.fill();
  }

  // Рисуем по глубине: дальние половины колец, штыри посередине (z = 0), ближние половины
  ctx.lineCap = 'butt';
  const layers = [];
  for (let k = 0; k < pegs.length; k++) layers.push({ z: 0, k });
  for (const R of rings) layers.push({ z: R.z - R.hz / 2, R, front: false }, { z: R.z + R.hz / 2, R, front: true });
  layers.sort((p, q) => p.z - q.z);
  for (const it of layers) {
    if (it.R) { drawRing(it.R, it.front); continue; }
    const k = it.k, g = pegs[k];
    const pg = ctx.createLinearGradient(g.x - P.PEG_R, 0, g.x + P.PEG_R, 0);
    pg.addColorStop(0, '#8d9bb0'); pg.addColorStop(0.4, '#ffffff'); pg.addColorStop(1, '#7a879b');
    ctx.fillStyle = pg; rr(g.x - P.PEG_R, g.tip - P.PEG_R, P.PEG_R * 2, g.bottom - g.tip + P.PEG_R, P.PEG_R); ctx.fill();
    ctx.fillStyle = '#dfe6ef'; rr(g.x - P.SHELF_W / 2, g.bottom - 3, P.SHELF_W, 7, 3.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(g.x - P.SHELF_W / 2, g.bottom + 1, P.SHELF_W, 3, 1.5); ctx.fill();
    if (mode === 'colors' && state !== 'menu') {
      ctx.beginPath(); ctx.arc(g.x, g.tip, P.PEG_R + 2.5, 0, Math.PI * 2); ctx.fillStyle = DUO[k]; ctx.fill();
    }
  }

  for (const n of nozzles) {
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.atan2(n.dy, n.dx) + Math.PI / 2);
    ctx.fillStyle = '#2b3a55'; rr(-8, -4, 16, 16, 4); ctx.fill();
    ctx.fillStyle = '#111a2b'; rr(-4, -6, 8, 6, 2); ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }

  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, s.life / 0.6);
    ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.13)'; rr(10, 14, 10, H - 28, 5); ctx.fill();
  ctx.restore();

  rr(tankX - 4, tankY - 4, tankW + 8, tankH + 8, 18 * S + 4);
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();

  if (state === 'play' || state === 'pause') drawHud();
  if (tut.on && state === 'play') drawTutorial();

  if (toastT > 0 && state === 'play') {
    ctx.globalAlpha = Math.min(1, toastT / 0.4);
    ctx.font = `800 ${Math.round(clamp(tankW * 0.075, 18, 30))}px system-ui`; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,40,90,0.6)'; ctx.fillStyle = '#fff';
    ctx.strokeText(toastText, sw / 2, tankY + tankH * 0.3); ctx.fillText(toastText, sw / 2, tankY + tankH * 0.3);
    ctx.globalAlpha = 1;
  }
}

// Насос в углу: колба с водой — сколько её осталось в насосе. Пока жмёшь — светлеет и убывает,
// отпустил — быстро набирается; почти пустая краснеет
function drawPump(p, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(x, y, w, h, w / 2); ctx.fill();
  const ih = h - 4, fh = Math.max(0, ih * p.stroke);
  if (fh > 0.5) {
    ctx.fillStyle = p.stroke < 0.2 ? '#ff8a7a' : p.flow > 0.05 ? '#e6fbff' : '#6fd6ff';
    rr(x + 2, y + 2 + ih - fh, w - 4, fh, (w - 4) / 2); ctx.fill();
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; rr(x, y, w, h, w / 2); ctx.stroke();
}

function drawHud() {
  const gh = wide ? 72 : hudH - 14, gy = safeT + (wide ? PAD : 7), gl = safeL + PAD, gr = sw - safeR - PAD - GAUGE_W;
  drawPump(pumps[0], gl, gy, GAUGE_W, gh);
  drawPump(pumps[1], gr, gy, GAUGE_W, gh);
  let score;
  if (mode === 'colors') score = `${rings.filter(r => r.on === r.ci).length}/${rings.length}`;
  else if (mode === 'waves') score = `${game.score + rings.filter(r => r.on >= 0).length}`;
  else score = `${rings.filter(r => r.on >= 0).length}/${rings.length}`;
  const t = mode === 'classic' ? game.t.toFixed(1) : `${Math.floor(Math.ceil(game.left) / 60)}:${String(Math.ceil(game.left) % 60).padStart(2, '0')}`;
  const name = mode === 'waves' ? `Волна ${game.wave}` : MODES[mode].name, taps = `Нажатий: ${game.presses}`;
  const tcol = mode !== 'classic' && game.left < 10 ? '#ffe14d' : '#fff';
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  if (wide) {
    // Ландшафт: слева режим, время и нажатия, справа счёт
    const lx = (safeL + tankX) / 2, rx = (tankX + tankW + sw - safeR) / 2, y = gy + gh + 30;
    ctx.textAlign = 'center';
    ctx.font = '600 16px system-ui'; ctx.fillText(name, lx, y);
    ctx.font = '800 34px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, lx, y + 38); ctx.fillStyle = '#fff';
    ctx.font = '800 34px system-ui'; ctx.fillText(score, rx, y + 38);
    ctx.font = '500 13px system-ui'; ctx.globalAlpha = 0.85;
    ctx.fillText(taps, lx, y + 72); ctx.fillText('колец', rx, y + 72);
    ctx.globalAlpha = 1;
  } else {
    const y = safeT + hudH / 2 + 3, xl = gl + GAUGE_W + 8, xr = gr - 8;
    ctx.textAlign = 'left';
    ctx.font = '600 15px system-ui'; ctx.fillText(name, xl, y - 8);
    ctx.font = '500 12px system-ui'; ctx.globalAlpha = 0.85; ctx.fillText(taps, xl, y + 10); ctx.globalAlpha = 1;
    ctx.textAlign = 'right'; ctx.font = '800 20px system-ui'; ctx.fillText(score, xr, y);
    ctx.textAlign = 'center'; ctx.font = '800 26px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, sw / 2, y);
  }
  ctx.textBaseline = 'alphabetic';
}

// Зона насоса для подсказки: полоска посреди своей половины, снизу (слабо) вверх (сильно)
function tutStripe(side) {
  const x = sw * (side ? 0.75 : 0.25);
  return { x, y0: sh * 0.9, y1: Math.max(hudH + 62, sh * 0.25) };
}

function drawTutorial() {
  const A = tut.a;
  if (A <= 0) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,30,70,0.5)'; ctx.shadowBlur = 6;
  for (let s = 0; s < 2; s++) {
    const { x, y0, y1 } = tutStripe(s), w = 26;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0.26)');
    // Насосом уже понажимали — его полоска бледнеет
    ctx.globalAlpha = A * (tut.presses[s] >= 2 ? 0.35 : 1);
    ctx.fillStyle = gr; rr(x - w / 2, y1, w, y0 - y1, w / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 7, y1 + 15); ctx.lineTo(x, y1 + 8); ctx.lineTo(x + 7, y1 + 15); ctx.stroke();
  }
  ctx.globalAlpha = A * 0.95; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(clamp(sw * 0.035, 22, 32))}px system-ui`;
  ctx.strokeStyle = 'rgba(0,25,65,0.9)'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  ctx.strokeText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  ctx.fillText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  // Подписи шкалы у полоски: внизу слабо, наверху сильно
  ctx.font = `800 ${Math.round(clamp(sh * 0.06, 20, 28))}px system-ui`; ctx.globalAlpha = A;
  for (let s = 0; s < 2; s++) {
    const { x, y0, y1 } = tutStripe(s), lx = x + (s ? -36 : 36);
    ctx.textAlign = s ? 'right' : 'left';
    ctx.strokeText('сильно', lx, y1 + 16); ctx.fillText('сильно', lx, y1 + 16);
    ctx.strokeText('слабо', lx, y0 - 14); ctx.fillText('слабо', lx, y0 - 14);
  }
  // Палец не водит, а нажимает: три отдельных касания снизу вверх, каждое — появился, нажал, исчез.
  // Круг от нажатия тем больше, чем выше касание — струя сильнее. Потом то же на другой стороне
  const TAP = 0.8, side = Math.floor(tut.t / (3 * TAP)) % 2, n = Math.floor(tut.t / TAP) % 3, q = (tut.t % TAP) / TAP;
  const { x, y0, y1 } = tutStripe(side), f = [0.12, 0.5, 0.88][n], y = y0 + (y1 - y0) * f;
  const vis = q < 0.18 ? q / 0.18 : q > 0.72 ? Math.max(0, (0.95 - q) / 0.23) : 1;
  const down = clamp((q - 0.18) / 0.1, 0, 1);
  if (q > 0.26) {
    const k = clamp((q - 0.26) / 0.5, 0, 1), r = (8 + 26 * f) * (0.4 + 0.6 * k);
    ctx.globalAlpha = A * 0.45 * (1 - k * 0.7); ctx.fillStyle = '#c8f4ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = A * vis; ctx.font = '42px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('👆', x + 5, y - 3 + (1 - down) * 10);
  ctx.restore();
}

// ---------- Цикл ----------
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (state !== 'pause') {
    acc += dt;
    while (acc >= P.STEP) { tick(P.STEP); acc -= P.STEP; }
  }
  audioUpdate();
  render(now);
  requestAnimationFrame(frame);
}

pickGameAngle();
layout();
// В приложении ориентацию закрепляем сразу, без жеста игрока
if (native) lockScreen();
spawnRings(8, P.RING_D, false);
show('menu');
requestAnimationFrame(frame);
