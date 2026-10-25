import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameCache} from '../assets/frame-cache.js';

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
function fixture() {
  const jobs = [];
  let alive = 0, statsReads = 0;
  const source = {
    mode: 'worker', decodeConcurrency: 4,
    get stats() { statsReads++; return {}; },
    frameBytes: () => 100,
    async loadFrames(frames) { return new Map(frames.map(frame => [frame, new Uint8Array(100)])); },
    decode(frame, _bytes, _settled, signal) {
      return new Promise((resolve, reject) => {
        const job = {frame, signal, pending: true,
          finish() {
            assert.equal(job.pending, true); job.pending = false; alive++;
            let closed = false;
            resolve({frame, close() { assert.equal(closed, false); closed = true; alive--; }});
          },
          fail(error) { assert.equal(job.pending, true); job.pending = false; reject(error); },
        };
        jobs.push(job);
      });
    },
    fallback: () => false, destroy() {},
  };
  const cache = createFrameCache({count: 128, source, onReady() {}, onError(error) { throw error; },
    config: {network: 1, batch: 12, decoded: 4, ahead: 7, behind: 4, prefetch: 12, compressedBytes: 1200, idleMs: 60000}});
  return {cache, source, jobs, pending: () => jobs.filter(job => job.pending),
    get alive() { return alive; }, get statsReads() { return statsReads; }};
}
async function dispose(f) {
  f.cache.destroy(); f.pending().forEach(job => job.finish()); await drain(); assert.equal(f.alive, 0);
}
const empty = {targetCompressedReady: false, targetDecodedReady: false, targetDecodedAgeMs: null,
  targetDecodePending: false, targetDecodeAgeMs: null, newestReadyFrame: null, newestReadyAgeMs: null};

test('frame status separates compressed readiness, pending work and retained pixel age without reading full stats', async t => {
  let now = 10; t.mock.method(performance, 'now', () => now);
  const f = fixture(), {cache} = f, out = {};
  try {
    assert.equal(cache.frameStatus(0, now, out), out, 'Reuse the caller-owned result object');
    assert.deepEqual(out, empty);
    await drain();
    assert.equal(f.pending().length, 4);
    now = 25;
    assert.deepEqual(cache.frameStatus(0, now, out), {...empty, targetCompressedReady: true, targetDecodePending: true, targetDecodeAgeMs: 15});
    now = 40; f.jobs.find(job => job.frame === 0).finish(); await drain();
    now = 55;
    assert.deepEqual(cache.frameStatus(0, now, out), {...empty, targetCompressedReady: true, targetDecodedReady: true,
      targetDecodedAgeMs: 15, newestReadyFrame: 0, newestReadyAgeMs: 15});
    assert.equal(cache.frameStatus(1, now).targetDecodeAgeMs, 45);
    now = 70; f.jobs.find(job => job.frame === 1).finish(); await drain();
    now = 80;
    assert.deepEqual(cache.frameStatus(0, now, out), {...empty, targetCompressedReady: true, targetDecodedReady: true,
      targetDecodedAgeMs: 40, newestReadyFrame: 1, newestReadyAgeMs: 10});
    const counts = [f.jobs.length, f.alive, f.pending().length];
    for (let i = 0; i < 100; i++) assert.equal(cache.frameStatus(0, now, out), out);
    assert.deepEqual([f.jobs.length, f.alive, f.pending().length], counts, 'Status reads cannot schedule or release resources');
    assert.equal(f.statsReads, 0, 'Status reads must not clone or consult source diagnostics');
    assert.equal(cache.frameStatus(0, 0).targetDecodedAgeMs, 0, 'A supplied earlier clock cannot report a negative age');
    for (const args of [[-1], [128], [1.5], [0, Infinity]]) assert.throws(() => cache.frameStatus(...args), RangeError);
  } finally { await dispose(f); }
});

