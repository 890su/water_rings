# Переработка кода «Колец» в модули — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разложить игру из одного `index.html` (~1540 строк) на модули так, чтобы поведение не изменилось ни на бит, а насосы и столбики стали списками, случайность — воспроизводимой с зерном, а проверки — набором `npm test`.

**Architecture:** Исходники в `src/` (ES-модули): `src/core/*` — симуляция без DOM (её же импортируют боты и тесты), `src/*.js` — браузер (звук, платформа, ввод, отрисовка, интерфейс). esbuild собирает `src/main.js` в один IIFE-скрипт, `tools/build.mjs` вставляет его в оболочку `src/index.html`: `dist/index.dev.html` — без сжатия, `dist/index.html` — после Terser (как сейчас). Страховка — эталонные прогоны стенда из `tools/verify-release.mjs`: отпечаток всех команд Canvas при заданной случайности должен совпадать с отпечатком исходного `index.html` после каждой задачи.

**Tech Stack:** JavaScript (ES2022, без фреймворков), esbuild (новая dev-зависимость), Terser (уже есть), `node:test` + `node:assert` (без новых зависимостей), Capacitor 8 (не меняется), Wrangler (не меняется).

**Spec:** [docs/design.md](../../design.md), раздел 9, шаг 0; [ROADMAP.md](../../../ROADMAP.md), раздел 1б.

## Global Constraints

- Поведение игры не меняется: эталонные отпечатки (задача 1) совпадают после каждой задачи 2–11. Задачи 12–13 меняют поведение только при заданном зерне или при числе столбиков/насосов ≠ 2.
- Сайт и приложение по-прежнему получают **один** файл `dist/index.html` со встроенным скриптом; Wrangler (`build.command` в `wrangler.jsonc`) и `npm run android` работают без изменений в своих настройках, кроме путей к сборке.
- В релизе по-прежнему: скрипт в замыкании, Terser `{ compress: false, mangle: true, format: { comments: false }, sourceMap: false }`, без source map.
- Новые зависимости — только `esbuild` (devDependency). Тестовый раннер — `node --test`.
- Комментарии и тексты интерфейса — по-русски, как в текущем коде; идентификаторы — как сейчас (`startGame`, `pegs`, `nozzles`, …).
- В папке параллельно работает Codex: перед созданием или перезаписью файла — `git status --short` и прочитать файл, если он уже есть.
- Перенос кода — дословный: при выносе раздела в модуль меняются только объявления (`export`, `import`) и обращения к общему состоянию (см. задачу 2), формулы и порядок вычислений не трогаем.

## Review Focus

1. **Порядок вызовов случайности.** Любая перестановка вызовов `Math.random` (в том числе при переносе в модуль или при замене на потоки `rng`) меняет все отпечатки — эталонный тест должен падать с понятным сообщением, какой сценарий разошёлся (задача 1).
2. **Общее изменяемое состояние между модулями.** Переменные, которые сейчас переприсваиваются (`state = 'play'`, `game = {...}`, `rings = []`, `W`, `H`, массивы воды при `setField`), после выноса должны жить в объектах-контейнерах; импорт `let` из другого модуля не видит переприсваивания — тест: смена поля через `setField` видна в `fluid.u.length` из другого модуля (задача 3).
3. **Переопределение параметров ботами.** Сейчас `tools/*.mjs` подменяют константы регулярным выражением в тексте; после переноса — `Object.assign(P, overrides)`. Производные значения (`FIELDS`, позиции столбиков) должны считаться при `setField`, а не при импорте — тест: `P.L_PEG_X = 200; setField('landscape')` → `pegs[0].x === 200` (задача 3).
4. **Число столбиков и насосов ≠ 2.** Места с `eng[0] || eng[1]`, `pumps[0]`/`pumps[1]`, `DUO[k]`, половины экрана для насосов — тест на поле с тремя столбиками и тремя насосами: партия 60 с без исключений, кольцо может надеться на любой столбик (задача 12).
5. **Зерно и украшения.** Пузыри, искры, пылинки и меню-демо не должны сдвигать игровой поток случайности — тест: две партии с одним зерном и разным количеством кадров меню перед стартом дают одинаковое состояние колец через 30 с (задача 13).

