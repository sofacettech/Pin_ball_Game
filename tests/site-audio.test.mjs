import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../sounds/site-audio.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function audioHarness({ muted = false } = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), scheduled = [], cleared = [], contexts = [], gains = [], starts = [];
  const element = () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
  const button = element();
  const document = {
    hidden: false, body: { hasAttribute: () => true }, addEventListener() {},
    createElement: () => button,
    querySelector: selector => selector === '#site-sound' ? button : { prepend() {} },
  };
  class Audio {
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() {}
  }
  const node = () => ({ connect(destination) { return destination; }, disconnect() {} });
  class AudioContext {
    state = 'suspended';
    destination = {};
    constructor() { contexts.push(this); }
    get currentTime() { return now / 1000; }
    addEventListener(_, callback) { this.changed = callback; }
    async resume() { this.state = 'running'; this.changed?.(); }
    async suspend() { this.state = 'suspended'; this.changed?.(); }
    createGain() {
      const gain = { value: 0, changes: [], setTargetAtTime(value) { this.value = value; this.changes.push(value); }, setValueAtTime() {}, linearRampToValueAtTime() {} };
      gains.push(gain);
      return { ...node(), gain };
    }
    createMediaElementSource() { return node(); }
    createBufferSource() { return { ...node(), start(...args) { starts.push({ source: this, args }); } }; }
    async decodeAudioData() { return { duration: 1 }; }
  }
  const sandbox = {
    document, Audio, AudioContext, console,
    window: { addEventListener() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: { getItem: () => muted ? 'off' : 'on', setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => now },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
    setTimeout(callback, delay) { const id = ++timerId; scheduled.push(delay); timers.set(id, { callback, at: now + delay, delay }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  };
  // Execute the shipped module, including its startup and event wiring, in an isolated browser fixture.
  vm.runInNewContext(source.replace(/^export /gm, '') + '\nglobalThis.sound = siteSound;', sandbox);
  return {
    sound: sandbox.sound, document, contexts, gains, scheduled, cleared,
    get impacts() { return starts.filter(item => !item.source.loop).length; },
    rollingTimers: () => [...timers.values()].filter(timer => timer.delay === 130).length,
    async activate() { sandbox.sound.setActive(true); await flush(); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = until;
    },
  };
}

test('silent scrolling does not create or cancel timers before audio activation', () => {
  const h = audioHarness();
  for (let frame = 241; frame < 900; frame++) h.sound.frame(frame);
  assert.equal(h.contexts.length, 0);
  assert.deepEqual(h.scheduled, []);
  assert.deepEqual(h.cleared, []);
});

test('audible scrolling replaces one rolling timer and stops after 130ms without movement', async () => {
  const h = audioHarness(); await h.activate();
  h.sound.frame(260);
  assert.equal(h.rollingTimers(), 1);
  assert.ok(h.gains[2].value > 0);
  h.advance(80); h.sound.frame(270);
  assert.equal(h.rollingTimers(), 1);
  const scheduled = h.scheduled.length;
  h.sound.frame(270);
  assert.equal(h.scheduled.length, scheduled);
  h.advance(129); assert.ok(h.gains[2].value > 0);
  h.advance(1); assert.equal(h.gains[2].value, 0);
  assert.equal(h.gains[1].value, .1);
});

test('mute and unmute retain frame tracking without stale rolling state or muted timer churn', async () => {
  const h = audioHarness(); await h.activate(); h.sound.frame(300);
  h.sound.toggle();
  assert.equal(h.rollingTimers(), 0);
  assert.equal(h.gains[2].value, 0);
  const scheduled = h.scheduled.length, cleared = h.cleared.length;
  for (let frame = 301; frame <= 600; frame++) h.sound.frame(frame);
  assert.equal(h.scheduled.length, scheduled);
  assert.equal(h.cleared.length, cleared);
  h.sound.toggle(); await flush();
  assert.equal(h.sound.enabled, true);
  assert.equal(h.gains[1].value, .1, 'silent motion must not leave music ducked on unmute');
  h.sound.frame(600); assert.equal(h.rollingTimers(), 0, 'already displayed frame remains deduplicated');
  h.sound.frame(601); assert.equal(h.rollingTimers(), 1);
  h.sound.setActive(false); assert.equal(h.rollingTimers(), 0);
});

test('muted impact crossings are consumed and only a sufficiently deep reversal rearms them', async () => {
  const h = audioHarness({ muted: true }); await h.activate();
  h.sound.frame(2164);
  assert.equal(h.impacts, 0);
  assert.equal(h.contexts.length, 0);
  h.sound.toggle(); await flush();
  h.sound.frame(2165); assert.equal(h.impacts, 0);
  h.sound.frame(2158); h.sound.frame(2164); assert.equal(h.impacts, 0);
  h.sound.frame(2150); h.sound.frame(2164); assert.equal(h.impacts, 1);
  h.sound.frame(2164); h.sound.frame(2165); assert.equal(h.impacts, 1);
  h.sound.handoff(); assert.equal(h.rollingTimers(), 0);
});

test('hidden and inactive frames do not schedule rolling work and visible movement resumes', async () => {
  const h = audioHarness(); await h.activate(); h.sound.frame(300);
  h.document.hidden = true; h.sound.visibility();
  assert.equal(h.rollingTimers(), 0);
  const scheduled = h.scheduled.length;
  h.sound.frame(400); assert.equal(h.scheduled.length, scheduled);
  h.document.hidden = false; h.sound.visibility(); await flush();
  h.sound.frame(401); assert.equal(h.rollingTimers(), 1);
  h.sound.setActive(false);
  const inactiveScheduled = h.scheduled.length;
  h.sound.frame(500); assert.equal(h.scheduled.length, inactiveScheduled);
});
