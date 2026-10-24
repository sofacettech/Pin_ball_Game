import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrameCache} from '../assets/frame-cache.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await wait(5); }
  assert.fail('Concurrent cache did not settle');
}

function controlledSource(concurrency = 4) {
  const jobs = [], closed = [];
  let alive = 0, peakSlots = 0, suspends = 0, destroys = 0;
  const pending = () => jobs.filter(job => job.pending);
  const measure = () => { peakSlots = Math.max(peakSlots, alive + pending().length); };
  const source = {
    mode: 'worker', decodeConcurrency: concurrency, stats: {}, frameBytes: () => 1,
    async loadFrames(frames) { return new Map(frames.map(frame => [frame, new Uint8Array(1)])); },
    decode(frame, _bytes, _settled, signal) {
      return new Promise((resolve, reject) => {
        const job = {
          frame, signal, pending: true,
          finish() {
            assert.equal(job.pending, true, 'A decode may complete only once');
            job.pending = false; alive++; measure();
            let released = false;
            resolve({frame, backend: 'worker', close() {
              assert.equal(released, false, 'A decoded image may close only once');
              released = true; alive--; closed.push(frame);
            }});
          },
          fail(error) { assert.equal(job.pending, true); job.pending = false; reject(error); },
        };
        jobs.push(job); measure();
        // Deliberately ignore abort until a test acknowledges it: cancellation
        // must not give a slot to another allocation before the worker releases it.
      });
    },
    fallback: () => false,
    suspend() { suspends++; },
    destroy() { destroys++; },
  };
  return {source, jobs, closed, pending, get alive() { return alive; }, get peakSlots() { return peakSlots; },
    get suspends() { return suspends; }, get destroys() { return destroys; }};
}

function makeCache(fixture, extra = {}) {
  return createFrameCache({count: 64, source: fixture.source, onReady() {}, onError(error) { throw error; },
    ...extra, config: {decoded: 4, prefetch: 12, ahead: 7, behind: 4, batch: 12, network: 1, compressedBytes: 64, idleMs: 5, ...extra.config}});
}

async function dispose(cache, fixture) {
  cache.destroy();
  for (const job of fixture.pending()) job.finish();
  await until(() => cache.stats.decoding === 0);
  assert.equal(fixture.alive, 0);
}

test('worker decodes run concurrently, accept out-of-order frames and reserve image memory before replacement', async () => {
  const fixture = controlledSource(), ready = [];
  const cache = makeCache(fixture, {onReady(frame) { ready.push(frame); }});
  try {
    await until(() => fixture.jobs.length === 4);
    assert.deepEqual(fixture.jobs.map(job => job.frame), [0, 1, 2, 3]);
    assert.ok(fixture.jobs.every(job => job.signal instanceof AbortSignal));
    assert.equal(cache.stats.decoding, 4);
    cache.retry(); cache.request(0);
    assert.equal(fixture.jobs.length, 4, 'Repeated pumps must not decode a pending frame again');
    for (const frame of [2, 0, 3, 1]) {
      fixture.jobs.find(job => job.frame === frame).finish();
      await until(() => cache.get(frame));
      assert.ok(cache.stats.decoded + cache.stats.decoding <= 4);
    }
    await until(() => cache.stats.pending === 0);
    assert.deepEqual(ready, [2, 0, 3, 1]);
    assert.equal(cache.stats.decoded, 4);
    cache.request(2);
    await until(() => fixture.jobs.some(job => job.frame === 4));
    assert.ok(fixture.closed.includes(0), 'Evict the obsolete image before allocating its replacement');
    assert.equal(cache.stats.decoded + cache.stats.decoding, 4);
    fixture.jobs.find(job => job.frame === 4).finish();
    await until(() => cache.stats.pending === 0);
    assert.equal(cache.get(4).frame, 4);
    assert.equal(cache.stats.peakDecoding, 4);
    assert.equal(cache.stats.peakDecodedAndPending, 4);
    assert.equal(fixture.peakSlots, 4, 'Retained images plus outstanding outputs stay within the allocation budget');
  } finally { await dispose(cache, fixture); }
});