---

## Структура файлов

| Файл | Отвечает за | Откуда (раздел текущего `index.html`) |
|---|---|---|
| `src/index.html` | HTML и CSS оболочки, место вставки скрипта `<script>/*@GAME@*/</script>` | всё, кроме `<script>` |
| `src/main.js` | сборка модулей, запуск, игровой цикл | «Цикл», строки инициализации в конце |
| `src/core/params.js` | `P` — все настраиваемые константы одним объектом | «Мир»: константы |
| `src/core/rng.js` | потоки случайности `rng.game()`, `rng.fx()`, `setSeed()` | новое (задача 13) |
| `src/core/field.js` | `F` — текущее поле (W, H, NX, NY, SX, NCELLS, PEG_TIP, PEG_BOTTOM, JET_LEN, FLOOR, pegs, nozzles), `FIELDS`, `setField`, `floorY`, `mkNozzle`, `clamp`, `shade` | «Мир» |
| `src/core/fluid.js` | `fluid` — массивы воды; `IX`, `setBnd`, `project`, `advect`, `vorticity`, `blockRect`, `pegWake`, `fluidStep`, `resetFluid`, `sample`, `allocFluid` | «Жидкость» |
| `src/core/pumps.js` | `pumps`, `makePump`, `updatePump`, `inject`, `shelfShade`, `suck`, `resetPumps` | «Насосы», `resetPumps` |
| `src/core/motion.js` | `grav`, `shake`, `motion`, `onMotion`, `enableMotion`, `resetMotion`, `swirl`, `updateMotion`, `screenAxes(x, y, z, angle)` | «Наклон и встряска» |
| `src/core/hooks.js` | `hooks = { onThreaded, onStart, onEnd }` — через них ядро без DOM сообщает браузерной части о событиях; по умолчанию пустые функции | новое |
| `src/core/rings.js` | `world` — `{ rings: [] }`, вся физика колец, `spawnRings`, `PALETTE`, `DUO`, вызов `hooks.onThreaded` | «Кольца» |
| `src/core/fx.js` | `bubbles`, `sparks`, `specks`, `burst`, `updateFx` | «Эффекты» |
| `src/core/game.js` | `G` — `{ state, mode, game, toastText, toastT }`, `MODES`, `startGame` (без DOM), `spawnWave`, `gameLogic`, `endGame` (через хук), рекорды, `tut*`, `demo`, `tick` | «Режимы и игра», «Подсказка» (логика) |
| `src/audio.js` | звук Codex дословно | «Звук» … «Конец звука» |
| `src/platform.js` | ориентация, `native`, `plug`, `lockScreen`, вырез камеры, кнопка «Назад» | «Ориентация» (часть) |
| `src/view.js` | `V` — `{ sw, sh, dpr, S, tankX, tankY, tankW, tankH, hudH, wide, safeL, safeT, safeR, safeB, rot, gameAngle }`, `layout()` | «Экран», `layout` |
| `src/input.js` | `strengthFromY`, `press`, `release`, указатель, клавиатура | «Ориентация» (ввод) |
| `src/render.js` | `rr`, `drawRing`, `render`, `drawPump`, `drawHud`, `tutStripe`, `drawTutorial` | «Отрисовка» |
| `src/ui.js` | меню и оверлеи, кнопки, прокрутка меню, `show`, `pauseGame`, `resumeGame`, `toMenu` | «Меню» |
| `tools/build.mjs` | esbuild → `dist/game.js`; вставка в оболочку → `dist/index.dev.html`; Terser → `dist/index.html` | заменяет текущий |
| `tests/harness.mjs` | `play(code, scenario)` — стенд с подменённым браузером (вынесен из `verify-release.mjs`) | `tools/verify-release.mjs` |
| `tests/golden.json` | эталонные отпечатки исходной версии | новое |
| `tests/*.test.mjs` | тесты `node --test` | новое и перенос ботов |

