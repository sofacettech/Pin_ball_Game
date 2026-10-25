import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceRecorder, createPerformanceOverlay, playbackQualitySummary, createPagePauseObserver, bufferPacingSummary} from '../assets/performance-overlay.js';

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


test('pipeline history distinguishes data waiting from decoding and keeps independent scalar snapshots', () => {
  const recorder = createPerformanceRecorder();
  const stats = {mode:'worker', renderer:'worker-webcodecs', requestedRenderer:'worker', target:100,
    direction:1, decoded:1, decodedBytes:8294400, compressed:0, compressedBytes:0,
    network:2, networkRequests:6, networkFrames:4, networkBytes:300000, diskHits:0,
    decoding:0, pending:2, queued:20, workerRequests:4, workerCompleted:4, workerTimeouts:0,
    workerDecodeTotalMs:20, workerBitmapCopies:4, workerBitmapCopyMs:2, canvasDrawCount:1,
    mediaOrigin:'https://private.example/video?token=secret', lastError:{message:'private detail'}};
  let reads = 0;
  const read = () => { reads++; return stats; };
  recorder.sample(0, state(), read);recorder.sample(499, state(), read);
  assert.equal(reads, 1, 'A stall detection captures one extra snapshot, not one per paint');
  recorder.sample(500, state(), read);
  Object.assign(stats, {network:0, networkFrames:28, networkBytes:2100000, compressed:24,
    compressedBytes:1800000, decoding:4, pending:0, workerRequests:8});
  recorder.sample(1000, state(), read);
  Object.assign(stats, {decoded:4, decoding:0, workerCompleted:8, workerBitmapCopies:8,
    workerDecodeTotalMs:40, workerBitmapCopyMs:4, canvasDrawCount:5});
  recorder.sample(1500, state({displayedFrame:100}), read);
  const report = recorder.report(), [waiting, decoding, ready] = report.recentSamples.map(row => row.pipeline);
  assert.equal(reads, 4, 'Recovery at the regular sample boundary reuses that snapshot');
  assert.deepEqual([waiting.network, waiting.decoding, waiting.compressed, waiting.workerCompleted], [2, 0, 0, 4]);
  assert.deepEqual([decoding.network, decoding.decoding, decoding.compressed, decoding.workerCompleted], [0, 4, 24, 4]);
  assert.deepEqual([ready.decoding, ready.workerCompleted, ready.workerBitmapCopies, ready.canvasDrawCount], [0, 8, 8, 5]);
  assert.equal(decoding.networkBytes - waiting.networkBytes, 1800000);
  assert.equal(ready.workerDecodeTotalMs - decoding.workerDecodeTotalMs, 20);
  assert.equal(waiting.renderer, 'worker-webcodecs');assert.equal(waiting.target, 100);
  assert.equal(waiting.decodeMs, null, 'An unavailable metric must not imply zero cost');
  assert.ok(!JSON.stringify(report).includes('private'));assert.ok(!JSON.stringify(report).includes('https:'));
  report.current.pipeline.workerCompleted = -1;report.recentSamples[0].pipeline.network = -1;
  stats.target = 999;
  assert.equal(recorder.report().current.pipeline.workerCompleted, 8);
  assert.equal(recorder.report().recentSamples[0].pipeline.network, 2);
  assert.equal(recorder.report().current.pipeline.target, 100);
});

test('pipeline capture retains only 120 samples at the existing half-second cadence', () => {
  const recorder = createPerformanceRecorder();let reads = 0;
  const read = () => ({mode:'worker', target:++reads, networkBytes:reads * 1000});
  for (let time = 0; time <= 120000; time += 10) recorder.sample(time, state({desiredFrame:0}), read);
  const report = recorder.report();
  assert.equal(reads, 240);assert.equal(report.recentSamples.length, 120);
  assert.equal(report.recentSamples[0].atMs, 60500);
  assert.equal(report.recentSamples[0].pipeline.target, 121);
  assert.equal(report.recentSamples.at(-1).pipeline.target, 240);
  assert.equal(report.recentSamples.at(-1).pipeline.networkBytes, 240000);
  assert.equal(report.current.pipeline.workerCompleted, null);
  recorder.suspend();recorder.sample(1000000, state({desiredFrame:0}), read);recorder.sample(1000499, state({desiredFrame:0}), read);
  assert.equal(reads, 240, 'Resuming after hidden time must start a fresh sample window');
  recorder.sample(1000500, state({desiredFrame:0}), read);assert.equal(reads, 241);
  assert.equal(recorder.report().recentSamples.length, 120);
});

