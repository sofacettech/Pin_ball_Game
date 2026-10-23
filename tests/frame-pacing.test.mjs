import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePacer} from '../assets/frame-pacing.js';

test('wheel steps traverse intermediate frames and settle at the exact destination', () => {
  const pacer = createFramePacer();
  let displayed = 0;
  const frames = [];
  for (let i = 0; i < 120; i++) {
    const next = pacer.next(displayed, 15, 1 / 60);
    assert.ok(next >= displayed && next - displayed <= 4);
    if (next !== displayed) frames.push(next);
    displayed = next;
  }
  assert.equal(displayed, 15);
  assert.ok(frames.length >= 5, 'A wheel detent must not jump straight to its destination');
});

test('a stalled download holds its request instead of chasing scroll targets', () => {
  const pacer = createFramePacer();
  const pending = pacer.next(0, 100, 1 / 60);
  assert.ok(pending > 0 && pending <= 4);
  for (let i = 0; i < 100; i++) assert.equal(pacer.next(0, 100 + i, 1 / 60), pending);
  const resumed = pacer.next(pending, 300, 1.2);
  assert.ok(resumed > pending && resumed - pending <= 4, 'Buffering must not accumulate a catch-up jump');
});

test('reversals discard an outstanding forward target without overshooting', () => {
  const pacer = createFramePacer();
  const forward = pacer.next(50, 100, 1 / 60);
  assert.ok(forward > 50);
  const reverse = pacer.next(50, 0, 1 / 60);
  assert.ok(reverse < 50 && reverse >= 46);
  assert.equal(pacer.next(reverse, reverse, 1 / 60), reverse);
  assert.equal(pacer.next(0, 0, 1 / 60), 0);
});

test('pacing has the same travel speed on 60 Hz and 120 Hz displays', () => {
  const positions = [60, 120].map(hz => {
    const pacer = createFramePacer();
    let displayed = 0;
    for (let i = 0; i < hz; i++) displayed = pacer.next(displayed, 1000, 1 / hz);
    return displayed;
  });
  assert.ok(Math.abs(positions[0] - positions[1]) <= 1);
  assert.ok(positions[0] >= 150 && positions[0] <= 180);
});

test('a slower decoder retains elapsed presentation time without building a jump debt', () => {
  const pacer = createFramePacer();
  let displayed = 0;
  for (let i = 0; i < 30; i++) {
    const pending = pacer.next(displayed, 1000, 1 / 60);
    assert.equal(pacer.next(displayed, 1000, 1 / 60), pending);
    displayed = pending;
  }
  assert.ok(displayed >= 115 && displayed <= 120, 'A 30 Hz decoder should use small four-frame steps rather than slowing to half speed');
});

test('native completions can advance between paints without exceeding the paint jump budget', () => {
  const pacer = createFramePacer();
  let displayed = 0;
  const first = pacer.next(displayed, 1000, 1 / 60, 0);
  assert.equal(first, 3);
  displayed = first;
  const ready = pacer.next(displayed, 1000, .008, 0);
  assert.ok(ready > displayed, 'A ready native decoder should not wait for another paint');
  displayed = ready;
  for (let i = 0; i < 4; i++) displayed = pacer.next(displayed, 1000, .008, 0);
  assert.equal(displayed, 4, 'Several completions within one paint must share the four-frame budget');
  const nextPaint = pacer.next(displayed, 1000, 1 / 60, displayed);
  assert.ok(nextPaint > displayed && nextPaint <= displayed + 4);
});