---

### Task 1: Эталонные прогоны и стенд в `tests/`

**Files:**
- Create: `tests/harness.mjs`, `tests/golden.test.mjs`, `tests/golden.json`, `tools/golden-record.mjs`
- Modify: `tools/verify-release.mjs` (использует `tests/harness.mjs`), `package.json` (скрипты `test`, `golden:record`)

**Interfaces:**
- Produces: `play(code: string, scenario: { mode: 'classic'|'colors'|'waves', portrait: boolean, mobile: boolean, long?: boolean }) → { hash: string, calls: number, ui: Array, storage: Array }` в `tests/harness.mjs`; `scriptOf(html: string) → string`.
- Сценарии: 12 существующих (3 режима × сохранённое портретное поле × сенсорный ввод) + 3 длинных `long: true` — по одному на режим, без портретного поля, `mobile: false`: 1800 кадров (30 с), насосы по очереди: каждые 40 кадров нажатие на 25 кадров, высота касания чередуется 0,25 / 0,6 / 0,9 высоты окна.

- [ ] **Step 1:** Перенести `play()` из `tools/verify-release.mjs` в `tests/harness.mjs` без изменений, добавить ветку `long`. `verify-release.mjs` импортирует `play` и `scriptOf` из `tests/harness.mjs`.
- [ ] **Step 2:** `tools/golden-record.mjs` — прогоняет все 15 сценариев по скрипту из файла, переданного аргументом, и пишет `{ "<сценарий>": { hash, calls } }` в `tests/golden.json`.
- [ ] **Step 3:** Записать эталон по текущему `index.html`: `node tools/golden-record.mjs index.html`. Ожидается 15 записей.
- [ ] **Step 4:** `tests/golden.test.mjs` — для каждого сценария `assert.deepEqual(play(scriptOf(<сборка>), sc), golden[name], name)`. Сборка до задачи 2 — `index.html`, после — `dist/index.dev.html` (путь в одной константе `BUILD`).
- [ ] **Step 5:** `package.json`: `"test": "node --test tests/"`. Run: `npm test` → Expected: 15 PASS.
- [ ] **Step 6:** Проверка, что тест ловит расхождение: временно поменять константу `JET` 744 → 745 в `index.html`, `npm test` → FAIL с именем сценария; вернуть.
- [ ] **Step 7:** Commit `test: эталонные прогоны игры для переработки`.

### Task 2: Оболочка, сборка esbuild, весь скрипт — в `src/main.js`

**Files:**
- Create: `src/index.html` (всё из `index.html`, кроме тела `<script>`, которое заменено на `/*@GAME@*/`), `src/main.js` (тело `<script>` дословно)
- Modify: `tools/build.mjs`, `package.json` (dev-зависимость `esbuild`, скрипт `"dev": "node tools/build.mjs --watch --serve"`), `tests/golden.test.mjs` (`BUILD = 'dist/index.dev.html'`), `tools/verify-release.mjs` (сравнивает `dist/index.dev.html` и `dist/index.html`), `tools/sim.mjs`, `tools/knock.mjs` (берут скрипт из `dist/index.dev.html`)
- Delete: корневой `index.html` (после того как тест зелёный)

**Interfaces:**
- Produces: `npm run build` → `dist/game.js`, `dist/index.dev.html`, `dist/index.html`; `npm run dev` → сборка при изменении файлов и сервер на `http://localhost:8080` с `dist/index.dev.html` как `/`.
- esbuild: `{ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: 'es2022', minify: false, legalComments: 'none' }`; результат вставляется вместо `/*@GAME@*/` функцией (а не строкой — в коде есть `$&`).

