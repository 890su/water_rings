// Наклон и встряска телефона.
import { P } from './params.js';
import { W, H, NX, NY, clamp } from './field.js';
import { u, v, IX } from './fluid.js';

// grav — сила тяжести в осях аквариума в долях G: x, y — в плоскости, z — к переднему стеклу.
// Отсчёт от того, как телефон держали при старте партии: так держат — кольца тонут вниз как обычно;
// повернул — «низ» поворачивается, перевернул — кольца падают к крышке, положил плашмя — ложатся на стекло.
// Вода в полном аквариуме от наклона не течёт, тонут по нему только кольца.
// shake — ускорение колец относительно аквариума при встряске, px/с²: аквариум дёрнулся — кольца отстали.
export const grav = { x: 0, y: 1, z: 0 }, shake = { x: 0, y: 0, z: 0 };
export const motion = { on: true, listening: false, sign: 0, tx: 0, ty: 1, tz: 0, m0: null, z0: null, keyTilt: 0, lp: null, angle: () => 0 };

// Оси устройства (x вправо, y к верху корпуса, z к зрителю) → оси игрового кадра (x вправо, y вниз, z к зрителю).
// Кадр привязан к корпусу: угол кадра даёт motion.angle() (назначает main.js), а не то, как браузер сейчас повернул экран
export function screenAxes(x, y, z) {
  const a = motion.angle() * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, -(x * s + y * c), z];
}

export function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!motion.on || !g || g.x == null) return;
  const [x, y, z] = screenAxes(g.x, g.y, g.z);
  // Android и iOS расходятся в знаке. Телефон держат верхом вверх — по первому замеру и выбираем знак
  if (!motion.sign) { if (Math.hypot(x, y) < 4) return; motion.sign = y < 0 ? -1 : 1; }
  const dx = motion.sign * x, dy = motion.sign * y, dz = motion.sign * z / 9.81, m = Math.hypot(dx, dy);
  if (motion.m0 == null) { motion.m0 = Math.max(m, 4); motion.z0 = dz; }
  // Сила в плоскости — в долях от той, что была при старте; почти плашмя направление ненадёжно, его не трогаем
  const k = Math.min(1, m / motion.m0);
  if (m > 1.5) { motion.tx = dx / m * k; motion.ty = dy / m * k; }
  else { const l = Math.hypot(motion.tx, motion.ty) || 1; motion.tx *= k / l; motion.ty *= k / l; }
  motion.tz = clamp(dz - motion.z0, -1, 1) * P.TILT_Z;

  let lx, ly, lz;
  const a = e.acceleration;
  if (a && a.x != null) [lx, ly, lz] = screenAxes(a.x, a.y, a.z);
  else {
    // Нет ускорения без гравитации — выделяем рывки фильтром из полного
    if (!motion.lp) motion.lp = [x, y, z];
    const lp = motion.lp;
    lp[0] += (x - lp[0]) * 0.1; lp[1] += (y - lp[1]) * 0.1; lp[2] += (z - lp[2]) * 0.1;
    lx = x - lp[0]; ly = y - lp[1]; lz = z - lp[2];
  }
  const mag = Math.hypot(lx, ly, lz);
  if (mag > P.SHAKE_DEAD) {
    const f = (mag - P.SHAKE_DEAD) / mag * P.SHAKE_K * motion.sign;
    shake.x = lx * f; shake.y = ly * f; shake.z = lz * f * 0.3;
  }
}

export function enableMotion() {
  if (motion.listening || !window.DeviceMotionEvent) return;
  motion.listening = true;
  const listen = () => window.addEventListener('devicemotion', onMotion);
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then(s => { if (s === 'granted') listen(); else motion.listening = false; })
      .catch(() => { motion.listening = false; });
  } else listen();
}

export function resetMotion() {
  grav.x = 0; grav.y = 1; grav.z = 0; shake.x = shake.y = shake.z = 0;
  motion.tx = 0; motion.ty = 1; motion.tz = 0; motion.m0 = motion.z0 = null;
}

// Вихрь радиусом r: встряска взбалтывает воду у стенок
export function swirl(x, y, s, r) {
  for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
    const rx = (i - 0.5) * P.CELL - x, ry = (j - 0.5) * P.CELL - y, d = Math.hypot(rx, ry);
    if (d >= r) continue;
    const k = IX(i, j), f = s * (1 - d / r) / r;
    u[k] -= ry * f; v[k] += rx * f;
  }
}

export function updateMotion(dt) {
  let tx = motion.on ? motion.tx : 0, ty = motion.on ? motion.ty : 1;
  if (motion.keyTilt) { tx = Math.sin(motion.keyTilt * 0.5); ty = Math.cos(motion.keyTilt * 0.5); }
  const k = 1 - Math.exp(-12 * dt);
  grav.x += (tx - grav.x) * k; grav.y += (ty - grav.y) * k; grav.z += ((motion.on ? motion.tz : 0) - grav.z) * k;
  const s = Math.hypot(shake.x, shake.y);
  if (s > 1200 && Math.random() < 0.25) {
    swirl(30 + Math.random() * (W - 60), 60 + Math.random() * (H - 160), (Math.random() < 0.5 ? -1 : 1) * Math.min(s, 6000) * 0.08, 50);
  }
  const e = Math.exp(-30 * dt);
  shake.x *= e; shake.y *= e; shake.z *= e;
}
