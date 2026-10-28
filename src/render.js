// Отрисовка: аквариум, кольца, столбики, сопла, пузыри, табло, подсказка первой игры.
import { W, H, FLOOR, pegs, nozzles, floorY, clamp } from './core/field.js';
import { bubbles, sparks, specks } from './core/fx.js';
import { MODES, tut } from './core/game.js';
import { P } from './core/params.js';
import { pumps } from './core/pumps.js';
import { DUO, world } from './core/rings.js';
import { G } from './core/state.js';
import { ctx, sw, sh, dpr, S, tankX, tankY, tankW, tankH, hudH, wide, safeL, safeT, safeR, PAD, GAUGE_W } from './view.js';


// Скруглённый прямоугольник. На крошечном окне размеры бывают отрицательными (полоска подсказки
// выше своего низа) — радиус не меньше нуля, иначе arcTo бросает исключение и игра замирает
export function rr(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawRing(R, front) {
  const a = R.a, b = R.b, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.cos(ang) < 0) ang += Math.PI;
  const s = Math.sin(R.phi), rx = R.D / 2, ry = rx * Math.max(0.07, Math.abs(s));
  const a0 = (front ? 0 : Math.PI) + (s < 0 ? Math.PI : 0);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, ang, a0, a0 + Math.PI);
  ctx.lineWidth = P.RIM * 2; ctx.strokeStyle = front ? R.col : R.dark; ctx.stroke();
  if (front) {
    const sg = s < 0 ? -1 : 1, ox = Math.sin(ang) * P.RIM * 0.4 * sg, oy = -Math.cos(ang) * P.RIM * 0.4 * sg;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rx, ry, ang, a0 + 0.35, a0 + Math.PI - 0.35);
    ctx.lineWidth = P.RIM * 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
  }
}

export function render(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, sh);
  bg.addColorStop(0, '#ff6b5b'); bg.addColorStop(1, '#b52a28');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, sw, sh);

  // аквариум
  ctx.save();
  ctx.translate(tankX, tankY); ctx.scale(S, S);
  rr(0, 0, W, H, 18); ctx.clip();
  const wg = ctx.createLinearGradient(0, 0, 0, H);
  wg.addColorStop(0, '#8fe0ff'); wg.addColorStop(1, '#1d6fd6');
  ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

  const tm = now / 1000;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < W / 120; i++) {
    const x0 = 40 + i * 120 + Math.sin(tm * 0.4 + i * 2) * 30;
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 40, 0); ctx.lineTo(x0 - 60, H); ctx.lineTo(x0 - 130, H); ctx.closePath(); ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const s of specks) ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);

  ctx.beginPath(); ctx.moveTo(0, H);
  for (const [x, y] of FLOOR) ctx.lineTo(x, y);
  ctx.lineTo(W, H); ctx.closePath();
  const fg = ctx.createLinearGradient(0, H - 60, 0, H);
  fg.addColorStop(0, '#f4f7fb'); fg.addColorStop(1, '#b9c6d8');
  ctx.fillStyle = fg; ctx.fill();

  for (const g of pegs) {
    const fy = floorY(g.x);
    ctx.fillStyle = 'rgba(20,50,100,0.35)'; rr(g.x - 5, g.bottom, 10, fy - g.bottom + 4, 3); ctx.fill();
  }

  // Рисуем по глубине: дальние половины колец, штыри посередине (z = 0), ближние половины
  ctx.lineCap = 'butt';
  const layers = [];
  for (let k = 0; k < pegs.length; k++) layers.push({ z: 0, k });
  for (const R of world.rings) layers.push({ z: R.z - R.hz / 2, R, front: false }, { z: R.z + R.hz / 2, R, front: true });
  layers.sort((p, q) => p.z - q.z);
  for (const it of layers) {
    if (it.R) { drawRing(it.R, it.front); continue; }
    const k = it.k, g = pegs[k];
    const pg = ctx.createLinearGradient(g.x - P.PEG_R, 0, g.x + P.PEG_R, 0);
    pg.addColorStop(0, '#8d9bb0'); pg.addColorStop(0.4, '#ffffff'); pg.addColorStop(1, '#7a879b');
    ctx.fillStyle = pg; rr(g.x - P.PEG_R, g.tip - P.PEG_R, P.PEG_R * 2, g.bottom - g.tip + P.PEG_R, P.PEG_R); ctx.fill();
    ctx.fillStyle = '#dfe6ef'; rr(g.x - P.SHELF_W / 2, g.bottom - 3, P.SHELF_W, 7, 3.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; rr(g.x - P.SHELF_W / 2, g.bottom + 1, P.SHELF_W, 3, 1.5); ctx.fill();
    if (G.mode === 'colors' && G.state !== 'menu' && DUO[k]) {
      ctx.beginPath(); ctx.arc(g.x, g.tip, P.PEG_R + 2.5, 0, Math.PI * 2); ctx.fillStyle = DUO[k]; ctx.fill();
    }
  }

  for (const n of nozzles) {
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.atan2(n.dy, n.dx) + Math.PI / 2);
    ctx.fillStyle = '#2b3a55'; rr(-8, -4, 16, 16, 4); ctx.fill();
    ctx.fillStyle = '#111a2b'; rr(-4, -6, 8, 6, 2); ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }

  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, s.life / 0.6);
    ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.13)'; rr(10, 14, 10, H - 28, 5); ctx.fill();
  ctx.restore();

  rr(tankX - 4, tankY - 4, tankW + 8, tankH + 8, 18 * S + 4);
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();

  if (G.state === 'play' || G.state === 'pause') drawHud();
  if (tut.on && G.state === 'play') drawTutorial();

  if (G.toastT > 0 && G.state === 'play') {
    ctx.globalAlpha = Math.min(1, G.toastT / 0.4);
    ctx.font = `800 ${Math.round(clamp(tankW * 0.075, 18, 30))}px system-ui`; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,40,90,0.6)'; ctx.fillStyle = '#fff';
    ctx.strokeText(G.toastText, sw / 2, tankY + tankH * 0.3); ctx.fillText(G.toastText, sw / 2, tankY + tankH * 0.3);
    ctx.globalAlpha = 1;
  }
}

