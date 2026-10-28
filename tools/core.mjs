// Общее для ботов: ядро игры без браузера и подмена параметров из командной строки.
// Аргумент вида «ALIGN=20,G=200» → Object.assign(P, …); неизвестное имя или не число вместо числа — ошибка.
import { P } from '../src/core/params.js';
import { setField } from '../src/core/field.js';

export function applyOverrides(arg = '') {
  const overrides = Object.fromEntries(arg.split(',').filter(Boolean).map(s => s.split('=')));
  for (const [k, v] of Object.entries(overrides)) {
    if (!Object.hasOwn(P, k)) throw new Error('no constant ' + k);
    if (typeof P[k] === 'string') { P[k] = v.replace(/^'|'$/g, ''); continue; }
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`${k}=${v}: нужно число`);
    P[k] = n;
  }
  setField(P.START_FIELD);
  return overrides;
}

export { P };
export { W, H, PEG_TIP, pegs } from '../src/core/field.js';
export { startGame, tick } from '../src/core/game.js';
export { G } from '../src/core/state.js';
export { world } from '../src/core/rings.js';
export { pumps } from '../src/core/pumps.js';