- [ ] **Step 1:** Создать `src/index.html` и `src/main.js` переносом из `index.html`; `'use strict'` остаётся первой строкой `main.js`.
- [ ] **Step 2:** Переписать `tools/build.mjs` по интерфейсу выше; Terser-шаг тот же, что сейчас, применяется к выходу esbuild.
- [ ] **Step 3:** Run: `npm run build && npm test` → Expected: 15 PASS (esbuild IIFE не меняет порядок вызовов).
- [ ] **Step 4:** Run: `npm run verify` → Expected: `Release matches source in all 12 deterministic scenarios.` и `PASS audio`.
- [ ] **Step 5:** Удалить корневой `index.html`; README: раздел «Запуск» — `npm ci && npm run dev`, открыть `http://localhost:8080`.
- [ ] **Step 6:** Commit `build: исходники в src/, сборка esbuild`.

### Task 3: Параметры, поле и вода

**Files:**
- Create: `src/core/params.js`, `src/core/field.js`, `src/core/fluid.js`, `tests/field.test.mjs`
- Modify: `src/main.js` (разделы «Мир» и «Жидкость» удалены, вместо них импорты; обращения `W` → `F.W`, `u` → `fluid.u` и т. п.)

**Interfaces:**
- Produces: `export const P` — объект со всеми константами раздела «Мир» (`CELL`, `RIM`, `RING_D`, …, `L_*`, `P_*`, `START_FIELD`); `export const F` — поле; `export function setField(name: 'landscape'|'portrait'): void` (считает всё из `P` в момент вызова, выделяет массивы через `allocFluid(F.NCELLS)`); `export function floorY(x: number): number`; `export const fluid = { u, v, u0, v0, pr, dv, curl }` (поля заменяются при `allocFluid`); функции воды — с теми же именами и сигнатурами, что сейчас.
- Остальной код читает `F.*`, `P.*`, `fluid.*` в момент вызова — никаких копий в переменные на уровне модуля.

- [ ] **Step 1: Write the failing test** `tests/field.test.mjs`:
  - `setField применяет переопределённые параметры`: `P.L_PEG_X = 200; setField('landscape')` → `F.pegs[0].x === 200`, `F.pegs[1].x === F.W - 200`; после теста вернуть `P.L_PEG_X = 230`.
  - `массивы воды пересоздаются под поле`: после `setField('landscape')` → `fluid.u.length === (F.W / P.CELL + 2) * (F.H / P.CELL + 2)`.
- [ ] **Step 2:** Run `node --test tests/field.test.mjs` → FAIL (модулей нет).
- [ ] **Step 3:** Вынести код по интерфейсу; в `main.js` заменить обращения.
- [ ] **Step 4:** Run `npm run build && npm test` → field PASS, golden 15 PASS.
- [ ] **Step 5:** Commit `refactor: параметры, поле и вода — модули`.

### Task 4: Насосы и наклон

