// Exercise scheduling and cleanup without requiring a sound device.
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const engine = html.split('// ---------- Звук ----------')[1].split('// ---------- Конец звука ----------')[0];
let clock = 0, starts = 0, suspends = 0;
const oscillators = new Set();
class Param {
  value = 0;
  setValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.value = v; }
  setTargetAtTime(v, t, c) { assert.ok(c > 0); this.setValueAtTime(v, t); }
  exponentialRampToValueAtTime(v, t) { assert.ok(v > 0); this.setValueAtTime(v, t); }
}
class Node {
  gain = new Param(); frequency = new Param();
  connect() {}
  disconnect() { this.disconnected = true; }
}
class Audio {
  state = 'running'; destination = {};
  get currentTime() { return clock; }
  createGain() { return new Node(); }
  createOscillator() {
    const o = new Node(); oscillators.add(o);
    o.start = t => { assert.ok(t >= clock - 0.001); starts++; };
    o.stop = t => { o.end = t ?? clock; };
    return o;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; suspends++; }
}
function advance() {
  clock += 1 / 60;
  for (const o of oscillators) if (o.end <= clock) { o.onended?.(); oscillators.delete(o); }
}
const math = Object.create(Math);
math.random = () => { throw new Error('Audio must not consume gameplay randomness'); };
const document = { hidden: false };
const storage = new Map();
const harness = `
initAudio(); audioScene();
const initial = starts();
soundCue('start'); bubbleSound(0, 1); bubbleSound(1, 1);
if (starts() <= initial) throw Error('No sound on interaction');
let maxVoices = 0;
for (let i = 0; i < 3600; i++) {
  advance(); audioUpdate();
  maxVoices = Math.max(maxVoices, audioVoices.size);
  if (i % 120 === 0) soundCue('ring');
}
if (audioVoices.size > 24) throw Error('Unbounded voices');
for (const cue of ['wrong', 'wave', 'win', 'end']) { soundCue(cue); for (let i = 0; i < 60; i++) advance(); }
state = 'pause'; audioScene();
if (audioVoices.size || audioMaster.gain.value !== 0) throw Error('Pause must silence audio');
const paused = starts(); audioUpdate(); bubbleSound(0); soundCue('win');
if (starts() !== paused) throw Error('Audio scheduled during pause');
state = 'play'; initAudio(); audioScene(); audioUpdate();
musicOn = false; audioScene();
if ([...audioVoices].some(v => v.bus === musicBus)) throw Error('Music mute failed');
sfxOn = false; stopVoices(sfxBus); audioScene();
const muted = starts();
soundCue('win'); bubbleSound(0); for (let i = 0; i < 60; i++) { advance(); audioUpdate(); }
if (starts() !== muted) throw Error('Audio scheduled while muted');
musicOn = true; sfxOn = true; audioScene(); audioUpdate();
document.hidden = true; audioScene();
if (audioVoices.size || actx.state !== 'suspended') throw Error('Background audio must stop');
document.hidden = false; initAudio(); audioScene(); audioUpdate();
state = 'over'; audioScene(); soundCue('win');
for (let i = 0; i < 90; i++) advance();
if (audioVoices.size) throw Error('Completed notes were not cleaned up');
return { maxVoices, starts: starts() };
`;
const result = runInNewContext(`${engine}\n(()=>{${harness}})()`, {
  window: { AudioContext: Audio }, document, Math: math,
  localStorage: { getItem: k => storage.get(k) ?? null },
  state: 'play', pumps: [{ held: true, flow: 0.8 }, { held: true, flow: 0.8 }],
  starts: () => starts, advance
});
assert.ok(suspends > 0);
console.log(`PASS audio: 60 s dual pumps + music, all cues, pause/resume, mute, background, cleanup; peak ${result.maxVoices}/24 voices.`);
