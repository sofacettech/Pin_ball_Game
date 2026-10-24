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

test('responsive native pacing keeps ordinary wheel detents smooth', () => {
  const pacer = createFramePacer({responsive: true});
  let displayed = 0, updates = 0;
  for (let tick = 0; tick < 120; tick++) {
    const next = pacer.next(displayed, 15, 1 / 60);
    assert.ok(next >= displayed && next - displayed <= 4);
    if (next !== displayed) updates++;
    displayed = next;
  }
  assert.equal(displayed, 15);
  assert.ok(updates >= 5);
});

test('a 10 Hz native decoder catches the reported iPhone backlog within 1.2 seconds', () => {
  const pacer = createFramePacer({responsive: true});
  let displayed = 1100, pending = displayed, finishedAt;
  // Three 30 Hz paints per native completion models the slow phone report.
  for (let tick = 0; tick <= 36; tick++) {
    if (tick && tick % 3 === 0) displayed = pending;
    if (displayed === 0) { finishedAt = tick / 30; break; }
    const next = pacer.next(displayed, 0, 1 / 30);
    assert.ok(next >= 0 && next < displayed);
    if (tick % 3) assert.equal(next, pending, 'Keep a useful in-flight seek stable');
    pending = next;
  }
  assert.equal(displayed, 0);
  assert.ok(finishedAt <= 1.2);
});

test('native pacing stays near an ongoing swipe and settles promptly when it stops', () => {
  const pacer = createFramePacer({responsive: true});
  let displayed = 0, pending = 0, worstLag = 0;
  for (let tick = 0; tick <= 174; tick++) {
    if (tick && tick % 3 === 0) displayed = pending;
    // Five seconds at 300 source frames/second, followed by a stationary finger.
    const desired = Math.min(1500, tick * 10);
    pending = pacer.next(displayed, desired, 1 / 30);
    assert.ok(pending >= displayed && pending <= desired);
    worstLag = Math.max(worstLag, desired - displayed);
  }
  assert.ok(worstLag < 90, `The swipe accumulated ${worstLag} frames of lag`);
  assert.equal(displayed, 1500);
});

test('a native reversal replaces the obsolete seek and settles across the full journey', () => {
  const pacer = createFramePacer({responsive: true});
  const forward = pacer.next(1100, 1924, 1 / 30);
  assert.ok(forward > 1100);
  const reverse = pacer.next(1100, 0, 1 / 30);
  assert.ok(reverse < 1100, 'Reverse immediately instead of completing the old direction');
  assert.equal(pacer.next(1100, 0, 1 / 30), reverse);
  let displayed = reverse, pending = reverse;
  for (let tick = 0; tick <= 60; tick++) {
    if (tick && tick % 3 === 0) displayed = pending;
    pending = pacer.next(displayed, 1924, 1 / 30);
    assert.ok(pending >= displayed && pending <= 1924);
  }
  assert.equal(displayed, 1924);
});

test('a native stall holds one seek and does not accrue an unbounded catch-up jump', () => {
  const pacer = createFramePacer({responsive: true});
  const capped = createFramePacer({responsive: true});
  const pending = pacer.next(0, 1100, 1 / 30);
  assert.equal(capped.next(0, 1100, 1 / 30), pending);
  for (let tick = 0; tick < 150; tick++) assert.equal(pacer.next(0, 1100, 1 / 30), pending);
  const resumed = pacer.next(pending, 1100, 5);
  assert.ok(resumed > pending);
  assert.equal(resumed, capped.next(pending, 1100, .1),
    'A long stall must behave exactly like the capped 100 ms catch-up interval');
});

test('native catch-up completions within one paint share the same jump budget', () => {
  const pacer = createFramePacer({responsive: true});
  const first = pacer.next(0, 1100, 1 / 30, 0);
  let displayed = first;
  for (let i = 0; i < 5; i++) {
    const next = pacer.next(displayed, 1100, .008, 0);
    assert.ok(next >= displayed, 'A spent paint budget must not move the video backward');
    displayed = next;
  }
  assert.ok(displayed <= first + 1, 'Sub-paint completions must not multiply a catch-up jump');
  assert.ok(pacer.next(displayed, 1100, 1 / 30, displayed) > displayed);
});