**Files:**
- Create: `src/core/pumps.js`, `src/core/motion.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `P`, `F`, `fluid`, `sample`, `clamp` (задача 3).
- Produces: `pumps: Pump[]`, `makePump(): Pump`, `resetPumps(): void`, `updatePump(p, dt)`, `inject(side: number)`, `shelfShade(mx, my, x, y): number`, `suck(side, k)`; `grav`, `shake`, `motion`, `onMotion(e)`, `enableMotion()`, `resetMotion()`, `swirl(x, y, s, r)`, `updateMotion(dt)`, `screenAxes(x, y, z, angle: number): [number, number, number]` — угол передаётся параметром (раньше брался из `gameAngle`/`screenAngle` напрямую; вызывающий в `onMotion` передаёт тот же угол).

- [ ] **Step 1:** Вынести разделы «Насосы» и «Наклон и встряска», `resetPumps`.
- [ ] **Step 2:** Run `npm run build && npm test` → 15 PASS (сценарии с `KeyQ`, `Space` и пульсом насосов покрывают оба модуля).
- [ ] **Step 3:** Commit `refactor: насосы и наклон — модули`.

### Task 5: Кольца и эффекты

**Files:**
- Create: `src/core/rings.js`, `src/core/fx.js`, `src/core/hooks.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: задачи 3–4.
- Produces: `world = { rings: Ring[] }` (все `rings = …` → `world.rings = …`); все функции раздела «Кольца» с прежними именами; `PALETTE`, `DUO`; `hooks.onThreaded(R: Ring, good: boolean)` (из `src/core/hooks.js`, задача 5) — `checkThreads` вызывает его вместо прямых `burst`/звука, `main.js` назначает хук с прежним телом (порядок вызовов `burst` и звука тот же); `bubbles`, `sparks`, `specks`, `burst(x, y, col, n)`, `updateFx(dt)`.
- `checkThreads` читает режим через параметр `checkThreads(dt, ctx: { state: string, mode: string })`.

- [ ] **Step 1:** Вынести разделы «Кольца» и «Эффекты» по интерфейсу.
- [ ] **Step 2:** Перенести в `tests/physics.test.mjs` проверки из ботов-черновиков (они в репозитории не лежат — воспроизвести по описанию): за 3 партии по 240 с ботом (`seed` через подменённый `Math.random`, как в стенде) — 0 скачков центра кольца больше 16 px за кадр, 0 пересечений колец глубже `RIM`; после 60 с игры и 12 с без нажатий — 0 колец, висящих в воде (не на дне, не надетых, не лежащих на соседнем). Длительность теста — до 90 с.
- [ ] **Step 3:** Run `npm run build && npm test` → physics PASS, golden 15 PASS.
- [ ] **Step 4:** Commit `refactor: кольца и эффекты — модули; тесты физики`.

### Task 6: Правила игры и игровой шаг

**Files:**
- Create: `src/core/game.js`, `tests/game.test.mjs`
- Modify: `src/main.js`, `tools/sim.mjs`, `tools/tune.mjs`, `tools/knock.mjs`

**Interfaces:**
- Consumes: задачи 3–5.
- Produces: `G = { state, mode, game, toastText, toastT }` (все переприсваивания → `G.*`); `MODES`; `startGame(m)` — логика без DOM, а DOM-часть (`show`, `lockScreen`, `layout`) вызывается через `hooks.onStart`; `spawnWave()`, `gameLogic(dt)`, `endGame(title, text, best)` → `hooks.onEnd(title, text, best)`; `getBest(m)`, `setBest(m, v)`; `tut`, `tutSeen()`, `tutStart()`, `tutUpdate(dt)`; `demo(dt)`; `tick(dt)`; `toast(t)`.
- Боты: `import { P } from '../src/core/params.js'` и т. д.; переопределения из аргумента — `Object.assign(P, parse(arg))` вместо регулярного выражения по тексту; формат аргумента прежний `ALIGN=20,G=200`; неизвестное имя → ошибка `no constant NAME`.

- [ ] **Step 1: Write the failing test** `tests/game.test.mjs`: `startGame('classic')` без DOM → `G.state === 'play'`, `world.rings.length === 8`; `tick` 60 раз без исключений; `Object.assign(P, { ALIGN: 5 })` действует на следующий `tick` (вернуть 20).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Вынести по интерфейсу; перевести ботов на импорт.
- [ ] **Step 4:** Run `npm run build && npm test` → PASS; `node tools/sim.mjs 1 30` печатает статистику без ошибок; `node tools/sim.mjs 1 30 NOPE=1` → `no constant NOPE`.
- [ ] **Step 5:** Commit `refactor: правила игры — модуль; боты импортируют ядро`.

### Task 7: Звук

