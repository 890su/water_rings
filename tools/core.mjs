// Общее для ботов: ядро игры без браузера и подмена параметров из командной строки.
// Аргумент вида «ALIGN=20,G=200» → Object.assign(P, …); неизвестное имя — ошибка.
import { P } from '../src/core/params.js';
import { setField } from '../src/core/field.js';

export function applyOverrides(arg = '') {
  const overrides = Object.fromEntries(arg.split(',').filter(Boolean).map(s => s.split('=')));
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in P)) throw new Error('no constant ' + k);
    const n = Number(v);
    P[k] = Number.isNaN(n) ? v.replace(/^'|'$/g, '') : n;
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
