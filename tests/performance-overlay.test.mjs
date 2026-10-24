import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceRecorder, createPerformanceOverlay, playbackQualitySummary} from '../assets/performance-overlay.js';

const state = (overrides = {}) => ({phase:'journey', desiredFrame:100, displayedFrame:0, scrollY:0, native:true, videoCallbacks:true, ...overrides});

test('page FPS and journey rate count four-frame jumps as one update', () => {
  const recorder = createPerformanceRecorder();
  for (let tick = 0; tick <= 120; tick++) {
    recorder.sample(tick * 1000 / 60, state({displayedFrame:Math.floor(tick / 6) * 4, scrollY:tick * 8}));
  }
  const result = recorder.report().current;
  assert.ok(Math.abs(result.pageFps - 60) < 1);
  assert.ok(Math.abs(result.journeyUpdatesPerSecond - 10) < 1);
  assert.equal(result.totalUpdates, 20);
});

test('continuous stall counts once and a second stall after progress is separate', () => {
  const recorder = createPerformanceRecorder();
  for (const time of [0, 16, 200, 600]) recorder.sample(time, state());
  assert.equal(recorder.report().current.stalls, 1);
  assert.equal(recorder.report().current.worstJourneyGapMs, 600);
  recorder.sample(616, state({displayedFrame:4}));
  recorder.sample(1230, state({displayedFrame:4}));
  assert.equal(recorder.report().current.stalls, 2);
});

test('idle and suspended tabs do not become journey stalls or huge page gaps', () => {
  const recorder = createPerformanceRecorder();
  for (let tick = 0; tick < 120; tick++) recorder.sample(tick * 1000 / 60, state({desiredFrame:0}));
  assert.equal(recorder.report().current.stalls, 0);
  assert.equal(recorder.report().current.journeyUpdatesPerSecond, null);
  recorder.suspend();
  for (let tick = 0; tick < 120; tick++) recorder.sample(100000 + tick * 1000 / 60, state({desiredFrame:0}));
  assert.ok(recorder.report().current.worstPageGapMs < 17);
  assert.equal(recorder.report().current.worstJourneyGapMs, 0);
});

test('native callbacks are separate and unsupported callbacks stay unavailable', () => {
  const recorder = createPerformanceRecorder();
  for (let tick = 0; tick <= 120; tick++) {
    recorder.sample(tick * 1000 / 60, state());
    if (tick % 6 === 0) recorder.presented(tick / 60);
  }
  assert.ok(recorder.report().current.nativeUpdatesPerSecond > 0);
  const unsupported = createPerformanceRecorder();
  unsupported.sample(0, state({videoCallbacks:false}));
  unsupported.sample(1000, state({videoCallbacks:false}));
  assert.equal(unsupported.report().current.nativeUpdatesPerSecond, null);
});

test('history stays bounded and report copies are independent', () => {
  const recorder = createPerformanceRecorder();
  for (let time = 0; time <= 120000; time += 500) recorder.sample(time, state());
  assert.equal(recorder.report().recentSamples.length, 120);
  const report = recorder.report(); report.current.stalls = 999; report.recentSamples[0].stalls = 999;
  assert.notEqual(recorder.report().current.stalls, 999);
  assert.notEqual(recorder.report().recentSamples[0].stalls, 999);
});

test('ordinary visitors do not create a panel or schedule diagnostics', () => {
  const previous = globalThis.location;
  try {
    globalThis.location = {search:''};
    assert.equal(typeof createPerformanceOverlay(), 'function');
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; }
});

test('lag seconds describes source-video distance and retains the worst backlog', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state({fps:60, desiredFrame:1110}));
  recorder.sample(500, state({fps:60, desiredFrame:0, displayedFrame:600}));
  const current = recorder.report().current;
  assert.equal(current.lagFrames, 600);
  assert.equal(current.lagSeconds, 10);
  assert.equal(current.worstLagSeconds, 18.5);
  assert.equal(current.sampledAtMs, 500);
});

test('missing or unpopulated playback counters do not claim zero observed drops', () => {
  assert.deepEqual(playbackQualitySummary(undefined), {
    browserCounterStatus:'unavailable', browserDroppedFrames:null, browserTotalFrames:null,
  });
  assert.deepEqual(playbackQualitySummary({totalVideoFrames:0, droppedVideoFrames:0}), {
    browserCounterStatus:'no-frames', browserDroppedFrames:0, browserTotalFrames:0,
  });
});

test('playback counters report both drops and denominator since Reset', () => {
  assert.deepEqual(playbackQualitySummary({totalVideoFrames:250, droppedVideoFrames:5}, {totalVideoFrames:200, droppedVideoFrames:3}), {
    browserCounterStatus:'available', browserDroppedFrames:2, browserTotalFrames:50,
  });
  assert.equal(playbackQualitySummary({totalVideoFrames:250, droppedVideoFrames:5}, {totalVideoFrames:250, droppedVideoFrames:5}).browserCounterStatus, 'no-frames');
});
