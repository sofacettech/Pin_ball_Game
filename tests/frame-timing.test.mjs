import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameTimingRecorder} from '../assets/frame-timing.js';

test('stage timings separate worker transit, output, bitmap and first draw across time origins', () => {
  let clock = 40;
  const recorder = createFrameTimingRecorder({now: () => clock, timeOrigin: 1000});
  const image = {};
  recorder.received(image, 10, {received: 1012, output: 1016, bitmap: 1019});
  clock = 45; recorder.drawn(image);
  clock = 90; recorder.drawn(image); recorder.drawn({});
  const stats = recorder.stats;
  assert.equal(stats.workerDrawnOutputs, 1);
  assert.equal(stats.workerUndrawnOutputs, 0);
  for (const [name, expected] of Object.entries({requestToReceipt: 30, requestToWorker: 2,
    workerToOutput: 4, outputToBitmap: 3, bitmapToReceipt: 21, receiptToDraw: 5, requestToDraw: 35})) {
    assert.equal(stats.workerFrameTimings[name].meanMs, expected, name);
    assert.equal(stats.workerFrameTimings[name].count, 1, name);
  }
});

test('recent percentiles stay bounded while lifetime totals retain an early slow frame', () => {
  let clock = 0;
  const recorder = createFrameTimingRecorder({now: () => clock, timeOrigin: 1000, limit: 3});
  for (let i = 0; i < 10; i++) {
    clock = i * 100;
    recorder.received({}, clock - (i === 0 ? 80 : i));
  }
  const stats = recorder.stats, roundTrip = stats.workerFrameTimings.requestToReceipt;
  assert.equal(stats.workerUndrawnOutputs, 10, 'Undrawn includes buffered lookahead and is not a waste estimate');
  assert.equal(roundTrip.count, 10);
  assert.equal(roundTrip.meanMs, 12.5);
  assert.equal(roundTrip.maxMs, 80);
  assert.equal(roundTrip.recentCount, 3);
  assert.equal(roundTrip.p95Ms, 9);
  roundTrip.maxMs = 999;
  assert.equal(recorder.stats.workerFrameTimings.requestToReceipt.maxMs, 80, 'Snapshots do not mutate retained evidence');
});

test('invalid or unavailable worker clocks leave stage gaps unmeasured without losing overall timings', () => {
  const recorder = createFrameTimingRecorder({now: () => 50, timeOrigin: 1000});
  for (const timing of [undefined, {received: NaN, output: 1040, bitmap: 1041}, {received: 1040, output: 1030, bitmap: 1041}]) {
    recorder.received({}, 10, timing);
  }
  assert.equal(recorder.stats.workerFrameTimings.requestToReceipt.count, 3);
  assert.equal(recorder.stats.workerFrameTimings.workerToOutput.count, 0);
  assert.equal(recorder.stats.workerFrameTimings.bitmapToReceipt.p95Ms, null);
});

test('clock precision is tolerated but impossible transport durations are not invented', () => {
  const recorder = createFrameTimingRecorder({now: () => 50, timeOrigin: 1000});
  recorder.received({}, 10, {received: 1009, output: 1020, bitmap: 1051});
  recorder.received({}, 10, {received: 900, output: 920, bitmap: 1100});
  const stats = recorder.stats.workerFrameTimings;
  assert.equal(stats.requestToWorker.count, 1);
  assert.equal(stats.requestToWorker.meanMs, 0);
  assert.equal(stats.bitmapToReceipt.count, 1);
  assert.equal(stats.bitmapToReceipt.meanMs, 0);
});
