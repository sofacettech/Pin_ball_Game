export function prepareInlineVideo(video) {
  video.defaultMuted = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
}

export function waitForVideo(video, {readyState = 1, signal, timeout = 15000, pollOnPaint = false, pollInterval = 0, presentedFrame = false, pauseOnFrame = false, onPresentedFrame, frame, fps = 60} = {}) {
  return new Promise((resolve, reject) => {
    const events = new AbortController();
    const waitForFrame = presentedFrame && typeof video.requestVideoFrameCallback === 'function';
    const observed = [];
    let timer, animation, readinessTimer, frameCallback, presentedTime, settled = false;
    function done(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(readinessTimer);
      if (animation !== undefined) cancelAnimationFrame(animation);
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      events.abort();
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(presentedTime);
    }
    const abort = () => done(signal?.reason instanceof Error || signal?.reason instanceof DOMException ? signal.reason : new DOMException('Video loading cancelled', 'AbortError'));
    function check() {
      if (video.error) {
        const error = new Error('The video could not load');
        error.name = video.error.code === 4 ? 'NotSupportedError' : video.error.code === 3 ? 'EncodingError' : 'NetworkError';
        done(error);
      }
      else if (video.readyState >= readyState && !video.seeking && (!waitForFrame || Number.isFinite(presentedTime))) done();
    }
    function checkFrame(_now, metadata) {
      frameCallback = undefined;
      observed.push(metadata.mediaTime);if (observed.length > 5) observed.shift();
      if (!video.seeking && video.readyState >= readyState && (frame === undefined || Math.round(metadata.mediaTime * fps) === frame)) {
        presentedTime = metadata.mediaTime;
        try {
          if (pauseOnFrame) video.pause();
          onPresentedFrame?.();
        } catch (error) { done(error); return; }
      }
      check();
      if (!settled) frameCallback = video.requestVideoFrameCallback(checkFrame);
    }
    function checkPaint() {
      animation = undefined;
      check();
      if (!settled) animation = requestAnimationFrame(checkPaint);
    }
    function checkReadiness() {
      readinessTimer = undefined;
      check();
      if (!settled) readinessTimer = setTimeout(checkReadiness, pollInterval);
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'progress', 'error']) {
      video.addEventListener(event, check, {signal: events.signal});
    }
    timer = setTimeout(() => done(new Error('The video is still loading' + (waitForFrame ? ` (frame ${frame ?? 'next'}, observed ${JSON.stringify(observed)}, currentTime ${video.currentTime})` : ''))), timeout);
    if (waitForFrame) frameCallback = video.requestVideoFrameCallback(checkFrame);
    check();
    // WebKit can finish a seek before dispatching its queued media event.
    // Keep the same readiness requirements, but release the next seek promptly.
    if (!settled && pollOnPaint && typeof requestAnimationFrame === 'function') animation = requestAnimationFrame(checkPaint);
    // Pending native seeks can become ready between paints as well. Only the
    // journey opts in; settlement or cancellation stops both readiness watches.
    if (!settled && pollInterval > 0) readinessTimer = setTimeout(checkReadiness, pollInterval);
  });
}

// The existing opening owns its timing; autoplay attributes would bypass the logo reveal.
export function connectOpeningVideo(video, button, onEnded, requestFrame, {skipOnBlocked = false} = {}) {
  prepareInlineVideo(video);
  const events = new AbortController();
  const label = button.innerHTML;
  let started = false, finished = false, destroyed = false, suspended = false;
  let resume = false, blocked = false, attempt = 0, timer;
  function clearWatch() { clearTimeout(timer); timer = undefined; }
  function prompt() {
    if (!started || finished || destroyed || suspended) return;
    // The 3D landing can continue without this optional clip, including when
    // iOS Low Power Mode refuses muted autoplay. Never gate its scroll on a tap.
    if (skipOnBlocked) { complete(); return; }
    blocked = true;
    button.textContent = video.error?.code === 4 ? 'Continue experience ↗' : 'Tap to play experience ↗';
    button.hidden = false;
  }
  function watch() {
    clearWatch();
    timer = setTimeout(() => { timer = undefined; prompt(); }, 10000);
  }
  function complete() {
    if (finished || destroyed) return;
    finished = true; attempt++; clearWatch();
    button.hidden = true;
    if (skipOnBlocked) video.pause();
    onEnded();
  }
  async function play(user = false) {
    if (finished || destroyed) return;
    started = true;
    if (document.hidden || suspended) { suspended = true; resume = true; return; }
    if (user && video.error?.code === 4) { complete(); return; }
    if (user && video.error) video.load();
    prepareInlineVideo(video);
    const current = ++attempt;
    blocked = false; button.hidden = true; watch();
    // Call play synchronously in the click handler to preserve Safari's user activation.
    try {
      await video.play();
      if (current !== attempt || destroyed || suspended) return;
      clearWatch(); requestFrame();
    } catch {
      if (current === attempt) { clearWatch(); prompt(); }
    }
  }
  button.addEventListener('click', () => { void play(true); }, {signal: events.signal});
  video.addEventListener('playing', () => {
    if (!started || finished || destroyed || suspended) return;
    clearWatch(); blocked = false; button.hidden = true; requestFrame();
  }, {signal: events.signal});
  for (const event of ['waiting', 'stalled']) video.addEventListener(event, () => {
    if (started && !finished && !suspended && !blocked && !timer) watch();
  }, {signal: events.signal});
  video.addEventListener('pause', () => {
    if (document.hidden) { suspend(); return; }
    if (!video.ended) { clearWatch(); prompt(); }
  }, {signal: events.signal});
  video.addEventListener('error', () => { clearWatch(); prompt(); }, {signal: events.signal});
  video.addEventListener('ended', complete, {signal: events.signal});
  function suspend() {
    if (suspended || destroyed) return;
    resume = started && !finished && !blocked;
    suspended = true; attempt++; clearWatch();
    video.pause();
  }
  function restore() {
    if (!suspended || destroyed || document.hidden) return;
    suspended = false;
    if (video.ended) complete();
    else if (resume) { resume = false; void play(); }
    else if (blocked) prompt();
  }
  document.addEventListener('visibilitychange', () => document.hidden ? suspend() : restore(), {signal: events.signal});
  window.addEventListener('pagehide', suspend, {signal: events.signal});
  window.addEventListener('pageshow', event => { if (event.persisted) restore(); }, {signal: events.signal});
  return {
    start(manual = false) {
      if (manual && skipOnBlocked) complete();
      else if (manual) { started = true; blocked = true; button.hidden = false; }
      else void play();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; attempt++; clearWatch(); events.abort(); video.pause();
      button.innerHTML = label;
    },
  };
}