test('eviction removes target pixel age while retaining the timestamp of the last accepted arrival', async t => {
  let now = 10; t.mock.method(performance, 'now', () => now);
  const f = fixture(), {cache} = f;
  try {
    await drain(); now = 20; f.pending().forEach(job => job.finish()); await drain();
    assert.equal(cache.frameStatus(0, 25).targetDecodedAgeMs, 5);
    now = 30; cache.request(60, 60, 60); await drain();
    assert.equal(cache.get(0), undefined);
    const status = cache.frameStatus(0, 35);
    assert.equal(status.targetDecodedReady, false); assert.equal(status.targetDecodedAgeMs, null);
    assert.equal(status.newestReadyFrame, 3); assert.equal(status.newestReadyAgeMs, 15);
    assert.ok(f.alive + f.pending().length <= 4);
  } finally { await dispose(f); }
});

test('suspend, fallback and destruction clear arrival metadata and ignore canceled late outputs', async t => {
  let now = 10; t.mock.method(performance, 'now', () => now);
  const f = fixture(), {cache} = f;
  try {
    await drain(); f.pending()[0].finish(); await drain();
    assert.equal(cache.frameStatus(0).newestReadyFrame, 0);
    cache.suspend(); assert.deepEqual(cache.frameStatus(0), empty);
    f.pending().forEach(job => job.finish()); await drain(); assert.deepEqual(cache.frameStatus(0), empty);
    cache.resume(); await drain(); now = 30; f.pending().find(job => job.frame === 0).finish(); await drain();
    assert.equal(cache.frameStatus(0).newestReadyFrame, 0);
    f.source.fallback = () => { f.source.mode = 'video'; f.source.decodeConcurrency = 1; return true; };
    f.pending()[0].fail(new DOMException('Decoder failed', 'EncodingError')); await drain();
    assert.equal(cache.frameStatus(0).newestReadyFrame, null); assert.equal(cache.frameStatus(0).targetDecodedAgeMs, null);
    f.pending().forEach(job => job.finish()); await drain();
    assert.equal(cache.frameStatus(0).newestReadyFrame, null, 'Old-generation output cannot become the latest arrival');
    now = 50; f.pending()[0].finish(); await drain();
    assert.equal(cache.frameStatus(0).newestReadyFrame, 0);
    assert.equal(cache.frameStatus(0).targetCompressedReady, false, 'Native placeholders are not compressed samples');
    cache.destroy(); assert.deepEqual(cache.frameStatus(0), empty);
    f.pending().forEach(job => job.finish()); await drain(); assert.deepEqual(cache.frameStatus(0), empty);
  } finally { await dispose(f); }
});

test('a changed presented frame reuses an identical download plan while target, destination and direction changes rebuild it', async () => {
  const f = fixture(), {cache} = f;
  try {
    await drain(); f.pending().forEach(job => job.finish()); await drain();
    cache.request(20, 60, 0); await drain();
    const initial = cache.stats;
    cache.request(20, 60, 1);
    assert.equal(cache.stats.planBuilds, initial.planBuilds);
    assert.equal(cache.stats.planReuses, initial.planReuses + 1);
    assert.equal(cache.stats.target, 20); assert.equal(cache.stats.direction, 1);
    assert.ok(cache.stats.decoded + cache.stats.decoding <= 4);
    cache.request(20, 60, 1);
    assert.equal(cache.stats.planReuses, initial.planReuses + 1, 'An identical request still returns immediately');
    cache.request(21, 60, 1);
    assert.equal(cache.stats.planBuilds, initial.planBuilds + 1, 'A different target changes the relative window');
    cache.request(21, 59, 1);
    assert.equal(cache.stats.planBuilds, initial.planBuilds + 2, 'A different destination changes range priority');
    cache.request(21, 59, 60);
    assert.equal(cache.stats.direction, -1);
    assert.equal(cache.stats.planBuilds, initial.planBuilds + 3, 'Direction remains part of the plan identity');
  } finally { await dispose(f); }
});
