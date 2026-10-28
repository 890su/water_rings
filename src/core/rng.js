// Случайность: два потока.
//   game — раскладка колец и физика (шум вращения и глубины, вихри встряски);
//   fx   — украшения (пылинки, пузыри, искры) и демо в меню: на ход партии не влияют.
// Без зерна оба потока берут Math.random — игра такая же, как раньше. С зерном — генераторы mulberry32:
// партия полностью воспроизводима (основа испытания дня и проверки рекордов), а игровой поток
// начинается заново с каждой партией, сколько бы ни простояло меню.
let seed = null;

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const rng = { game: () => Math.random(), fx: () => Math.random() };

// null — без зерна (Math.random); число — воспроизводимые потоки
export function setSeed(s) {
  seed = s;
  if (s == null) { rng.game = () => Math.random(); rng.fx = () => Math.random(); }
  else { rng.game = mulberry32(s); rng.fx = mulberry32(s ^ 0x9e3779b9); }
}

// Начало партии: с зерном игровой поток стартует заново
export function restartGameRng() { if (seed != null) rng.game = mulberry32(seed); }