test('pipeline snapshots identify a renderer fallback without substituting unavailable counters', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state());
  recorder.sample(500, state(), () => ({mode:'worker', renderer:'worker-webcodecs', requestedRenderer:'worker', workerTimeouts:0}));
  recorder.sample(1000, state(), () => ({mode:'video', renderer:'native-video', requestedRenderer:'worker', workerTimeouts:1, fallbacks:1, networkBytes:NaN}));
  const [before, after] = recorder.report().recentSamples.map(row => row.pipeline);
  assert.equal(before.mode, 'worker');assert.equal(after.mode, 'video');assert.equal(after.requestedRenderer, 'worker');
  assert.equal(after.workerTimeouts, 1);assert.equal(after.fallbacks, 1);assert.equal(after.networkBytes, null);
});


test('buffer pacing history retains optional scalars at the existing cadence without hiding real stalls', () => {
  const recorder = createPerformanceRecorder();
  const stats = {bufferAheadFrames:12, bufferAheadSeconds:.2, bufferRequiredFrames:72,
    bufferPacingScale:.75, bufferPacingLimited:true, bufferPacingSpeed:45};
  let reads = 0;
  const read = () => { reads++; return stats; };
  for (let time = 0; time < 500; time += 10) recorder.sample(time, state(), read);
  assert.equal(reads, 1, 'Only the first genuine stall boundary adds a snapshot before 500ms');
  recorder.sample(500, state(), read);
  const limited = recorder.report().current;
  assert.deepEqual(Object.fromEntries(Object.keys(stats).map(key => [key, limited.pipeline[key]])), stats);
  assert.equal(limited.stalls, 1, 'Intentional buffer pacing must not erase an actual no-progress gap');
  Object.assign(stats, {bufferAheadFrames:80, bufferAheadSeconds:80 / 60, bufferPacingScale:1,
    bufferPacingLimited:false, bufferPacingSpeed:60});
  recorder.sample(1000, state({displayedFrame:4}), read);
  const report = recorder.report();
  assert.equal(reads, 3, 'Stall detection plus two regular boundaries; recovery shares its regular read');
  assert.equal(report.recentSamples[0].pipeline.bufferPacingLimited, true);
  assert.equal(report.current.pipeline.bufferPacingLimited, false, 'Full pace is available evidence, not null');
  assert.equal(report.current.pipeline.bufferPacingSpeed, 60);
  report.recentSamples[0].pipeline.bufferAheadFrames = 999;
  report.current.pipeline.bufferPacingScale = 0;
  assert.equal(recorder.report().recentSamples[0].pipeline.bufferAheadFrames, 12);
  assert.equal(recorder.report().current.pipeline.bufferPacingScale, 1);
  recorder.sample(1500, state(), () => ({bufferAheadFrames:Infinity, bufferAheadSeconds:NaN,
    bufferRequiredFrames:'72', bufferPacingScale:undefined, bufferPacingLimited:0, bufferPacingSpeed:null}));
  for (const key of Object.keys(stats)) assert.equal(recorder.report().current.pipeline[key], null);
});

test('compact buffer pacing text distinguishes configured slowdown from actual update rate', () => {
  assert.equal(bufferPacingSummary({bufferPacingScale:.75, bufferAheadFrames:12, bufferRequiredFrames:72}),
    'Buffer pace 0.75× · ahead 12/72f');
  assert.equal(bufferPacingSummary({bufferPacingScale:0, bufferAheadFrames:0, bufferRequiredFrames:72}),
    'Buffer pace 0.00× · ahead 0/72f');
  assert.equal(bufferPacingSummary({bufferPacingScale:1, bufferAheadFrames:80, bufferRequiredFrames:72}),
    'Buffer pace 1.00× · ahead 80/72f');
  assert.equal(bufferPacingSummary({bufferPacingScale:.5}), 'Buffer pace 0.50× · ahead ?/?f');
  assert.equal(bufferPacingSummary(), null);
  assert.equal(bufferPacingSummary({bufferPacingScale:NaN}), null);
});

test('settled gesture grace does not invent a stall or erase raw update-gap evidence', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state({desiredFrame:0}));
  recorder.sample(16, state({desiredFrame:4, displayedFrame:4, scrollY:32}));
  for (let time = 32; time <= 600; time += 16) recorder.sample(time, state({desiredFrame:4, displayedFrame:4, scrollY:32}));
  const report = recorder.report();
  assert.equal(report.current.stalls, 0);
  assert.deepEqual(report.recentJourneyStalls, []);
  assert.ok(report.current.worstJourneyGapMs >= 180, 'Existing raw gaps remain visible; only the misleading stall classification changes');
});

