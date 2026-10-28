// Поле: размеры аквариума, дно, столбики и сопла. Значения — экспортируемые переменные с живой привязкой:
// меняются только здесь, в setField, а остальные модули видят новые значения.
import { P } from './params.js';
import { allocFluid } from './fluid.js';

// Описание полей собирается из P при каждом setField — так подмена параметров ботами действует сразу.
// Дно-горка — кольца скатываются к соплам
function fieldSpec(name) {
  const { L_W, L_H, L_NOZZLE_X, L_PEG_X, L_TIP, L_BOTTOM, L_JET_LEN } = P;
  const FIELDS = {
    landscape: {
      W: L_W, H: L_H, nozzleX: L_NOZZLE_X, pegX: L_PEG_X, tip: L_TIP, bottom: L_BOTTOM, jetLen: L_JET_LEN,
      floor: [[0, L_H - 46], [L_NOZZLE_X, L_H - 6], [L_W / 2, L_H - 50], [L_W - L_NOZZLE_X, L_H - 6], [L_W, L_H - 46]]
    }
  };
  return FIELDS[name];
}

export let field = '', W = 0, H = 0, NX = 0, NY = 0, SX = 0, NCELLS = 0, PEG_TIP = 0, PEG_BOTTOM = 0, JET_LEN = 0;
export let FLOOR = [], pegs = [], nozzles = [];

// Всё, что зависит от размеров поля, включая сетку воды
export function setField(name) {
  const f = fieldSpec(name);
  field = name; W = f.W; H = f.H; NX = W / P.CELL; NY = H / P.CELL; SX = NX + 2; NCELLS = (NX + 2) * (NY + 2);
  PEG_TIP = f.tip; PEG_BOTTOM = f.bottom; JET_LEN = f.jetLen; FLOOR = f.floor;
  pegs = [{ x: f.pegX, tip: f.tip, bottom: f.bottom }, { x: W - f.pegX, tip: f.tip, bottom: f.bottom }];
  nozzles = [mkNozzle(f.nozzleX, H - 6, 0.3), mkNozzle(W - f.nozzleX, H - 6, -0.3)];
  allocFluid(NCELLS);
}

export const floorY = x => {
  for (let i = 1; i < FLOOR.length; i++) {
    const [x0, y0] = FLOOR[i - 1], [x1, y1] = FLOOR[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return H;
};

export function mkNozzle(x, y, dx) { const l = Math.hypot(dx, 1); return { x, y, dx: dx / l, dy: -1 / l }; }
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * f | 0},${((n >> 8) & 255) * f | 0},${(n & 255) * f | 0})`;
}
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
