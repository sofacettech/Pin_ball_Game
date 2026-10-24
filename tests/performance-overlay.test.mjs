import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceRecorder, createPerformanceOverlay, playbackQualitySummary, createPagePauseObserver} from '../assets/performance-overlay.js';

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

test('repeated native callbacks for one source frame do not inflate displayed frame rate', () => {
  const recorder = createPerformanceRecorder();
  for (let tick = 0; tick <= 120; tick++) {
    recorder.sample(tick * 1000 / 60, state({fps:60}));
    const time = Math.floor(tick / 6) / 60;
    recorder.presented(time); recorder.presented(time + 1e-7);
  }
  assert.ok(Math.abs(recorder.report().current.nativeUpdatesPerSecond - 10) < 1);
  recorder.suspend();
  // A restored compositor can announce the same frozen frame repeatedly.
  for (let tick = 0; tick <= 60; tick++) {
    recorder.sample(100000 + tick * 1000 / 60, state({fps:60}));
    recorder.presented(20 / 60);
  }
  assert.equal(recorder.report().current.nativeUpdatesPerSecond, 0);
  assert.equal(recorder.report().current.nativeMediaTime, 20 / 60);
});

test('raw compositor evidence retains coalesced submissions without inflating distinct native FPS', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state({fps:60}));
  recorder.presented(1, 10, {presentedFrames:100});
  recorder.presented(1, 30, {presentedFrames:103});
  recorder.presented(1, 40, {presentedFrames:104});
  recorder.sample(500, state({fps:60}));
  const report = recorder.report(), callbacks = report.nativeCallbacks;
  assert.equal(report.current.nativeUpdatesPerSecond, 2, 'Three raw callbacks for the same frame count as one distinct update');
  assert.equal(callbacks.callbackCount, 3);
  assert.equal(callbacks.observedCompositionAdvances, 4);
  assert.equal(callbacks.unobservedCompositionFrames, 2);
  assert.equal(callbacks.worstCallbackGapMs, 20);
  assert.deepEqual(callbacks.recentCallbacks.map(row => [row.presentedFrames, row.compositionDelta, row.gapMs]), [[100,null,null],[103,3,20],[104,1,10]]);
  callbacks.recentCallbacks[0].presentedFrames = -1;
  assert.equal(recorder.report().nativeCallbacks.recentCallbacks[0].presentedFrames, 100);
  for (let i = 0; i < 30; i++) recorder.presented(2, 600 + i * 10, {presentedFrames:105 + i});
  assert.equal(recorder.report().nativeCallbacks.recentCallbacks.length, 20);
});

test('callback counters exclude hidden advances, handle counter resets and retain unavailable metadata', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state({fps:60}));
  recorder.presented(1, 10, {presentedFrames:100});
  recorder.presented(2, 30, {presentedFrames:101});
  recorder.suspend(); recorder.sample(100000, state({fps:60}));
  recorder.presented(2, 100010, {presentedFrames:500});
  recorder.presented(3, 100030, {presentedFrames:501});
  recorder.presented(3, 100040, {presentedFrames:0});
  recorder.presented(4, 100050, {presentedFrames:1});
  const callbacks = recorder.report().nativeCallbacks;
  assert.equal(callbacks.observedCompositionAdvances, 3);
  assert.equal(callbacks.unobservedCompositionFrames, 0);
  assert.equal(callbacks.worstCallbackGapMs, 20);
  assert.equal(callbacks.recentCallbacks[2].compositionDelta, null);
  assert.equal(callbacks.recentCallbacks[2].gapMs, null);
  assert.equal(callbacks.recentCallbacks[4].compositionDelta, null);
  const unavailable = createPerformanceRecorder();
  unavailable.sample(0, state({videoCallbacks:false}));
  assert.equal(unavailable.report().nativeCallbacks.callbackCount, null);
  unavailable.presented(1, 10);
  assert.equal(unavailable.report().nativeCallbacks.callbackCount, 1);
  assert.equal(unavailable.report().nativeCallbacks.compositionCounterStatus, 'unavailable');
  assert.equal(unavailable.report().nativeCallbacks.observedCompositionAdvances, null);
  assert.equal(createPerformanceRecorder().report().nativeCallbacks.observedCompositionAdvances, null);
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