test('a genuine pending wait records onset, fresh detection and recovery with readiness evidence', () => {
  const recorder = createPerformanceRecorder();
  const pipeline = {mode:'worker', target:12, targetCompressedReady:true, targetDecodedReady:false,
    targetDecodePending:true, targetDecodeAgeMs:112, targetDecodedAgeMs:null, newestReadyFrame:10, newestReadyAgeMs:120,
    workerDrawnOutputs:10, workerUndrawnOutputs:4, privateURL:'https://private.example/?secret'};
  let reads = 0;
  const read = () => { reads++; return pipeline; };
  recorder.sample(0, state({desiredFrame:0}), read);
  recorder.sample(500, state({desiredFrame:0}), read);
  recorder.sample(520, state({desiredFrame:20, wantedFrame:12, displayedFrame:10, scrollY:160}), read);
  recorder.sample(600, state({desiredFrame:22, wantedFrame:12, displayedFrame:10, scrollY:176}), read);
  assert.equal(reads, 1, 'Starting/continuing short waits reuses the last snapshot');
  recorder.sample(632, state({desiredFrame:22, wantedFrame:12, displayedFrame:10, scrollY:176}), read);
  let episode = recorder.report().recentJourneyStalls[0];
  assert.equal(reads, 2);
  assert.equal(episode.startTime, 520); assert.equal(episode.detectedAt, 632);
  assert.equal(episode.endTime, null); assert.equal(episode.outcome, 'pending');
  assert.equal(episode.start.wantedFrame, 12); assert.equal(episode.start.pipelineAgeMs, 20);
  assert.equal(episode.detected.pipelineAgeMs, 0); assert.equal(episode.detected.outstandingMovement, true);
  assert.equal(episode.detected.pipeline.targetDecodePending, true);
  assert.equal(episode.detected.pipeline.targetDecodeAgeMs, 112);
  assert.equal(episode.detected.pipeline.targetDecodedReady, false, 'False readiness is evidence, not missing data');
  Object.assign(pipeline, {targetDecodedReady:true, targetDecodePending:false, targetDecodeAgeMs:null, targetDecodedAgeMs:2});
  recorder.sample(648, state({desiredFrame:12, wantedFrame:12, displayedFrame:12, scrollY:96}), read);
  episode = recorder.report().recentJourneyStalls[0];
  assert.equal(reads, 3); assert.equal(episode.durationMs, 128);
  assert.equal(episode.endTime, 648); assert.equal(episode.outcome, 'progress');
  assert.equal(episode.end.outstandingMovement, false); assert.equal(episode.end.pipeline.targetDecodedReady, true);
  assert.equal(episode.end.pipeline.targetDecodeAgeMs, null);
  assert.equal(episode.end.pipeline.targetDecodedAgeMs, 2);
  assert.ok(!JSON.stringify(episode).includes('private'));
  episode.start.pipeline.target = -1; episode.detected.pipeline.targetDecodeAgeMs = -1;
  assert.equal(recorder.report().recentJourneyStalls[0].start.pipeline.target, 12);
  assert.equal(recorder.report().recentJourneyStalls[0].detected.pipeline.targetDecodeAgeMs, 112);
  recorder.sample(1100, state({desiredFrame:12, displayedFrame:12, scrollY:96}), read);
  assert.equal(recorder.report().current.stalls, 1, 'The settled activity tail must not add a second stall');
});

test('pending movement survives deliberate slow pacing and closes cleanly on reversal or suspension', () => {
  const recorder = createPerformanceRecorder();
  const read = () => ({bufferPacingScale:.75, bufferPacingLimited:true});
  recorder.sample(0, state({desiredFrame:100, displayedFrame:50, wantedFrame:51}), read);
  recorder.sample(120, state({desiredFrame:100, displayedFrame:50, wantedFrame:51}), read);
  recorder.sample(150, state({desiredFrame:0, displayedFrame:50, wantedFrame:49}), read);
  recorder.sample(270, state({desiredFrame:0, displayedFrame:50, wantedFrame:49}), read);
  recorder.suspend();
  let episodes = recorder.report().recentJourneyStalls;
  assert.deepEqual(episodes.map(row => [row.startTime, row.endTime, row.outcome]), [[0,150,'reversal'], [150,270,'suspended']]);
  assert.equal(episodes[1].start.direction, -1); assert.equal(episodes[1].detected.pipeline.bufferPacingScale, .75);
  recorder.sample(100000, state({desiredFrame:0, displayedFrame:50}), read);
  recorder.sample(100080, state({desiredFrame:0, displayedFrame:0}), read);
  recorder.sample(100500, state({desiredFrame:0, displayedFrame:0}), read);
  episodes = recorder.report().recentJourneyStalls;
  assert.equal(episodes.length, 2, 'Hidden time and the fresh short recovery are not part of an earlier wait');
  assert.equal(recorder.report().current.stalls, 2);
  assert.ok(episodes.every(row => row.durationMs <= 150));
});

