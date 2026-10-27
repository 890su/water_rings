// Параллельный прогон sim.mjs на всех ядрах и сводка по времени прохождения.
// node tools/tune.mjs <gamesPerWorker> <maxSec> ALIGN=20,G=200
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

const [per = 5, maxSec = 420, overrides = ''] = process.argv.slice(2);
const workers = cpus().length;
const run = () => new Promise(res => {
  let out = '';
  const p = spawn(process.execPath, [new URL('./sim.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), per, maxSec, overrides]);
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => process.stderr.write(d));
  p.on('close', () => res(JSON.parse(out)));
});
const t0 = Date.now();
const results = await Promise.all(Array.from({ length: workers }, run));
const times = results.flatMap(r => r.times);
const st = { lifts: 0, threads: 0, losses: 0, onEnd: 0, sec: 0 };
for (const r of results) for (const k in st) st[k] += r.stats[k];
const perMin = { lifts: +(st.lifts / st.sec * 60).toFixed(1), threads: +(st.threads / st.sec * 60).toFixed(2), losses: +(st.losses / st.sec * 60).toFixed(2), avgOnEnd: +(st.onEnd / times.length).toFixed(1) };
const done = times.filter(t => t != null).sort((a, b) => a - b);
const q = f => done.length ? done[Math.min(done.length - 1, Math.floor(f * times.length))] : null;
console.log(JSON.stringify({
  overrides, n: times.length, finished: done.length,
  under60: times.filter(t => t != null && t <= 60).length,
  p10: q(0.1), median: q(0.5), p90: q(0.9), perMin, times: done, sec: Math.round((Date.now() - t0) / 1000)
}));