test('page pause evidence separates journey and game freezes without hidden-tab gaps', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state());
  recorder.sample(853, state());
  recorder.sample(870, state({game:true}));
  recorder.sample(2039, state({game:true}));
  recorder.suspend();
  recorder.sample(100000, state({game:true}));
  const pauses = recorder.report().recentPagePauses;
  assert.deepEqual(pauses.map(pause => [pause.startTime, pause.duration, pause.gameBefore, pause.gameAfter]), [
    [0, 853, false, false], [870, 1169, true, true],
  ]);
  pauses[0].duration = 0;
  assert.equal(recorder.report().recentPagePauses[0].duration, 853);
  for (let i = 1; i <= 30; i++) recorder.sample(100000 + i * 200, state());
  assert.equal(recorder.report().recentPagePauses.length, 20);
});

function fakeObservers() {
  const instances = [];
  class Observer {
    static supportedEntryTypes = ['longtask', 'long-animation-frame'];
    constructor(callback) { this.callback = callback; this.queued = []; instances.push(this); }
    observe({type}) { this.type = type; this.connected = true; }
    disconnect() { this.connected = false; this.queued = []; }
    takeRecords() { return this.queued.splice(0); }
    deliver(entries) { this.callback({getEntries:() => entries}); }
  }
  return {Observer, instances};
}

test('observer capture bounds pause evidence and limits attribution to sanitized script URLs', () => {
  const {Observer, instances} = fakeObservers();
  const capture = createPagePauseObserver({Observer, now:() => 0});
  capture.start();
  const observer = instances.find(instance => instance.type === 'long-animation-frame');
  for (let i = 0; i < 25; i++) observer.deliver([{startTime:i * 1000, duration:1169, blockingDuration:1100,
    scripts:[{startTime:i * 1000, duration:900, sourceURL:'https://user:secret@example.test/play.js?token=private#user', invoker:'private input'},
      {startTime:i * 1000, duration:100, sourceURL:'data:text/javascript,private input'}],
  }]);
  const report = capture.report();
  assert.equal(report.recentEntries.length, 20);
  assert.equal(report.apis['long-animation-frame'].count, 25);
  assert.equal(report.apis['long-animation-frame'].worstDurationMs, 1169);
  assert.equal(report.recentEntries[0].startTime, 5000);
  assert.deepEqual(report.recentEntries[0].scripts[0], {startTime:5000, duration:900, sourceURL:'https://example.test/play.js'});
  assert.equal(report.recentEntries[0].scripts[1].sourceURL, null);
  assert.ok(!JSON.stringify(report).includes('private'));
  report.recentEntries[0].scripts[0].sourceURL = 'changed';
  assert.equal(capture.report().recentEntries[0].scripts[0].sourceURL, 'https://example.test/play.js');
  capture.destroy();
  assert.ok(instances.every(instance => !instance.connected));
});

test('observer capture flushes queued evidence and excludes paused or pre-reset entries', () => {
  const {Observer, instances} = fakeObservers();
  let now = 0;
  const capture = createPagePauseObserver({Observer, now:() => now});
  capture.start();
  const observer = instances.find(instance => instance.type === 'longtask');
  observer.queued.push({startTime:10, duration:100});
  capture.stop();
  observer.deliver([{startTime:200, duration:900}]);
  assert.equal(capture.report().apis.longtask.count, 1);
  now = 1000; capture.start();
  observer.deliver([{startTime:200, duration:900}, {startTime:1100, duration:80}]);
  assert.equal(capture.report().apis.longtask.count, 2);
  now = 2000; capture.reset();
  observer.deliver([{startTime:1100, duration:80}, {startTime:2010, duration:120}]);
  assert.equal(capture.report().apis.longtask.count, 1);
  assert.equal(capture.report().recentEntries[0].startTime, 2010);
  capture.destroy(); capture.start();
  observer.deliver([{startTime:3000, duration:500}]);
  assert.equal(capture.report().apis.longtask.count, 1);
});

test('unsupported or rejected observer APIs stay distinct from a supported zero count', () => {
  const unsupported = createPagePauseObserver({Observer:null});
  unsupported.start();
  assert.deepEqual(unsupported.report().apis.longtask, {status:'unsupported', count:null, worstDurationMs:null});
  class RejectedObserver {
    static supportedEntryTypes = ['longtask'];
    observe() { throw new Error('unavailable'); }
    disconnect() {}
  }
  const rejected = createPagePauseObserver({Observer:RejectedObserver});
  rejected.start();
  assert.equal(rejected.report().apis.longtask.status, 'unavailable');
  assert.equal(rejected.report().apis.longtask.count, null);
  assert.equal(rejected.report().apis['long-animation-frame'].status, 'unsupported');
  const {Observer} = fakeObservers();
  const supported = createPagePauseObserver({Observer}); supported.start();
  assert.deepEqual(supported.report().apis.longtask, {status:'supported', count:0, worstDurationMs:0});
  unsupported.destroy(); rejected.destroy(); supported.destroy();
});
