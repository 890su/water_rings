// Кольца: физика колец (пара частиц на обод, глубина, вращение к зрителю), столкновения, надевание на столбики.
import { P } from './params.js';
import { W, H, NX, NY, PEG_TIP, PEG_BOTTOM, FLOOR, pegs, nozzles, floorY, shade, clamp } from './field.js';
import { u, v, curl, sample } from './fluid.js';
import { grav, shake } from './motion.js';
import { hooks } from './hooks.js';

export const PALETTE = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff9f1c', '#f15bb5', '#9ef01a'];
export const DUO = ['#ff3b5c', '#2f7dff'];
// Кольцо в профиль = два "сечения обода" (частицы), жёстко связанные на расстоянии D.
// Штырь проходит между ними, только если кольцо достаточно горизонтально и попало точно.
// Кольца на поле: массив переприсваивают и правила игры, и меню, поэтому он в контейнере
export const world = { rings: [] };

export function makeRing(x, y, ang, D, col, ci) {
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
export function updateDepth(R) {
  const c = R.D / 2 * Math.abs(Math.cos(R.phi));
  R.hz = c + P.RIM;
  R.zWall = Math.max(0, P.TANK_Z - R.hz);
  R.zHole = Math.max(0, c - P.RIM - P.PEG_R);
}
export const engaged = R => R.on >= 0 || R.eng.some(e => e);
// Наклон «плашмя» к зрителю: при наклоне телефона на себя / от себя кольца ложатся плашмя к новому «низу»
export const phiRest = () => P.SPIN_REST - Math.atan2(grav.z, Math.max(0.1, Math.hypot(grav.x, grav.y)));
export const zLim = R => engaged(R) ? R.zHole : R.zWall;

export function spawnRings(n, D, duo) {
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = D / 2 + P.RIM + 6 + Math.random() * (W - D - 2 * P.RIM - 12);
      y = floorY(x) - P.RIM - 6 - Math.random() * 70;
      const ok = pegs.every(g => Math.abs(x - g.x) > D / 2 + P.RIM + 6) &&
        world.rings.every(r => Math.hypot((r.a.x + r.b.x) / 2 - x, (r.a.y + r.b.y) / 2 - y) > D * 0.9);
      if (ok) break;
    }
    const ci = duo ? i % 2 : i % PALETTE.length;
    world.rings.push(makeRing(x, y, (Math.random() - 0.5) * 0.8, D, duo ? DUO[ci] : PALETTE[ci], ci));
  }
}

export function integrateRing(R, dt) {
  let tx = R.b.x - R.a.x, ty = R.b.y - R.a.y;
  const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
  const ePar = Math.exp(-P.K_PAR * dt), ePerp = Math.exp(-P.K_PERP * dt);
  const onPeg = R.on >= 0, shelter = onPeg ? P.PEG_SHELTER : 1;
  // Надетое кольцо выравниваться не стремится, а висит на штыре с наклоном —
  // и чем сильнее наклонено (в плоскости или к зрителю), тем сильнее закусывает стержень
  let rub = 1;
  if (onPeg) {
    const dp = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
    rub = Math.exp(-P.PEG_FRICTION * (1 + P.PEG_BIND * Math.hypot((R.a.y - R.b.y) / R.D, Math.sin(dp))) * dt);
  }
  // Кольцо выравнивается поперёк силы тяжести — при наклоне телефона ложится по новому «низу».
  // Надетое — лишь слегка: иначе висит ребром к струе, и вода не может поднять его со штыря
  const level = (onPeg && !R.support && !R.ground ? P.PEG_ALIGN : 1) * ((R.a.x - R.b.x) * grav.x + (R.a.y - R.b.y) * grav.y) * P.ALIGN * dt;
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
export function collideStatic(p, R) {
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
export function holeHasPeg(R, g, fromTop, tol = 0) {
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
export function flopRing(R, g, dt) {
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
export function updateThread(R) {
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
export const SEG = { s: 0, t: 0 };
export function segParams(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy, rx = ax - cx, ry = ay - cy;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  const c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  SEG.s = s; SEG.t = t;
}

// Сдвинуть точку отрезка-кольца с параметром s на (dx, dy), раздав сдвиг двум концам
export function pushRing(R, s, dx, dy) {
  const w = 1 / ((1 - s) * (1 - s) + s * s);
  R.a.x += dx * w * (1 - s); R.a.y += dy * w * (1 - s);
  R.b.x += dx * w * s; R.b.y += dy * w * s;
}

// Кольцо — отрезок толщиной в обод. Разминуться можно в плоскости или по глубине;
// выбираем путь короче, если стёкла (или штырь в дырке) оставляют для него место.
// Развернуть кольцо к зрителю так, чтобы по глубине оно занимало не больше hz
export function narrowRing(R, hz) {
  const need = Math.acos(clamp((hz - P.RIM) / (R.D / 2), 0, 1));
  const dp = (R.phi % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2, sg = dp < 0 ? -1 : 1;
  if (Math.abs(dp) >= need) return;
  R.phi += sg * (need - Math.abs(dp));
  if (R.om * sg < 0) R.om = 0;
  updateDepth(R);
}

// Сдвиг по глубине без отскока — иначе кольцо продолжает уплывать от толчка
export function shiftZ(R, dz) { R.z += dz; R.pz += dz; }

export function ringPair(A, B) {
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
export function collidePegs(R) {
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

export function physics(dt) {
  for (const R of world.rings) {
    updateDepth(R); integrateRing(R, dt); R.support = false;
    // Верхушка вошла в дырку — кольцо нанизано, и стержень его больше не отталкивает
    // (проверяем до столкновений, иначе стержень успеет развернуть кольцо и отодвинуть его)
    if (R.hook < 0 && R.on < 0) for (let k = 0; k < pegs.length; k++) {
      if (!R.eng[k] && holeHasPeg(R, pegs[k], true)) { R.hook = k; R.mark[k] = R.eng[k] = true; break; }
    }
    if (R.hook >= 0) flopRing(R, pegs[R.hook], dt);
  }
  for (let it = 0; it < 4; it++) {
    for (const R of world.rings) {
      const dx = R.b.x - R.a.x, dy = R.b.y - R.a.y, d = Math.hypot(dx, dy) || 1e-6, k = (d - R.D) / d * 0.5;
      R.a.x += dx * k; R.a.y += dy * k; R.b.x -= dx * k; R.b.y -= dy * k;
    }
    for (const R of world.rings) {
      const lim = zLim(R), z = clamp(R.z, -lim, lim);
      if (z !== R.z) R.z = R.pz = z;
      collidePegs(R);
      collideStatic(R.a, R); collideStatic(R.b, R);
    }
    for (let i = 0; i < world.rings.length; i++) for (let j = i + 1; j < world.rings.length; j++) ringPair(world.rings[i], world.rings[j]);
  }
  for (const R of world.rings) {
    R.ground = false;
    for (let n = 0; n < 2; n++) {
      const p = n ? R.b : R.a;
      if (p.c) { p.px = p.x - (p.x - p.px) * 0.985; p.py = p.y - (p.y - p.py) * 0.985; p.c = 0; R.ground = true; }
    }
  }
  for (const R of world.rings) updateThread(R);
}

export function updateSpin(R, dt) {
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

export function checkThreads(dt) {
  for (const R of world.rings) {
    updateSpin(R, dt);
    R.tinkT -= dt;
    if (R.on === R.shown) continue;
    if (R.on >= 0 && hooks.playing() && R.tinkT <= 0) {
      hooks.onThreaded(R);
      R.tinkT = 0.6;
    }
    R.shown = R.on;
  }
}
