const VERSION = 'scroll-debug-6';
const boundedPush = (values, value, limit) => { values.push(value); if (values.length > limit) values.shift(); };
const round = value => Math.round(value * 10) / 10;
const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)] || 0;

// Capture scalar evidence every 500ms and at meaningful stall boundaries.
// Source stats contain URLs and larger objects that do not belong in samples.
const pipelineNumbers = ['target', 'direction', 'decoded', 'decodedBytes', 'compressed', 'compressedBytes',
  'network', 'networkRequests', 'networkFrames', 'networkBytes', 'diskHits', 'decoding', 'pending', 'queued',
  'decodeMs', 'workerRequests', 'workerCompleted', 'workerTimeouts', 'workerDecodeTotalMs',
  'workerBitmapCopies', 'workerBitmapCopyMs', 'workerBitmapCopyMaxMs', 'canvasDrawCount', 'canvasDrawMs',
  'canvasDrawMaxMs', 'fallbacks', 'bufferAheadFrames', 'bufferAheadSeconds', 'bufferRequiredFrames',
  'bufferPacingScale', 'bufferPacingSpeed', 'targetDecodeAgeMs', 'targetDecodedAgeMs', 'newestReadyFrame', 'newestReadyAgeMs',
  'workerDrawnOutputs', 'workerUndrawnOutputs'];
const pipelineSnapshot = (stats = {}) => ({
  ...Object.fromEntries(['mode', 'renderer', 'requestedRenderer'].map(key => [key, typeof stats[key] === 'string' ? stats[key].slice(0, 64) : null])),
  ...Object.fromEntries(pipelineNumbers.map(key => [key, Number.isFinite(stats[key]) ? stats[key] : null])),
  ...Object.fromEntries(['bufferPacingLimited', 'targetCompressedReady', 'targetDecodedReady', 'targetDecodePending']
    .map(key => [key, typeof stats[key] === 'boolean' ? stats[key] : null])),
});
const copySample = sample => ({...sample, ...(sample.pipeline ? {pipeline: {...sample.pipeline}} : {})});

export function bufferPacingSummary(stats = {}) {
  if (!Number.isFinite(stats.bufferPacingScale)) return null;
  const ahead = Number.isFinite(stats.bufferAheadFrames) ? stats.bufferAheadFrames : '?';
  const required = Number.isFinite(stats.bufferRequiredFrames) ? stats.bufferRequiredFrames : '?';
  return `Buffer pace ${stats.bufferPacingScale.toFixed(2)}× · ahead ${ahead}/${required}f`;
}

// Some phone browsers expose this API but never populate either counter.
export function playbackQualitySummary(quality, baseline) {
  const supported = Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames);
  const total = supported ? Math.max(0, quality.totalVideoFrames - (baseline?.totalVideoFrames || 0)) : null;
  return {
    browserCounterStatus: !supported ? 'unavailable' : total > 0 ? 'available' : 'no-frames',
    browserDroppedFrames: supported ? Math.max(0, quality.droppedVideoFrames - (baseline?.droppedVideoFrames || 0)) : null,
    browserTotalFrames: total,
  };
}

const scriptURL = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? (url.origin + url.pathname).slice(0, 512) : null;
  } catch { return null; }
};

