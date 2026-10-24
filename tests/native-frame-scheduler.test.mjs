import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeFrameScheduler} from '../assets/native-frame-scheduler.js';
import {createFramePacer} from '../assets/frame-pacing.js';

function clock() {
  let time = 0, id = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const key = ++id; jobs.set(key, {at: time + Math.max(0, delay), fn}); return key; },
    clearTimer(key) { jobs.delete(key); },
    advance(end) {
      let steps = 0;
      while (true) {
        const first = [...jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!first || first[1].at > end + 1e-7) break;
        assert.ok(++steps < 10000, 'Timers must not spin');
        jobs.delete(first[0]); time = first[1].at; first[1].fn();
      }
      time = end;
    },
    get pending() { return jobs.size; },
  };
}

function motion({direction = 1, duration = 3000, seekMs = 17, deliverAfterPaint = false, legacy = false} = {}) {
  const time = clock(), pacer = createFramePacer({responsive: true});
  let displayed = direction > 0 ? 200 : 1000, wanted = displayed, pacedAt = 0, busy = false;
  const initial = displayed, updates = [], starts = [], lags = [];
  const desired = () => initial + direction * Math.round(Math.min(time.now(), duration) * .095);
  let scheduler;
  function pump() {
    const previous = wanted;
    wanted = pacer.next(displayed, desired(), (time.now() - pacedAt) / 1000, displayed);
    pacedAt = time.now();
    const started = wanted !== displayed && wanted !== previous;
    if (started) {
      assert.equal(busy, false, 'Only one native decode may be active');
      busy = true;
      starts.push(time.now());
      const frame = wanted;
      const readyAt = time.now() + seekMs;
      // Some media events become observable just after a page RAF. The
      // scheduler must not add another full RAF interval after that callback.
      const deliveredAt = deliverAfterPaint ? Math.ceil(readyAt / (1000 / 30)) * (1000 / 30) + .2 : readyAt;
      time.setTimer(() => {
        busy = false; displayed = frame; updates.push(time.now());
        lags.push(Math.abs(desired() - displayed));
        if (!legacy) scheduler.ready();
      }, deliveredAt - time.now());
    }
    return {started, active: displayed !== desired(), pending: wanted !== displayed};
  }
  scheduler = createNativeFrameScheduler({...time, onFrame: pump});
  // The page can continue painting at 30 Hz independently of seek completion.
  for (let i = 1; i <= duration / (1000 / 30); i++) time.setTimer(() => legacy ? pump() : scheduler.request(), i * (1000 / 30));
  time.advance(duration);
  return {time, scheduler, displayed, desired: desired(), updates, starts, lags};
}

for (const direction of [1, -1]) test(`30 Hz page paints and 17 ms native seeks keep ${direction > 0 ? 'forward' : 'reverse'} motion near 30 updates/second`, () => {
  const result = motion({direction});
  assert.ok(result.updates.length >= 85 && result.updates.length <= 90);
  assert.ok(Math.max(...result.lags) <= 7);
  const intervals = result.updates.slice(1).map((at, i) => at - result.updates[i]);
  assert.ok(Math.max(...intervals) <= 34);
  assert.ok(result.scheduler.stats.nativeScheduleMaxWaitMs < 18);
  result.scheduler.destroy();
});

test('readiness just after a paint does not add another full paint of decoder idle time', () => {
  const before = motion({legacy: true, deliverAfterPaint: true});
  const after = motion({deliverAfterPaint: true});
  assert.ok(before.updates.length < 48, 'The old RAF-only scheduling reproduces the missed-slot limit');
  assert.ok(after.updates.length >= 85, 'Ready events should continue without waiting for another RAF');
  assert.ok(after.scheduler.stats.nativeScheduleMaxWaitMs < 1);
  before.scheduler.destroy(); after.scheduler.destroy();
});

