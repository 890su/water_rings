// Сборка игры из src/:
//   build/game.js, build/index.dev.html — несжатая сборка для разработки и тестов (не публикуется);
//   dist/index.html — релиз: его публикуют и сайт (wrangler), и Android-приложение (Capacitor).
// esbuild склеивает модули в один скрипт-замыкание (ничего не торчит в глобальной области). Terser переименовывает
// внутренние переменные и функции и убирает комментарии и пробелы. Оптимизирующие преобразования (compress),
// переименование свойств и source map выключены — формулы и порядок расчётов те же; это сверяет tools/verify-release.mjs.
// node tools/build.mjs            — одна сборка
// node tools/build.mjs --watch    — пересборка при изменении src/; с --serve ещё и сервер на http://localhost:8080
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import { minify } from 'terser';

const root = new URL('../', import.meta.url), dist = new URL('dist/', root), build = new URL('build/', root);
const watch = process.argv.includes('--watch'), serve = process.argv.includes('--serve');
const opts = { entryPoints: [new URL('src/main.js', root).pathname.replace(/^\/(\w:)/, '$1')], bundle: true, format: 'iife', target: 'es2022', minify: false, legalComments: 'none', write: false };

// Подстановка функцией: в коде бывают «$&» и «$1», строковая замена их бы испортила
const inject = (shell, code) => shell.replace('/*@GAME@*/', () => code);

async function emit(result, release) {
  const code = result.outputFiles[0].text;
  const shell = readFileSync(new URL('src/index.html', root), 'utf8');
  mkdirSync(build, { recursive: true });
  writeFileSync(new URL('game.js', build), code);
  writeFileSync(new URL('index.dev.html', build), inject(shell, code));
  if (!release) return;
  const out = await minify(code, { compress: false, mangle: true, format: { comments: false }, sourceMap: false });
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(new URL('index.html', dist), inject(shell, out.code));
  console.log(`dist/index.html: скрипт ${code.length} → ${out.code.length} байт`);
}

if (!watch) {
  await emit(await esbuild.build(opts), true);
} else {
  const ctx = await esbuild.context({
    ...opts,
    plugins: [{ name: 'emit', setup: b => b.onEnd(r => { if (!r.errors.length) { emit(r, false); console.log('build/index.dev.html обновлён'); } }) }]
  });
  await ctx.watch();
  if (serve) {
    createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(new URL('index.dev.html', build)));
    }).listen(8080, () => console.log('http://localhost:8080'));
  }
}
