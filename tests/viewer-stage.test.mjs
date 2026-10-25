import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import { framePlacement } from '../frame-placement.js';

const source = await readFile(new URL('../viewer.js', import.meta.url), 'utf8');

async function viewerHarness() {
  let now = 0, nextFrame = 0, resizeCallback;
  const frames = new Map(), placements = [], cues = [], writes = [], errors = [];
  const bounds = { width: 390, height: 844 };
  const target = () => {
    const listeners = new Map();
    return { addEventListener(type, fn) { listeners.set(type, fn); }, emit(type, event = {}) { listeners.get(type)?.(event); } };
  };
  const cover = { ...target(), matches: true }, reduced = { ...target(), matches: false };
  const canvas = target(), opening = { ...target(), currentTime: 0, paused: true, ended: false };
  const stage = { parentElement: { getBoundingClientRect: () => bounds }, style: new Proxy({}, { set(object, key, value) { writes.push([key, value]); object[key] = value; return true; } }) };
  const status = { classList: { add() {} } };
  const document = { ...target(), hidden: false, querySelector: selector => ({ '#ball-canvas': canvas, '#status': status, '#scene-frame': stage, '#opening': opening })[selector] };
  const window = { ...target(), devicePixelRatio: 2 };
  const sequence = { phase: 'idle', displayedFrame: 0, tick: () => false, destroy() {} };
  const plate = { weight: 0, target: 0 };
  const hover = { plates: new Map([[0, plate]]), update() { plate.weight = plate.target; }, clear() {}, restoreBase() {}, pick() {}, wave() {}, reset() {} };
  const points = Array.from({ length: 2230 }, (_, i) => [.3 + i / 6000, .4 + i / 12000]);
  const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const reference = { cameraWorldMatrixRows: identity, projectionMatrixRows: identity };
  class Renderer {
    renders = 0;
    setPixelRatio() {} setClearColor() {} setSize() {} setScissorTest() {} setScissor() {}
    render() { this.renders++; }
  }
  const sandbox = {
    document, window, AbortController, console: { error: error => errors.push(error) },
    THREE: { ...THREE, WebGLRenderer: Renderer },
    matchMedia: query => query.includes('reduce') ? reduced : cover,
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} disconnect() {} },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    fetch: async url => ({ ok: true, json: async () => url.includes('framing') ? { fps: 60, points } : reference }),
    loadSofacetBall: async () => ({ scene: new THREE.Group(), animations: [new THREE.AnimationClip('idle', 4, [])] }),
    loadSofacetReflections: async () => ({ texture: null }), loadSofacetLighting: async () => new THREE.Group(),
    createPlateHover: async () => hover, matchRenderedAppearance: async () => ({}),
    prepareMedia: async () => ({}), finishLoading: async () => {},
    createSequence: async () => sequence,
    createPerformanceOverlay: () => () => {},
    createScrollCue: () => (frame, point) => cues.push({ frame, point: [...point], reduced: reduced.matches }),
    framePlacement(...args) { placements.push(args); return framePlacement(...args); },
  };
  // Only imports are replaced: the actual async viewer setup, RAF and event handlers run.
  vm.runInNewContext(source.replace(/^import .*;$/gm, ''), sandbox);
  for (let i = 0; i < 40 && !window.sofacetPreview && !errors.length; i++) await Promise.resolve();
  assert.deepEqual(errors, []);
  assert.ok(window.sofacetPreview, 'viewer initialized');
  function paint(request = true) {
    if (request) opening.emit('seeked');
    const callbacks = [...frames.values()]; frames.clear(); now += 16;
    for (const callback of callbacks) callback(now);
  }
  paint();
  return {
    sequence, opening, cover, reduced, plate, placements, cues, writes, stage, paint,
    renderer: window.sofacetPreview.renderer,
    resize(width, height) { bounds.width = width; bounds.height = height; resizeCallback(); },
    expected(sourceFrame) {
      const index = Math.floor(sourceFrame), next = points[Math.min(index + 1, points.length - 1)];
      const point = points[index].map((v, i) => v + (next[i] - v) * (sourceFrame - index));
      return framePlacement(bounds.width, bounds.height, point, cover.matches);
    },
  };
}

function assertPlacement(h, frame) {
  const expected = h.expected(frame);
  assert.equal(h.stage.style.width, `${expected.width}px`);
  assert.equal(h.stage.style.height, `${expected.height}px`);
  assert.equal(h.stage.style.transform, `translate3d(${expected.x}px,${expected.y}px,0)`);
  assert.equal(h.cues.at(-1).frame, frame);
}

test('repeated RAFs waiting on one image do not recalculate placement or repaint its cue', async () => {
  const h = await viewerHarness();
  h.sequence.phase = 'journey'; h.sequence.displayedFrame = 500; h.paint();
  const placements = h.placements.length, cues = h.cues.length, writes = h.writes.length;
  for (let i = 0; i < 120; i++) h.paint();
  assert.equal(h.placements.length, placements);
  assert.equal(h.cues.length, cues);
  assert.equal(h.writes.length, writes);
  assertPlacement(h, 740);
});

test('opening fractional frames, journey advances, reversals and return to hover keep exact framing', async () => {
  const h = await viewerHarness();
  h.sequence.phase = 'opening'; h.opening.currentTime = 2.102; h.paint(); assertPlacement(h, 2.102 * 60);
  h.sequence.phase = 'idle'; h.paint(); assertPlacement(h, 240);
  h.sequence.phase = 'journey'; h.sequence.displayedFrame = 100; h.paint(); assertPlacement(h, 340);
  h.sequence.displayedFrame = 10; h.paint(); assertPlacement(h, 250);
  h.sequence.phase = 'idle'; h.paint(); assertPlacement(h, 240);
  const placements = h.placements.length, renders = h.renderer.renders;
  h.plate.target = 1; h.paint();
  assert.equal(h.placements.length, placements);
  assert.equal(h.renderer.renders, renders + 1, 'unchanged framing must not suppress hover rendering');
});

test('same-frame resize, cover mode and reduced-motion changes still update geometry and cue', async () => {
  const h = await viewerHarness();
  h.sequence.phase = 'journey'; h.sequence.displayedFrame = 10; h.paint();
  const placements = h.placements.length;
  h.resize(844, 390); assertPlacement(h, 250);
  assert.equal(h.placements.length, placements + 1);
  h.paint(); assert.equal(h.placements.length, placements + 1);
  h.cover.matches = false; h.cover.emit('change'); assertPlacement(h, 250);
  assert.equal(h.placements.length, placements + 2);
  h.paint();
  const cues = h.cues.length;
  h.reduced.matches = true; h.reduced.emit('change'); h.paint(false);
  assert.equal(h.cues.length, cues + 1);
  assert.equal(h.cues.at(-1).reduced, true);
  assertPlacement(h, 250);
});