// Observers run only for opted-in captures. They do not sample on every paint.
export function createPagePauseObserver({Observer = globalThis.PerformanceObserver, now = () => performance.now()} = {}) {
  const types = ['longtask', 'long-animation-frame'], observers = new Map(), recentEntries = [];
  const totals = Object.fromEntries(types.map(type => [type, {
    status: Observer?.supportedEntryTypes?.includes(type) ? 'supported' : 'unsupported', count: 0, worstDurationMs: 0,
  }]));
  let running = false, destroyed = false, startedAt = 0;
  function collect(type, entries) {
    if (!running) return;
    for (const entry of entries) {
      if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration) || entry.startTime < startedAt) continue;
      const scripts = [...(entry.scripts || [])].sort((a, b) => b.duration - a.duration).slice(0, 5).map(script => ({
        startTime: round(script.startTime), duration: round(script.duration), sourceURL: scriptURL(script.sourceURL),
      }));
      const record = {type, startTime: round(entry.startTime), duration: round(entry.duration)};
      if (type === 'long-animation-frame') {
        record.blockingDuration = Number.isFinite(entry.blockingDuration) ? round(entry.blockingDuration) : null;
        record.scripts = scripts;
      }
      totals[type].count++;
      totals[type].worstDurationMs = Math.max(totals[type].worstDurationMs, record.duration);
      boundedPush(recentEntries, record, 20);
    }
  }
  function flush() { if (running) for (const [type, observer] of observers) collect(type, observer.takeRecords()); }
  function stop() {
    flush(); running = false;
    for (const observer of observers.values()) observer.disconnect();
  }
  function start() {
    if (destroyed || running) return;
    running = true; startedAt = now();
    for (const type of types) {
      if (totals[type].status !== 'supported') continue;
      let observer = observers.get(type);
      try {
        observer ??= new Observer(list => collect(type, list.getEntries()));
        observers.set(type, observer);
        observer.observe({type, buffered: false});
      } catch {
        observer?.disconnect(); observers.delete(type); totals[type].status = 'unavailable';
      }
    }
  }
  return {
    start, stop,
    reset() {
      const resume = running; stop(); recentEntries.length = 0;
      for (const total of Object.values(totals)) { total.count = 0; total.worstDurationMs = 0; }
      if (resume) start();
    },
    report() {
      flush();
      return {
        apis: Object.fromEntries(types.map(type => [type, {...totals[type],
          count: totals[type].status === 'supported' ? totals[type].count : null,
          worstDurationMs: totals[type].status === 'supported' ? totals[type].worstDurationMs : null,
        }])),
        recentEntries: recentEntries.map(entry => ({...entry, ...(entry.scripts ? {scripts: entry.scripts.map(script => ({...script}))} : {})})),
      };
    },
    destroy() { stop(); destroyed = true; },
  };
}