// Насос в углу: колба с водой — сколько её осталось в насосе. Пока жмёшь — светлеет и убывает,
// отпустил — быстро набирается; почти пустая краснеет
export function drawPump(p, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(x, y, w, h, w / 2); ctx.fill();
  const ih = h - 4, fh = Math.max(0, ih * p.stroke);
  if (fh > 0.5) {
    ctx.fillStyle = p.stroke < 0.2 ? '#ff8a7a' : p.flow > 0.05 ? '#e6fbff' : '#6fd6ff';
    rr(x + 2, y + 2 + ih - fh, w - 4, fh, (w - 4) / 2); ctx.fill();
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; rr(x, y, w, h, w / 2); ctx.stroke();
}

export function drawHud() {
  const gh = wide ? 72 : hudH - 14, gy = safeT + (wide ? PAD : 7), gl = safeL + PAD, gr = sw - safeR - PAD - GAUGE_W;
  drawPump(pumps[0], gl, gy, GAUGE_W, gh);
  drawPump(pumps[pumps.length - 1], gr, gy, GAUGE_W, gh);
  let score;
  if (G.mode === 'colors') score = `${world.rings.filter(r => r.on === r.ci).length}/${world.rings.length}`;
  else if (G.mode === 'waves') score = `${G.game.score + world.rings.filter(r => r.on >= 0).length}`;
  else score = `${world.rings.filter(r => r.on >= 0).length}/${world.rings.length}`;
  const t = G.mode === 'classic' ? G.game.t.toFixed(1) : `${Math.floor(Math.ceil(G.game.left) / 60)}:${String(Math.ceil(G.game.left) % 60).padStart(2, '0')}`;
  const name = G.mode === 'waves' ? `Волна ${G.game.wave}` : MODES[G.mode].name, taps = `Нажатий: ${G.game.presses}`;
  const tcol = G.mode !== 'classic' && G.game.left < 10 ? '#ffe14d' : '#fff';
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  if (wide) {
    // Ландшафт: слева режим, время и нажатия, справа счёт
    const lx = (safeL + tankX) / 2, rx = (tankX + tankW + sw - safeR) / 2, y = gy + gh + 30;
    ctx.textAlign = 'center';
    ctx.font = '600 16px system-ui'; ctx.fillText(name, lx, y);
    ctx.font = '800 34px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, lx, y + 38); ctx.fillStyle = '#fff';
    ctx.font = '800 34px system-ui'; ctx.fillText(score, rx, y + 38);
    ctx.font = '500 13px system-ui'; ctx.globalAlpha = 0.85;
    ctx.fillText(taps, lx, y + 72); ctx.fillText('колец', rx, y + 72);
    ctx.globalAlpha = 1;
  } else {
    const y = safeT + hudH / 2 + 3, xl = gl + GAUGE_W + 8, xr = gr - 8;
    ctx.textAlign = 'left';
    ctx.font = '600 15px system-ui'; ctx.fillText(name, xl, y - 8);
    ctx.font = '500 12px system-ui'; ctx.globalAlpha = 0.85; ctx.fillText(taps, xl, y + 10); ctx.globalAlpha = 1;
    ctx.textAlign = 'right'; ctx.font = '800 20px system-ui'; ctx.fillText(score, xr, y);
    ctx.textAlign = 'center'; ctx.font = '800 26px system-ui'; ctx.fillStyle = tcol; ctx.fillText(t, sw / 2, y);
  }
  ctx.textBaseline = 'alphabetic';
}

// Зона насоса для подсказки: полоска посреди своей зоны экрана, снизу (слабо) вверх (сильно)
export function tutStripe(side) {
  const x = sw * (side + 0.5) / pumps.length;
  return { x, y0: sh * 0.9, y1: Math.max(hudH + 62, sh * 0.25) };
}

export function drawTutorial() {
  const A = tut.a;
  if (A <= 0) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,30,70,0.5)'; ctx.shadowBlur = 6;
  for (let s = 0; s < pumps.length; s++) {
    const { x, y0, y1 } = tutStripe(s), w = 26;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0.26)');
    // Насосом уже понажимали — его полоска бледнеет
    ctx.globalAlpha = A * (tut.presses[s] >= 2 ? 0.35 : 1);
    ctx.fillStyle = gr; rr(x - w / 2, y1, w, y0 - y1, w / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 7, y1 + 15); ctx.lineTo(x, y1 + 8); ctx.lineTo(x + 7, y1 + 15); ctx.stroke();
  }
  ctx.globalAlpha = A * 0.95; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(clamp(sw * 0.035, 22, 32))}px system-ui`;
  ctx.strokeStyle = 'rgba(0,25,65,0.9)'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  ctx.strokeText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  ctx.fillText('Нажимай · выше — сильнее', sw / 2, tutStripe(0).y1 - 28);
  // Подписи шкалы у полоски: внизу слабо, наверху сильно
  ctx.font = `800 ${Math.round(clamp(sh * 0.06, 20, 28))}px system-ui`; ctx.globalAlpha = A;
  for (let s = 0; s < pumps.length; s++) {
    const { x, y0, y1 } = tutStripe(s), lx = x + (s ? -36 : 36);
    ctx.textAlign = s ? 'right' : 'left';
    ctx.strokeText('сильно', lx, y1 + 16); ctx.fillText('сильно', lx, y1 + 16);
    ctx.strokeText('слабо', lx, y0 - 14); ctx.fillText('слабо', lx, y0 - 14);
  }
  // Палец не водит, а нажимает: три отдельных касания снизу вверх, каждое — появился, нажал, исчез.
  // Круг от нажатия тем больше, чем выше касание — струя сильнее. Потом то же на другой стороне
  const TAP = 0.8, side = Math.floor(tut.t / (3 * TAP)) % pumps.length, n = Math.floor(tut.t / TAP) % 3, q = (tut.t % TAP) / TAP;
  const { x, y0, y1 } = tutStripe(side), f = [0.12, 0.5, 0.88][n], y = y0 + (y1 - y0) * f;
  const vis = q < 0.18 ? q / 0.18 : q > 0.72 ? Math.max(0, (0.95 - q) / 0.23) : 1;
  const down = clamp((q - 0.18) / 0.1, 0, 1);
  if (q > 0.26) {
    const k = clamp((q - 0.26) / 0.5, 0, 1), r = (8 + 26 * f) * (0.4 + 0.6 * k);
    ctx.globalAlpha = A * 0.45 * (1 - k * 0.7); ctx.fillStyle = '#c8f4ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = A * vis; ctx.font = '42px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('👆', x + 5, y - 3 + (1 - down) * 10);
  ctx.restore();
}