test('stall episodes are bounded, distinguish cancelled demand and keep missing evidence unavailable', () => {
  const recorder = createPerformanceRecorder();
  for (let i = 0; i < 25; i++) {
    const at = i * 300;
    recorder.sample(at, state());
    recorder.sample(at + 110, state());
    recorder.sample(at + 120, state({desiredFrame:0}));
  }
  const episodes = recorder.report().recentJourneyStalls;
  assert.equal(episodes.length, 20);
  assert.equal(episodes[0].startTime, 1500);
  assert.ok(episodes.every(row => row.outcome === 'settled' && row.durationMs === 120));
  assert.equal(episodes[0].start.pipeline, null);
  assert.equal(episodes[0].start.pipelineAgeMs, null);
  assert.equal(episodes[0].start.wantedFrame, null);
  assert.equal(episodes[0].end.outstandingMovement, false);
});

// Exercise the actual panel without a browser: stats can be sampled while the
// details are closed, but neither formatting-only properties nor the <pre>
// should be touched until the user opens it.
test('collapsed debug keeps recording without formatting or writing text and refreshes on open', async () => {
  const original = new Map();
  const install = (key, value) => { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {value, writable:true, configurable:true}); };
  const elements = [], pending = new Map(); let id = 0, copied, statsReads = 0, formattingReads = 0;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attributes = {}; this.listeners = {}; this.textWrites = 0; elements.push(this); }
    set textContent(value) { this.text = value; this.textWrites++; }
    get textContent() { return this.text; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...values) { this.children.push(...values); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { return this.listeners.click?.(); }
    focus() {}
    remove() {}
  }
  const body = new Element('body'); body.dataset = {};
  let dispose;
  try {
    install('location', {search:'?perf=1'});
    install('document', {body, hidden:false, createElement:tag => new Element(tag), querySelector:() => null, addEventListener() {}});
    install('window', {addEventListener() {}});
    install('navigator', {userAgent:'test', clipboard:{writeText:async value => { copied = value; }}});
    install('scrollY', 0); install('innerWidth', 800); install('innerHeight', 600); install('devicePixelRatio', 1);
    install('requestAnimationFrame', callback => { pending.set(++id, callback); return id; });
    install('cancelAnimationFrame', handle => pending.delete(handle));
    const stats = {fps:60, mode:'worker', renderer:'worker-webcodecs', decoded:4, pending:0, compressedBytes:1000,
      get settings() { formattingReads++; return {decoded:4}; }};
    const sequence = {phase:'journey', desiredFrame:0, displayedFrame:0, wantedFrame:0, frameCount:100,
      get stats() { statsReads++; return stats; }};
    dispose = createPerformanceOverlay(sequence, {domElement:{width:800, height:600}, info:{render:{frame:0}}});
    const output = elements.find(element => element.tag === 'pre');
    const toggle = elements.find(element => element.attributes['aria-controls'] === 'scroll-debug-content');
    const tick = time => { const [handle, callback] = pending.entries().next().value; pending.delete(handle); callback(time); };
    tick(0); tick(250); tick(500);
    assert.equal(statsReads, 2, 'Initial fps plus one half-second pipeline snapshot');
    assert.equal(formattingReads, 0); assert.equal(output.textWrites, 1);
    sequence.desiredFrame = 10; sequence.displayedFrame = 7; sequence.wantedFrame = 8;
    toggle.click();
    assert.equal(output.textWrites, 2); assert.equal(formattingReads, 1);
    assert.match(output.textContent, /Frame 7 → 10/, 'Opening reads the current frame immediately, without waiting for a sample');
    toggle.click();
    tick(750); tick(1000);
    assert.equal(formattingReads, 1); assert.equal(output.textWrites, 2);
    await elements.find(element => element.textContent === 'Copy report').click();
    const report = JSON.parse(copied);
    assert.equal(report.recentSamples.length, 2);
    assert.equal(report.sequence.wantedFrame, 8);
    assert.equal(report.current.stalls, 1, 'Closing the details keeps true wait recording active');
    dispose(); dispose = undefined;
  } finally {
    dispose?.();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('an 80ms outstanding wait cannot become a stall during hidden or paused time', () => {
  const recorder = createPerformanceRecorder();
  recorder.sample(0, state());
  recorder.sample(80, state());
  recorder.suspend();
  recorder.sample(1080, state());
  recorder.sample(1160, state({displayedFrame:100}));
  recorder.suspend();
  recorder.sample(5000, state({desiredFrame:200, displayedFrame:100}));
  recorder.sample(5080, state({desiredFrame:200, displayedFrame:200}));
  recorder.sample(5500, state({desiredFrame:200, displayedFrame:200}));
  const report = recorder.report();
  assert.equal(report.current.stalls, 0);
  assert.deepEqual(report.recentJourneyStalls, []);
  assert.equal(report.current.worstJourneyGapMs, 80, 'Only observed pending intervals affect the gap maximum after each fresh baseline');
});