// A four-frame jump is one update. Idle and hidden time are not stalls.
export function createPerformanceRecorder() {
  let previous, lastScroll = -Infinity, active = false, progressAt;
  let waiting, episode, latestPipeline, latestPipelineAt;
  let windowAt, pageTicks = 0, updates = 0, activeMs = 0, nativeUpdates = 0;
  let worstPageGapMs = 0, worstJourneyGapMs = 0, worstLagFrames = 0, stalls = 0, totalUpdates = 0;
  let nativeMediaTime = null, nativeFrameIdentity;
  let callbackSupported = null, callbackCount = 0, compositionCounterSeen = false;
  let compositionAdvances = 0, unobservedCompositionFrames = 0, worstCallbackGapMs = 0;
  let lastCallbackAt, lastCompositionCount;
  const recentCallbacks = [];
  const pageGaps = [], journeyGaps = [], history = [], recentPagePauses = [], recentJourneyStalls = [];
  const copyEvidence = evidence => evidence ? {...evidence, pipeline: evidence.pipeline ? {...evidence.pipeline} : null} : null;
  const copyEpisode = value => ({...value, start: copyEvidence(value.start), detected: copyEvidence(value.detected), end: copyEvidence(value.end)});
  function evidence(now, state) {
    return {atMs: round(now), desiredFrame: state.desiredFrame, displayedFrame: state.displayedFrame,
      wantedFrame: Number.isFinite(state.wantedFrame) ? state.wantedFrame : null,
      direction: Math.sign(state.desiredFrame - state.displayedFrame),
      outstandingMovement: ['idle', 'journey'].includes(state.phase) && !state.game && state.desiredFrame !== state.displayedFrame,
      lastScrollAtMs: Number.isFinite(lastScroll) ? round(lastScroll) : null,
      pipelineSampledAtMs: latestPipelineAt === undefined ? null : round(latestPipelineAt),
      pipelineAgeMs: latestPipelineAt === undefined ? null : round(Math.max(0, now - latestPipelineAt)),
      pipeline: latestPipeline || null};
  }
  function closeEpisode(now, state, outcome) {
    if (episode) {
      episode.endTime = round(now); episode.durationMs = round(now - waiting.startTime);
      episode.end = evidence(now, state); episode.outcome = outcome;
    }
    waiting = episode = undefined;
  }
  let current = {pageFps: null, journeyUpdatesPerSecond: null, nativeUpdatesPerSecond: null};
  return {
    sample(now, state, readPipeline) {
      if (typeof state.videoCallbacks === 'boolean') callbackSupported = state.videoCallbacks;
      windowAt ??= now;
      const elapsed = previous ? now - previous.now : 0;
      if (previous && state.scrollY !== previous.scrollY) lastScroll = now;
      const eligible = ['idle', 'journey'].includes(state.phase) && !state.game;
      const outstanding = eligible && state.desiredFrame !== state.displayedFrame;
      const nextActive = eligible && (outstanding || now - lastScroll < 180);
      const direction = Math.sign(state.desiredFrame - state.displayedFrame);
      const changed = previous && state.displayedFrame !== previous.displayedFrame;
      const readCurrentPipeline = () => {
        if (readPipeline && latestPipelineAt !== now) {
          latestPipeline = pipelineSnapshot(readPipeline()); latestPipelineAt = now;
        }
        return latestPipeline;
      };
      if (waiting) {
        const waitMs = now - waiting.startTime;
        if (waitMs >= 100 && !episode) {
          readCurrentPipeline(); stalls++;
          episode = {startTime: round(waiting.startTime), detectedAt: round(now), endTime: null,
            durationMs: round(waitMs), outcome: 'pending', start: waiting.start, detected: evidence(now, state), end: null};
          boundedPush(recentJourneyStalls, episode, 20);
        }
        if (episode) episode.durationMs = round(waitMs);
        const outcome = changed ? 'progress' : !eligible ? 'inactive' : !outstanding ? 'settled'
          : direction !== waiting.direction ? 'reversal' : null;
        if (outcome) { if (episode) readCurrentPipeline(); closeEpisode(now, state, outcome); }
      }
      if (outstanding && !waiting) waiting = {startTime: now, direction, start: evidence(now, state)};
      if (elapsed > 0) {
        pageTicks++; boundedPush(pageGaps, elapsed, 600);
        worstPageGapMs = Math.max(worstPageGapMs, elapsed);
        if (elapsed >= 100) boundedPush(recentPagePauses, {
          startTime: round(previous.now), duration: round(elapsed),
          phaseBefore: previous.phase, phaseAfter: state.phase, gameBefore: !!previous.game, gameAfter: !!state.game,
        }, 20);
      }
      if (nextActive && !active) progressAt = now;
      if (active && elapsed > 0) {
        activeMs += elapsed;
        const gap = now - progressAt;
        worstJourneyGapMs = Math.max(worstJourneyGapMs, gap);
        if (state.displayedFrame !== previous.displayedFrame) {
          updates++; totalUpdates++; boundedPush(journeyGaps, gap, 600);
          progressAt = now;
        }
      }
      active = nextActive;
      if (eligible) worstLagFrames = Math.max(worstLagFrames, Math.abs(state.desiredFrame - state.displayedFrame));
      previous = {...state, now};
      const duration = now - windowAt;
      if (duration < 500) return null;
      current = {
        pageFps: round(pageTicks * 1000 / duration),
        journeyUpdatesPerSecond: activeMs > 0 ? round(updates * 1000 / activeMs) : null,
        nativeUpdatesPerSecond: state.native && activeMs > 0 && state.videoCallbacks ? round(nativeUpdates * 1000 / activeMs) : null,
        active, ...state, nativeMediaTime,
        pageP95GapMs: round(p95(pageGaps)), journeyP95GapMs: round(p95(journeyGaps)),
        worstPageGapMs: round(worstPageGapMs), worstJourneyGapMs: round(worstJourneyGapMs),
        worstLagFrames, lagFrames: Math.abs(state.desiredFrame - state.displayedFrame),
        lagSeconds: state.fps > 0 ? round(Math.abs(state.desiredFrame - state.displayedFrame) / state.fps) : null,
        worstLagSeconds: state.fps > 0 ? round(worstLagFrames / state.fps) : null,
        stalls, totalUpdates, sampledAtMs: round(now),
        ...(readPipeline ? {pipeline: {...readCurrentPipeline()}} : {}),
      };
      boundedPush(history, {atMs: round(now), ...current}, 120);
      windowAt = now; pageTicks = updates = activeMs = nativeUpdates = 0;
      return current;
    },
    presented(mediaTime, now, metadata = {}) {
      callbackSupported = true; callbackCount++;
      const atMs = Number.isFinite(now) ? now : null;
      const gapMs = atMs !== null && lastCallbackAt !== undefined ? Math.max(0, atMs - lastCallbackAt) : null;
      const compositionCount = Number.isSafeInteger(metadata.presentedFrames) && metadata.presentedFrames >= 0 ? metadata.presentedFrames : null;
      const compositionDelta = compositionCount !== null && lastCompositionCount !== undefined && compositionCount >= lastCompositionCount
        ? compositionCount - lastCompositionCount : null;
      if (compositionCount !== null) compositionCounterSeen = true;
      if (compositionDelta !== null) {
        compositionAdvances += compositionDelta;
        unobservedCompositionFrames += Math.max(0, compositionDelta - 1);
      }
      if (gapMs !== null) worstCallbackGapMs = Math.max(worstCallbackGapMs, gapMs);
      boundedPush(recentCallbacks, {atMs: atMs === null ? null : round(atMs), mediaTime: Number.isFinite(mediaTime) ? mediaTime : null,
        presentedFrames: compositionCount, compositionDelta, gapMs: gapMs === null ? null : round(gapMs), active}, 20);
      lastCallbackAt = atMs ?? undefined; lastCompositionCount = compositionCount ?? undefined;
      if (!Number.isFinite(mediaTime)) return;
      const identity = previous?.fps > 0 ? Math.round(mediaTime * previous.fps) : mediaTime;
      if (active && identity !== nativeFrameIdentity) nativeUpdates++;
      nativeFrameIdentity = identity; nativeMediaTime = mediaTime;
    },
    suspend() {
      if (previous) closeEpisode(previous.now, previous, 'suspended');
      waiting = episode = undefined;
      previous = undefined; windowAt = undefined; lastScroll = -Infinity; active = false;
      pageTicks = updates = activeMs = nativeUpdates = 0;
      lastCallbackAt = lastCompositionCount = undefined;
    },
    report() { return {
      current: copySample(current), recentSamples: history.map(copySample), recentPagePauses: recentPagePauses.map(pause => ({...pause})),
      recentJourneyStalls: recentJourneyStalls.map(copyEpisode),
      nativeCallbacks: {supported: callbackSupported, callbackCount: callbackSupported === true ? callbackCount : null,
        compositionCounterStatus: compositionCounterSeen ? 'available' : callbackCount ? 'unavailable' : 'not-observed',
        observedCompositionAdvances: compositionCounterSeen ? compositionAdvances : null,
        unobservedCompositionFrames: compositionCounterSeen ? unobservedCompositionFrames : null,
        worstCallbackGapMs: callbackCount ? round(worstCallbackGapMs) : null,
        recentCallbacks: recentCallbacks.map(callback => ({...callback})),
        notes: 'Raw callbacks and composition-submission advances are separate from distinct native FPS. A presentedFrames delta above one indicates submissions without an individual observed callback, not proof of unique visible frames. Counts persist until Reset; first callbacks after Pause or hidden time establish fresh timestamp/counter baselines. Callback gaps can include visible idle time; active marks journey motion at callback delivery.',
      },
    }; },
  };
}

