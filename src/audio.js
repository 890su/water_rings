// Звук: синтезатор Web Audio без файлов (музыка, пузыри, сигналы). Отдельный генератор случайных чисел — на физику не влияет.
import { G } from './core/state.js';
import { pumps } from './core/pumps.js';

// Автономный синтезатор: без файлов, шумовых петель и игрового Math.random.
export let actx = null, audioMaster = null, musicBus = null, sfxBus = null;
export let musicOn = true, sfxOn = true, musicStep = 0, nextMusic = 0, audioSeed = 173;
export const audioVoices = new Set(), nextBubble = [0, 0];
export const MUSIC_STEP = 0.375; // 80 BPM, спокойные восьмые
export const MUSIC_NOTES = [
  76, 0, 79, 0, 81, 79, 0, 76, 74, 0, 72, 0, 74, 0, 0, 0,
  72, 0, 76, 0, 79, 0, 81, 0, 79, 76, 0, 74, 72, 0, 0, 0,
  74, 0, 77, 0, 81, 79, 0, 77, 76, 0, 74, 0, 72, 0, 0, 0,
  74, 0, 79, 0, 83, 0, 81, 79, 77, 0, 74, 0, 79, 0, 0, 0
];
export const MUSIC_CHORDS = [[48, 55, 64], [45, 52, 60], [53, 60, 69], [43, 50, 62]];
try {
  musicOn = localStorage.getItem('rings_music') !== '0';
  sfxOn = localStorage.getItem('rings_sfx') !== '0';
} catch (_) { }
export const noteHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
export function soundRandom() {
  audioSeed = (Math.imul(audioSeed, 1664525) + 1013904223) >>> 0;
  return audioSeed / 4294967296;
}
export function initAudio() {
  try {
    if (!actx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      actx = new Audio();
      audioMaster = actx.createGain(); audioMaster.gain.value = 0.7;
      musicBus = actx.createGain(); musicBus.gain.value = 0;
      sfxBus = actx.createGain(); sfxBus.gain.value = sfxOn ? 0.6 : 0;
      musicBus.connect(audioMaster); sfxBus.connect(audioMaster);
      audioMaster.connect(actx.destination);
      nextMusic = actx.currentTime + 0.04;
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
  } catch (e) { actx = null; }
}
export function stopVoices(bus) {
  for (const v of audioVoices) if (!bus || v.bus === bus) {
    try { v.o.stop(); } catch (_) { }
    v.o.disconnect(); v.g.disconnect(); audioVoices.delete(v);
  }
}
export function audioScene() {
  if (!actx) return;
  const quiet = document.hidden || G.state === 'pause', t = actx.currentTime;
  audioMaster.gain.setTargetAtTime(quiet ? 0 : 0.7, t, 0.04);
  musicBus.gain.setTargetAtTime(!quiet && musicOn && (G.state === 'play' || G.state === 'menu') ? 0.16 : 0, t, 0.15);
  sfxBus.gain.setTargetAtTime(sfxOn ? 0.6 : 0, t, 0.02);
  if (quiet || !musicOn || G.state === 'over') {
    stopVoices(quiet ? null : musicBus);
    nextMusic = t + 0.04;
  }
  if (document.hidden && actx.state === 'running') actx.suspend().catch(() => {});
}
export function audioTone(freq, at, duration, volume, bus, endFreq = freq, attack = 0.012) {
  if (!actx || document.hidden || G.state === 'pause' || audioVoices.size >= 24) return;
  if ((bus === musicBus && !musicOn) || (bus === sfxBus && !sfxOn)) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, at);
  if (freq !== endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + duration * 0.85);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(volume, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  o.connect(g); g.connect(bus);
  const voice = { o, g, bus }; audioVoices.add(voice);
  o.onended = () => { o.disconnect(); g.disconnect(); audioVoices.delete(voice); };
  o.start(at); o.stop(at + duration + 0.025);
}
export function bubbleSound(side, strength = 0.5, small = false) {
  if (!actx || !sfxOn || G.state !== 'play') return;
  const t = actx.currentTime, f = (side ? 420 : 340) * (0.88 + soundRandom() * 0.32);
  audioTone(f * 1.7, t, small ? 0.10 : 0.17, small ? 0.07 : 0.10 + strength * 0.045, sfxBus, f * 0.65);
  if (!small) audioTone(f * 1.15, t + 0.065, 0.13, 0.065, sfxBus, f * 0.55);
  nextBubble[side] = t + 0.15 + soundRandom() * 0.10;
}
export function soundCue(name) {
  if (!actx || !sfxOn) return;
  const cues = {
    start: [72, 76, 79], ring: [84, 91], wrong: [67, 64],
    wave: [79, 84, 88, 91], win: [72, 76, 79, 84, 88],
    end: [79, 76, 72], tap: [79]
  };
  const notes = cues[name] || cues.tap, t = actx.currentTime;
  notes.forEach((n, i) => audioTone(noteHz(n), t + i * 0.09, name === 'win' ? 0.5 : 0.27,
    name === 'ring' ? 0.12 : 0.08, sfxBus));
}
// Переключить музыку или звуки (ключ настройки rings_music / rings_sfx)
export function toggleSound(key) {
  if (key === 'rings_music') musicOn = !musicOn; else sfxOn = !sfxOn;
}
export function audioUpdate() {
  if (!actx || actx.state !== 'running' || document.hidden || G.state === 'pause') return;
  const t = actx.currentTime;
  if (musicOn && (G.state === 'play' || G.state === 'menu')) {
    if (nextMusic < t - 0.2) nextMusic = t + 0.025; // Не догоняем пропущенные ноты.
    while (nextMusic < t + 0.12) {
      const step = musicStep % MUSIC_NOTES.length, note = MUSIC_NOTES[step];
      if (note) audioTone(noteHz(note), nextMusic, 0.65, 0.095, musicBus);
      if (step % 16 === 0) for (const n of MUSIC_CHORDS[step / 16]) {
        audioTone(noteHz(n), nextMusic, 5.6, 0.035, musicBus, noteHz(n), 0.35);
      }
      nextMusic += MUSIC_STEP; musicStep++;
    }
  }
  if (G.state === 'play' && sfxOn) for (let side = 0; side < 2; side++) {
    const p = pumps[side];
    if (p.held && p.flow > 0.08 && t >= nextBubble[side]) bubbleSound(side, p.flow, true);
  }
}