test('an in-flight seek does not spend the next deadline before its completion', () => {
  const time = clock();
  let busy = false;
  const starts = [];
  const scheduler = createNativeFrameScheduler({...time, onFrame() {
    if (busy) return {active: true, pending: true, started: false};
    busy = true; starts.push(time.now());
    return {active: true, pending: true, started: true};
  }});
  scheduler.request();
  time.advance(33.4); scheduler.request();
  time.advance(34); busy = false; scheduler.ready();
  assert.deepEqual(starts, [0], 'Completion must defer until the cache finally has run');
  time.advance(34);
  assert.deepEqual(starts, [0, 34]);
  scheduler.destroy();
});

test('a long decode neither launches parallel work nor builds a burst of overdue seeks', () => {
  const time = clock();
  let busy = false;
  const starts = [];
  const scheduler = createNativeFrameScheduler({...time, onFrame() {
    if (busy) return {active: true, pending: true};
    busy = true; starts.push(time.now());
    return {active: true, pending: true, started: true};
  }});
  scheduler.request();
  for (let i = 1; i <= 30; i++) time.setTimer(() => scheduler.request(), i * 33);
  time.advance(1000);
  assert.deepEqual(starts, [0]);
  busy = false; scheduler.ready(); time.advance(1000);
  assert.deepEqual(starts, [0, 1000]);
  busy = false; scheduler.ready(); time.advance(1017);
  assert.equal(starts.length, 2);
  time.advance(1034);
  assert.equal(starts.length, 3);
  scheduler.destroy();
});

test('a reversal replaces pending work at the next cadence slot and retains single-flight decoding', () => {
  const time = clock(), pacer = createFramePacer({responsive: true});
  let displayed = 500, wanted = 500, desired = 900, lastAt = -1000 / 30, job, busy = 0;
  const requested = [];
  const scheduler = createNativeFrameScheduler({...time, onFrame() {
    const previous = wanted;
    wanted = pacer.next(displayed, desired, (time.now() - lastAt) / 1000, displayed);
    lastAt = time.now();
    const started = wanted !== displayed && wanted !== previous;
    if (started) {
      // The cache/source abort an obsolete seek before starting its replacement.
      if (job !== undefined) { time.clearTimer(job); busy--; }
      assert.equal(busy++, 0);
      const frame = wanted; requested.push(frame);
      job = time.setTimer(() => { job = undefined; busy--; displayed = frame; scheduler.ready(); }, 50);
    }
    return {started, active: displayed !== desired, pending: wanted !== displayed};
  }});
  scheduler.request();
  assert.ok(requested[0] > 500);
  time.advance(10); desired = 0; scheduler.request();
  time.advance(34);
  assert.ok(requested[1] < 500);
  time.advance(2000);
  assert.equal(displayed, 0);
  assert.equal(busy, 0);
  scheduler.destroy();
});

test('hidden, resumed and destroyed schedulers have no stale timers or catch-up debt', () => {
  const time = clock(), calls = [];
  const scheduler = createNativeFrameScheduler({...time, onFrame() { calls.push(time.now()); return {active: true, pending: false}; }});
  scheduler.request();
  assert.equal(time.pending, 1);
  scheduler.suspend();
  assert.equal(time.pending, 0);
  time.advance(10000); scheduler.ready(); scheduler.request();
  assert.deepEqual(calls, [0]);
  scheduler.resume(); scheduler.request();
  assert.deepEqual(calls, [0, 10000]);
  scheduler.destroy();
  assert.equal(time.pending, 0);
  scheduler.resume(); scheduler.ready(); scheduler.request(); time.advance(20000);
  assert.deepEqual(calls, [0, 10000]);
});

test('settled destinations stop scheduling so the cache can confirm the exact final frame', () => {
  const time = clock();
  let calls = 0;
  const scheduler = createNativeFrameScheduler({...time, onFrame() { calls++; return {active: false, pending: false}; }});
  scheduler.request(); time.advance(1000);
  assert.equal(calls, 1);
  assert.equal(time.pending, 0);
  assert.equal(scheduler.stats.nativeScheduleStarts, 0);
  scheduler.destroy();
});