**Files:**
- Create: `src/audio.js` (раздел «Звук» … «Конец звука» дословно, с экспортом используемых функций)
- Modify: `src/main.js`, `tools/verify-audio.mjs` (читает модуль `src/audio.js` вместо вырезания раздела из `index.html`)

**Interfaces:**
- Produces: `initAudio`, `stopVoices`, `audioScene`, `audioTone`, `bubbleSound`, `soundCue`, `audioUpdate`, `musicOn` (как свойство объекта `audio`, если переприсваивается) — имена прежние.

- [ ] **Step 1:** Вынести; `verify-audio.mjs` импортирует модуль в контексте с подменённым `AudioContext`.
- [ ] **Step 2:** Run `npm run build && npm test && npm run verify` → golden 15 PASS, `PASS audio`.
- [ ] **Step 3:** Commit `refactor: звук — модуль`.

### Task 8: Платформа, раскладка экрана, ввод

**Files:**
- Create: `src/platform.js`, `src/view.js`, `src/input.js`
- Modify: `src/main.js`

**Interfaces:**
- Produces: `V` (см. таблицу файлов; все `sw`, `sh`, `tankX`, `rot`, `gameAngle`, `safeL` … → `V.*`); `layout()`; `toRoot(e)`, `touchDevice()`, `screenAngle()`, `pickGameAngle()`, `native`, `plug(name)`, `lockScreen()`; `strengthFromY(y)`, `press(side, y, id, strong)`, `release(side)`; обработчики указателя и клавиатуры навешиваются функцией `bindInput(canvas)` из `main.js`.

- [ ] **Step 1:** Вынести; сценарии `mobile: true` с поворотами экрана в стенде покрывают `layout`/`toRoot`.
- [ ] **Step 2:** Run `npm run build && npm test` → 15 PASS.
- [ ] **Step 3:** Commit `refactor: платформа, экран и ввод — модули`.

### Task 9: Отрисовка и интерфейс

**Files:**
- Create: `src/render.js`, `src/ui.js`
- Modify: `src/main.js` (остаются только импорты, назначение хуков, `frame`, инициализация)

**Interfaces:**
- Produces: `render(now)`, `drawHud()`, `drawTutorial()`, `tutStripe(side)`; `show(name)`, `pauseGame()`, `resumeGame()`, `toMenu()`, `refreshBest()`, `refreshTilt()`, `refreshSoundButtons()`, `bindUi()`.

- [ ] **Step 1:** Вынести; `main.js` ≤ 80 строк.
- [ ] **Step 2:** Run `npm run build && npm test && npm run verify` → всё PASS.
- [ ] **Step 3:** Проверить в браузере: `npm run dev`, открыть `http://localhost:8080`, сыграть «Классику» (насосы мышью и `A`/`L`, пауза, меню) — без ошибок в консоли.
- [ ] **Step 4:** Commit `refactor: отрисовка и интерфейс — модули`.

### Task 10: Сборки сайта и приложения на новой структуре

**Files:**
- Modify: `wrangler.jsonc` (команда сборки не меняется, если `npm run build && npm run verify` уже собирает `dist/`), `package.json` (`android` — без изменений, проверить), `README.md`, `ROADMAP.md` (отметить пункты раздела 1б, кроме зерна и списков)

- [ ] **Step 1:** Run `npm run build && npm run verify && npx cap sync android` → `Sync finished`.
- [ ] **Step 2:** Run `npx wrangler deploy --dry-run` → сборка и проверки проходят, публикуется только `dist/index.html`.
- [ ] **Step 3:** Commit `docs: разработка через src/ и npm run dev`.

### Task 11: Ревью кода после переноса

- [ ] **Step 1:** Ревью всей ветки (навык requesting-code-review): дословность переноса, отсутствие копий изменяемого состояния на уровне модулей, циклические импорты (`npx esbuild src/main.js --bundle --metafile=meta.json` и поиск циклов).
- [ ] **Step 2:** Исправить замечания, `npm test` → PASS. Commit.

### Task 12: Столбики и насосы — списки любой длины