test('decode concurrency is limited by decoded capacity and remains serial without an explicit opt-in', async () => {
  for (const [concurrency, decoded, expected] of [[4, 2, 2], [undefined, 4, 1]]) {
    const fixture = controlledSource(concurrency);
    if (concurrency === undefined) { delete fixture.source.decodeConcurrency; fixture.source.mode = 'webcodecs'; }
    const cache = makeCache(fixture, {config: {decoded}});
    try {
      await until(() => fixture.jobs.length === expected);
      await wait(15);
      assert.equal(fixture.jobs.length, expected);
      assert.equal(cache.stats.decodeConcurrency, expected);
      assert.equal(cache.stats.peakDecoding, expected);
    } finally { await dispose(cache, fixture); }
  }
});

for (const [direction, target, progress] of [['forward', 104, 102], ['reverse', 96, 99]]) {
  test(`worker ${direction} requests preserve decoded progress until it has been presented`, async () => {
    const fixture = controlledSource(), cache = makeCache(fixture, {count: 256});
    try {
      await until(() => fixture.jobs.length === 4);
      fixture.pending().forEach(job => job.finish());
      await until(() => cache.stats.pending === 0);
      cache.request(100);
      await until(() => fixture.pending().length === 4);
      fixture.pending().forEach(job => job.finish());
      await until(() => cache.stats.pending === 0);
      assert.ok([99, 100, 101, 102].every(frame => cache.get(frame)), 'Start with four retained frames');
      const retained = cache.get(progress);

      // sequence.js requests the next paced target before asking closest() for
      // an intermediate image. Starting new jobs must not discard that image.
      cache.request(target, target, 100);
      assert.equal(cache.closest(target, 100), progress);
      assert.equal(cache.get(progress), retained);
      assert.equal(cache.stats.decoded + cache.stats.decoding, 4);
      cache.retry();
      assert.equal(cache.get(progress), retained, 'Repeated pumps preserve the pending presentation');

      const newerProgress = target - Math.sign(target - 100);
      fixture.pending().find(job => job.frame === newerProgress).finish();
      await until(() => cache.get(newerProgress));
      assert.equal(cache.get(progress), retained, 'Asynchronous completions cannot evict it before the next request');
      assert.equal(cache.closest(target, 100), newerProgress);
      assert.ok(fixture.peakSlots <= 4);

      cache.request(target, target, newerProgress);
      assert.ok(fixture.closed.includes(progress), 'Once newer progress is presented, its old pin can be replaced');
      assert.equal(cache.stats.decoded + cache.stats.decoding, 4);
      assert.ok(fixture.peakSlots <= 4);
    } finally { await dispose(cache, fixture); }
  });
}

test('a reversal cancels obsolete worker decodes but waits for their acknowledgement before reusing slots', async () => {
  const fixture = controlledSource(), ready = [];
  const cache = makeCache(fixture, {onReady(frame) { ready.push(frame); }});
  try {
    await until(() => fixture.jobs.length === 4);
    fixture.jobs.forEach(job => job.finish());
    await until(() => cache.stats.pending === 0);
    cache.request(20);
    await until(() => fixture.pending().length === 4);
    const old = fixture.pending();
    assert.deepEqual(old.map(job => job.frame), [20, 21, 22, 19]);
    cache.request(10, 10, 20);
    const obsolete = old.filter(job => job.frame !== 19);
    assert.ok(obsolete.every(job => job.signal.aborted));
    assert.equal(old.find(job => job.frame === 19).signal.aborted, false, 'Useful reverse progress may finish');
    assert.equal(cache.stats.decoding, 4);
    const count = fixture.jobs.length;
    cache.retry(); await wait(10);
    assert.equal(fixture.jobs.length, count, 'Unacknowledged cancellation still consumes its output slot');
    obsolete[0].finish();
    await until(() => fixture.jobs.some(job => job.frame === 10));
    assert.ok(fixture.closed.includes(20));
    assert.equal(fixture.pending().length, 4);
    assert.equal(ready.includes(20), false, 'Canceled late output must not become visible');
    for (const job of old.filter(job => job.pending)) job.finish();
    await until(() => fixture.pending().some(job => job.frame === 10));
    assert.ok(fixture.peakSlots <= 4);
    assert.ok(cache.stats.decoded + cache.stats.decoding <= 4);
    assert.ok(obsolete.every(job => fixture.closed.includes(job.frame)));
    assert.ok(obsolete.every(job => !ready.includes(job.frame)));
  } finally { await dispose(cache, fixture); }
});