export function createPerformanceOverlay(sequence, renderer) {
  if (!new URLSearchParams(location.search).has('perf')) return () => {};
  const panel = document.createElement('section');
  panel.id = 'scroll-debug'; panel.setAttribute('aria-label', 'Scroll performance debug');
  panel.style.cssText = 'position:fixed;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:10000;width:min(340px,calc(100vw - 20px));display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:12px/1.5 ui-monospace,monospace;text-align:left;color:#fff;pointer-events:none';
  const content = document.createElement('div');
  content.id = 'scroll-debug-content'; content.hidden = true;
  content.style.cssText = 'width:100%;max-height:55svh;overflow:auto;box-sizing:border-box;padding:12px;background:#10131ff2;border:1px solid #b9f73c;border-radius:10px;pointer-events:auto;overscroll-behavior:contain';
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.setAttribute('aria-controls', content.id);
  toggle.style.cssText = 'min-height:40px;padding:7px 12px;background:#10131ff2;color:#b9f73c;border:1px solid #b9f73c;border-radius:8px;font:inherit;touch-action:manipulation;pointer-events:auto';
  let expanded = false;
  function updateToggle() {
    toggle.textContent = expanded ? 'Close debug' : `Debug · ${paused ? 'paused' : 'recording'}`;
    toggle.setAttribute('aria-label', expanded ? 'Close debug' : 'Open debug');
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  function setExpanded(value) {
    expanded = value; content.hidden = !value; updateToggle();
    if (value) {
      const frozen = paused && latestReport;
      renderPanel(frozen ? frozen.current : recorder.report().current, frozen ? frozen.sequence : readState(), frozen ? frozen.sequence.stats : sequence.stats);
    }
  }
  const title = document.createElement('strong'); title.textContent = 'SCROLL DEBUG · LIVE';
  const output = document.createElement('pre');
  output.style.cssText = 'margin:6px 0;white-space:pre-wrap;font:inherit;color:inherit';
  output.textContent = 'Measuring… Scroll to capture a stall.';
  const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  const message = document.createElement('div'); message.setAttribute('role', 'status');
  message.style.cssText = 'margin-top:6px;font-size:11px;color:#ccd1de';
  message.textContent = 'Page FPS ≠ journey updates. Stalls = ≥100ms waiting for requested movement. Reset after the intro.';
  content.append(title, output, controls, message); panel.append(content, toggle); document.body.append(panel);
  const events = new AbortController(), video = document.querySelector('#journey'), frame = document.querySelector('#journey-frame');
  let recorder = createPerformanceRecorder(), request = 0, videoRequest = 0, paused = false, destroyed = false;
  const pagePauseObserver = createPagePauseObserver();
  let started = new Date().toISOString(), latestReport;
  const sourceFps = sequence.stats.fps;
  toggle.addEventListener('click', () => setExpanded(!expanded), {signal: events.signal});
  updateToggle();
  let baselineQuality = video?.getVideoPlaybackQuality?.();
  const build = new URL(import.meta.url).searchParams.get('v') || VERSION;
  function readState() {
    return {phase: sequence.phase, desiredFrame: sequence.desiredFrame, displayedFrame: sequence.displayedFrame,
      wantedFrame: Number.isFinite(sequence.wantedFrame) ? sequence.wantedFrame : null,
      fps: sourceFps, scrollY, game: document.body.dataset.game === 'visible',
      native: video?.classList.contains('native-renderer') === true && frame?.hidden === true,
      videoCallbacks: typeof video?.requestVideoFrameCallback === 'function'};
  }
  function report() {
    const quality = video?.getVideoPlaybackQuality?.();
    const stats = sequence.stats, state = readState();
    return {
      version: VERSION, build, started, capturedAt: new Date().toISOString(), paused,
      device: {userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
        cores: navigator.hardwareConcurrency ?? null, memoryGiB: navigator.deviceMemory ?? null,
        connection: navigator.connection ? {type: navigator.connection.effectiveType, downlinkMbps: navigator.connection.downlink, saveData: navigator.connection.saveData} : null},
      ...recorder.report(), sequence: {frameCount: sequence.frameCount, ...state, stats},
      mainThread: pagePauseObserver.report(),
      nativeVideo: {readyState: video?.readyState, seeking: video?.seeking, currentTime: video?.currentTime,
        averageSeekMs: stats.nativeSeeks > 0 ? round(stats.nativeSeekMs / stats.nativeSeeks) : null,
        ...playbackQualitySummary(quality, baselineQuality)},
      graphics: {buffer: [renderer.domElement.width, renderer.domElement.height], draws: renderer.info.render.frame},
      notes: 'Page FPS measures requestAnimationFrame callbacks. Journey updates count selected-frame changes, not skipped source frames. Lag seconds is source-video distance from the scroll target, not elapsed catch-up time. Native updates count distinct source frames reported by compositor callbacks; repeated callbacks for the same frame do not increase the rate. Browser drop counters may omit seek stalls; no-frames means they have supplied no frame evidence since Reset. Native video downloads are not included in JavaScript network counters. nativeSeekTiming accumulates successful completed seeks since page load: forward/backward movement is separate from settled confirmation; totalMs/count gives the average, maxMs the worst, and overBudget counts durations above 33.33ms. Failed/cancelled seeks are excluded and Reset does not clear source totals. bufferedAheadSeconds measures native data ahead of the playhead; bufferedSeconds measures the range starting at zero. latencyMs is the last completed cache presentation timing, not current scroll lag. Rates are sampled every 500ms; sequence and nativeVideo are refreshed when exported. P95 covers the latest 600 gaps; worst values persist until Reset. Update-gap metrics retain the 180ms scroll activity grace and can include settled gesture pauses; stall counts require outstanding desired-frame movement. recentJourneyStalls retains the latest 20 no-progress episodes of at least 100ms, with observed start/detection/end states. An episode ends on progress, cancellation/settling, reversal, inactivity or suspension. Start pipeline evidence is the latest available snapshot with its age; detection/end snapshots are refreshed when supported. A pending episode has no endTime. Timing is observation-based, not proof of physical display. Samples are bounded to 120. Regular pipeline snapshots are read at the same 500ms boundary, with additional snapshots at stall detection/recovery: network/decoding/pending/queued and decoded/compressed counts describe current work and cache occupancy, while networkBytes/networkFrames/networkRequests/diskHits and worker/decode/copy/draw totals accumulate since page load and are not cleared by Reset. Compare adjacent pipeline snapshots to identify progress; a final idle queue does not describe earlier stalls. Missing pipeline metrics are null, not zero; no media URLs are retained in pipeline history. bufferAheadFrames counts contiguous available frames in the current travel direction, and bufferAheadSeconds expresses that distance in source-video seconds. bufferRequiredFrames is the recovery watermark. bufferPacingScale is the configured pacing fraction from 0 to 1, bufferPacingLimited marks intentional buffer pacing, and bufferPacingSpeed is the configured source-frames-per-second cap, not measured display FPS. These fields do not change recorded update rates, gaps or stalls. Page pauses retain the latest 20 visible paint gaps of at least 100ms with phase/game state before and after. Main-thread observers retain the latest 20 browser-reported long tasks/animation frames; unsupported APIs report null counts, not zero stalls. Observer startTime and page-pause startTime use the same performance clock. Script attribution is browser-limited, includes at most 5 scripts per frame, and removes URL credentials, queries and fragments. Hidden and paused time is excluded from page/observer measurements. Worker renderer counters describe transferred decoded frames, not compositor presentation. canvasDrawCount and canvasDrawMs measure successful canvas draw submissions and CPU submission time; canvasPresentedFrame is the source index of the last submission, not independent proof of display. Worker decode timing includes message transfer and decoder waiting. Optional workerFrameTimings stage summaries report lifetime count/mean/max and p95 over the latest 120 samples per stage; these debug-only summaries are not physical display FPS. receiptToDraw and requestToDraw end at the first canvas draw submission and include deliberate lookahead/history residence; they do not measure main-thread work or GPU completion. workerUndrawnOutputs includes current lookahead and discarded outputs, not a measure of waste. Decoded memory is an RGBA-equivalent estimate and excludes browser decoder/GPU allocations. requestedRenderer records the selected experiment and workerFailure explains a fallback. No report is uploaded automatically.',
    };
  }
  function button(label, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
    element.style.cssText = 'min-height:36px;padding:5px 9px;border:1px solid #7d879a;border-radius:5px;background:#242b3b;color:#fff;font:inherit;touch-action:manipulation';
    element.addEventListener('click', action, {signal: events.signal}); controls.append(element); return element;
  }
  const fallback = document.createElement('textarea');
  fallback.hidden = true; fallback.readOnly = true; fallback.setAttribute('aria-label', 'Performance report to copy');
  fallback.style.cssText = 'box-sizing:border-box;width:100%;height:100px;margin-top:8px;font:11px monospace'; content.append(fallback);
  button('Copy report', async () => {
    const text = JSON.stringify(paused && latestReport ? latestReport : report(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      fallback.hidden = true; message.textContent = 'Report copied. Paste it into this chat.';
    } catch {
      fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select();
      message.textContent = 'Select and copy the report below, or use Save report.';
    }
  });
  button('Save report', () => {
    const blob = new Blob([JSON.stringify(paused && latestReport ? latestReport : report(), null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'sofacet-scroll-debug.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = 'Report saved. Attach the JSON file to this chat.';
  });
  const pause = button('Pause', () => {
    paused = !paused; title.textContent = `SCROLL DEBUG · ${paused ? 'PAUSED' : 'LIVE'}`;
    pause.textContent = paused ? 'Resume' : 'Pause';
    updateToggle();
    if (paused) { latestReport = report(); stop(); } else { recorder.suspend(); start(); }
  });
  button('Reset', () => {
    recorder = createPerformanceRecorder(); pagePauseObserver.reset(); started = new Date().toISOString(); baselineQuality = video?.getVideoPlaybackQuality?.();
    latestReport = undefined; fallback.hidden = true;
    output.textContent = 'Reset. Scroll to capture a stall.';
    message.textContent = 'Worst values cleared. Scroll, then Pause for a screenshot or Copy report.';
    if (paused) { paused = false; pause.textContent = 'Pause'; title.textContent = 'SCROLL DEBUG · LIVE'; updateToggle(); start(); }
  });
  button('Close', () => { setExpanded(false); toggle.focus(); });
  function renderPanel(sample, state, s) {
    if (!expanded) return;
    const quality = playbackQualitySummary(video?.getVideoPlaybackQuality?.(), baselineQuality);
    const drops = quality.browserCounterStatus === 'available' ? `${quality.browserDroppedFrames}/${quality.browserTotalFrames}` : `n/a (${quality.browserCounterStatus})`;
    const seekAverage = timing => timing?.count > 0 ? `${round(timing.totalMs / timing.count)}ms` : 'n/a';
    const decode = s.mode === 'video'
      ? s.nativeSeekTiming ? `Seek avg forward ${seekAverage(s.nativeSeekTiming.forward)} / reverse ${seekAverage(s.nativeSeekTiming.backward)}` : `Seek avg ${s.nativeSeeks > 0 ? round(s.nativeSeekMs / s.nativeSeeks) : 'n/a'}ms`
      : `Decode ${round(s.decodeMs || 0)}ms`;
    const buffer = s.mode === 'video' ? `Video buffered ahead ${round(s.bufferedAheadSeconds || 0)}s` : `Buffer ${s.decoded}/${s.settings.decoded} · ${round((s.compressedBytes || 0) / 1048576)}MiB`;
    const bufferPace = bufferPacingSummary(s);
    const lagFrames = Math.abs(state.desiredFrame - state.displayedFrame);
    const lagSeconds = state.fps > 0 ? round(lagFrames / state.fps) : sample.lagSeconds;
    output.textContent = `Page FPS ${sample.pageFps ?? 'measuring'} · ${state.phase}\nJourney ${sample.journeyUpdatesPerSecond ?? 'idle'} updates/s\nNative ${sample.nativeUpdatesPerSecond ?? 'n/a'} frames/s · ${s.renderer}\nFrame ${state.displayedFrame} → ${state.desiredFrame}\nLag ${lagFrames}f (${lagSeconds ?? '?'}s) · worst ${sample.worstLagFrames ?? '—'}f\nGap p95: page ${sample.pageP95GapMs ?? '—'}ms / journey ${sample.journeyP95GapMs ?? '—'}ms\nWorst: page ${sample.worstPageGapMs ?? '—'}ms / journey ${sample.worstJourneyGapMs ?? '—'}ms\nStalls ≥100ms: ${sample.stalls ?? 0}\n${decode} · pending ${s.pending}\n${buffer}${bufferPace ? '\n' + bufferPace : ''}\nBrowser drops ${drops} · ${s.fallbackReason || s.mode}\n${s.nativePlaybackBlocked ? 'Playback blocked: tap the scene to retry' : s.lastError ? s.lastError.name + ': ' + s.lastError.message : 'No frame errors'}\n${VERSION}`;
  }
  function tick(now) {
    if (destroyed || paused || document.hidden) return;
    const state = readState();
    let stats;
    const sample = recorder.sample(now, state, () => (stats = sequence.stats));
    if (sample && expanded) renderPanel(sample, state, stats);
    request = requestAnimationFrame(tick);
  }
  function presented(now, metadata) {
    if (destroyed || paused || document.hidden) return;
    recorder.presented(metadata.mediaTime, now, metadata);
    videoRequest = video.requestVideoFrameCallback(presented);
  }
  function stop() {
    pagePauseObserver.stop();
    cancelAnimationFrame(request); request = 0;
    if (videoRequest) video?.cancelVideoFrameCallback?.(videoRequest); videoRequest = 0;
  }
  function start() {
    if (destroyed || paused || document.hidden) return;
    pagePauseObserver.start();
    if (!request) request = requestAnimationFrame(tick);
    if (!videoRequest && video?.requestVideoFrameCallback) videoRequest = video.requestVideoFrameCallback(presented);
  }
  function destroy() { destroyed = true; stop(); pagePauseObserver.destroy(); events.abort(); panel.remove(); }
  document.addEventListener('visibilitychange', () => { stop(); recorder.suspend(); start(); }, {signal: events.signal});
  window.addEventListener('pagehide', () => { stop(); recorder.suspend(); }, {signal: events.signal});
  window.addEventListener('pageshow', start, {signal: events.signal});
  start();
  return Object.assign(() => {}, {destroy});
}
