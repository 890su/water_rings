// Поле: размеры аквариума, дно, столбики и сопла. Значения — экспортируемые переменные с живой привязкой:
// меняются только здесь, в setField, а остальные модули видят новые значения.
import { P } from './params.js';
import { allocFluid } from './fluid.js';
import { syncPumps } from './pumps.js';

// Описание полей собирается из P при каждом setField — так подмена параметров ботами действует сразу.
// Столбики и сопла — списки любой длины: { x } и { x, slope } (slope — наклон струи вбок, как в mkNozzle).
// Дно-горка — кольца скатываются к соплам
function fieldSpec(name) {
  const { L_W, L_H, L_NOZZLE_X, L_PEG_X, L_TIP, L_BOTTOM, L_JET_LEN } = P;
  const FIELDS = {
    landscape: {
      W: L_W, H: L_H, tip: L_TIP, bottom: L_BOTTOM, jetLen: L_JET_LEN,
      pegs: [{ x: L_PEG_X }, { x: L_W - L_PEG_X }],
      nozzles: [{ x: L_NOZZLE_X, slope: 0.3 }, { x: L_W - L_NOZZLE_X, slope: -0.3 }],
      floor: [[0, L_H - 46], [L_NOZZLE_X, L_H - 6], [L_W / 2, L_H - 50], [L_W - L_NOZZLE_X, L_H - 6], [L_W, L_H - 46]]
    },
    // Проверочное поле: три столбика и три насоса (средний бьёт вертикально), зоны насосов — трети ширины
    test3: {
      W: L_W, H: L_H, tip: L_TIP, bottom: L_BOTTOM, jetLen: L_JET_LEN,
      pegs: [{ x: 162 }, { x: 324 }, { x: 486 }],
      nozzles: [{ x: 100, slope: 0.3 }, { x: 324, slope: 0 }, { x: 548, slope: -0.3 }],
      floor: [[0, L_H - 46], [100, L_H - 6], [212, L_H - 40], [324, L_H - 6], [436, L_H - 40], [548, L_H - 6], [L_W, L_H - 46]]
    }
  };
  return FIELDS[name];
}

export let field = '', W = 0, H = 0, NX = 0, NY = 0, SX = 0, NCELLS = 0, PEG_TIP = 0, PEG_BOTTOM = 0, JET_LEN = 0;
export let FLOOR = [], pegs = [], nozzles = [];

// Всё, что зависит от размеров поля, включая сетку воды и число насосов
export function setField(name) {
  const f = fieldSpec(name);
  field = name; W = f.W; H = f.H; NX = W / P.CELL; NY = H / P.CELL; SX = NX + 2; NCELLS = (NX + 2) * (NY + 2);
  PEG_TIP = f.tip; PEG_BOTTOM = f.bottom; JET_LEN = f.jetLen; FLOOR = f.floor;
  pegs = f.pegs.map(g => ({ x: g.x, tip: f.tip, bottom: f.bottom }));
  nozzles = f.nozzles.map(n => mkNozzle(n.x, H - 6, n.slope));
  allocFluid(NCELLS);
  syncPumps();
}

export const floorY = x => {
  for (let i = 1; i < FLOOR.length; i++) {
    const [x0, y0] = FLOOR[i - 1], [x1, y1] = FLOOR[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return H;
};

// Сопло: направление струи (dx, dy), angle — отклонение от вертикали в радианах (+ — вправо),
// aim — на сколько игрок может довернуть сопло (пока 0: наведение — в уровнях с поворотными соплами)
export function mkNozzle(x, y, dx) { const l = Math.hypot(dx, 1); return { x, y, dx: dx / l, dy: -1 / l, angle: Math.atan(dx), aim: 0 }; }
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * f | 0},${((n >> 8) & 255) * f | 0},${(n & 255) * f | 0})`;
}
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