test('suspend and destroy abort every worker job and close late outputs without publishing them', async () => {
  const fixture = controlledSource(), ready = [];
  const cache = makeCache(fixture, {onReady(frame) { ready.push(frame); }});
  try {
    await until(() => fixture.jobs.length === 4);
    const beforePause = [...fixture.jobs];
    cache.suspend();
    assert.equal(fixture.suspends, 1);
    assert.ok(beforePause.every(job => job.signal.aborted));
    cache.resume();
    assert.equal(fixture.jobs.length, 4, 'Resume must retain old reservations until cancellation is acknowledged');
    beforePause[0].fail(new DOMException('Worker canceled the decode', 'AbortError'));
    beforePause.slice(1).forEach(job => job.finish());
    await until(() => fixture.jobs.length === 8);
    assert.equal(fixture.alive, 0);
    assert.deepEqual(ready, []);
    const afterResume = fixture.pending();
    cache.destroy();
    assert.equal(fixture.destroys, 1);
    assert.ok(afterResume.every(job => job.signal.aborted));
    afterResume.forEach(job => job.finish());
    await until(() => cache.stats.decoding === 0);
    assert.equal(fixture.alive, 0);
    assert.equal(fixture.closed.length, 7);
    assert.deepEqual(ready, []);
  } finally { if (!fixture.destroys) await dispose(cache, fixture); }
});

test('decoder fallback cancels its other jobs and rejects stale resources before entering a serial backend', async () => {
  const fixture = controlledSource(), ready = [], nativeCalls = [];
  const workerDecode = fixture.source.decode;
  let fallbacks = 0;
  Object.defineProperty(fixture.source, 'decodeConcurrency', {get() { return this.mode === 'worker' ? 4 : 1; }});
  fixture.source.decode = function (frame, ...args) {
    if (this.mode === 'worker') return workerDecode.call(this, frame, ...args);
    nativeCalls.push(frame);
    return Promise.resolve({frame, backend: 'native', close() {}});
  };
  fixture.source.fallback = function () { fallbacks++; this.mode = 'video'; return true; };
  const cache = makeCache(fixture, {onReady(frame, image) { if (image) ready.push([frame, image.backend]); }});
  try {
    await until(() => fixture.jobs.length === 4);
    fixture.jobs[0].finish(); await until(() => cache.get(0));
    fixture.jobs[1].fail(new DOMException('Worker decoder failed', 'EncodingError'));
    await until(() => fixture.source.mode === 'video');
    assert.equal(fallbacks, 1);
    assert.ok(fixture.closed.includes(0));
    const stale = fixture.pending();
    assert.ok(stale.every(job => job.signal.aborted));
    assert.equal(cache.stats.decodeConcurrency, 1);
    assert.equal(nativeCalls.length, 0);
    stale[0].fail(new Error('The old worker has shut down')); await wait(10);
    assert.equal(nativeCalls.length, 0, 'Serial fallback must not overlap an unacknowledged old decoder job');
    stale[1].finish();
    await until(() => cache.get(0)?.backend === 'native' && cache.stats.pending === 0);
    assert.equal(fixture.alive, 0);
    assert.ok(fixture.closed.includes(stale[1].frame));
    assert.deepEqual(ready.filter(([, backend]) => backend === 'worker'), [[0, 'worker']]);
    assert.equal(fallbacks, 1);
    assert.deepEqual(nativeCalls, [0, 1, 2, 3]);
    assert.ok(fixture.peakSlots <= 4);
  } finally { await dispose(cache, fixture); }
});
