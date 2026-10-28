// Релизная сборка в dist/index.html — её публикуют и сайт (wrangler), и Android-приложение (Capacitor).
// Скрипт заключается в замыкание (ничего не торчит в глобальной области), Terser переименовывает внутренние
// переменные и функции и убирает комментарии и пробелы. Оптимизирующие преобразования (compress), переименование
// свойств и source map выключены — формулы и порядок расчётов те же; это сверяет tools/verify-release.mjs.
// node tools/build.mjs
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { minify } from 'terser';

const root = new URL('../', import.meta.url), dist = new URL('dist/', root);
const html = readFileSync(new URL('index.html', root), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('index.html: нет <script>');

const wrapped = `(() => {${m[1]}})();`;
const out = await minify(wrapped, { compress: false, mangle: true, format: { comments: false }, sourceMap: false });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// Подстановка функцией: в коде бывают «$&» и «$1», строковая замена их бы испортила
writeFileSync(new URL('index.html', dist), html.replace(m[0], () => `<script>${out.code}</script>`));
console.log(`dist/index.html: скрипт ${m[1].length} → ${out.code.length} байт`);