**Files:**
- Modify: `src/core/field.js` (у сопла поле `angle` — направление в радианах от вертикали, сейчас ±0,3 через `mkNozzle`; поле `aim` — допустимый поворот, по умолчанию 0; у насоса поле `zone` — `{ x0, x1 }` в долях ширины кадра, по умолчанию левая/правая половина), `src/core/pumps.js` (`pumps` создаются по `F.nozzles.length` в `setField`), `src/core/rings.js` (`eng`, `mark` — по `F.pegs.length`; `engaged(R)` через `some`), `src/core/game.js` (`DUO` только для полей с 2 столбиками), `src/input.js` (насос по зоне, а не по половине экрана), `src/render.js` (`onPeg` через `engaged`, колбы насосов по `pumps`), `tests/field.test.mjs`
- Добавить в `FIELDS` тестовое поле `test3`: альбомное, 3 столбика на `x = 162, 324, 486`, 3 сопла на `x = 100, 324, 548` (средний — вертикально), зоны насосов — трети ширины.

**Interfaces:**
- Produces: `F.nozzles: { x, y, dx, dy, angle, aim }[]`, `F.pegs: { x, tip, bottom }[]`, `pumpZone(i): { x0, x1 }`.

- [ ] **Step 1: Write the failing test** (`tests/field.test.mjs`): `setField('test3')` → `pumps.length === 3`; партия «Классики» 60 с ботом, жмущим насосы по очереди, без исключений; хотя бы в одной из 5 партий кольцо надето на столбик с индексом 2; нажатие в правой трети кадра включает насос 2.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Реализовать по интерфейсу.
- [ ] **Step 4:** Run `npm run build && npm test` → field PASS, golden 15 PASS (поле `landscape` с 2 столбиками не изменилось).
- [ ] **Step 5:** Commit `feat: столбики и насосы — списки любой длины`.

### Task 13: Случайность с зерном

**Files:**
- Create: `src/core/rng.js`, `tests/rng.test.mjs`
- Modify: все 18 мест с `Math.random` (кроме генератора звука Codex — у него свой поток)

**Interfaces:**
- Produces: `rng = { game(): number, fx(): number }`; `setSeed(seed: number | null)`: `null` — оба потока возвращают `Math.random()` (поведение и эталоны прежние); число — два независимых генератора mulberry32 с зёрнами `seed` и `seed ^ 0x9e3779b9`.
- Поток `game`: раскладка колец (`spawnRings`, `makeRing`), шум вращения и глубины (`updateSpin`), вихри встряски (`updateMotion` → `swirl`), встряска с клавиатуры. Поток `fx`: пылинки, пузыри, искры (`fx.js`), демо в меню (`demo`).

- [ ] **Step 1: Write the failing test** `tests/rng.test.mjs`:
  - `одно зерно — одна партия`: `setSeed(42)`, `startGame('classic')`, 1800 шагов с одинаковыми нажатиями → сериализованные `world.rings` (x, y, z, phi с точностью 1e-9) совпадают у двух прогонов.
  - `разные зёрна — разные раскладки`: `setSeed(1)` и `setSeed(2)` → различаются стартовые позиции колец.
  - `украшения не трогают игру`: при `setSeed(7)` прогон с 300 кадрами меню перед `startGame` и без них даёт одинаковые кольца через 1800 шагов.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Реализовать `rng.js`, заменить вызовы по списку выше.
- [ ] **Step 4:** Run `npm run build && npm test` → rng PASS, golden 15 PASS (без зерна оба потока — `Math.random` в прежнем порядке).
- [ ] **Step 5:** ROADMAP: отметить раздел 1б полностью. Commit `feat: случайность с зерном — основа испытания дня`.
- [ ] **Step 6:** `npm run deploy`, проверить сайт; собрать APK (`npm run android`, `gradlew assembleDebug`) и поставить на телефон — это законченный этап.
