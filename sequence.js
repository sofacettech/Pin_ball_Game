import { siteSound, CHESS_HIT_FRAME } from './sounds/site-audio.js?v=meter-4e09c8fb';
import { finishLoading } from './assets/loading/intro.js?v=return-24daee91';
import { createLandingCopy } from './assets/kinetic-copy.js?v=frames-36e551daa2ee';
import { createFrameSource } from './assets/frame-source.js?v=frames-5e14aac089b1';
import { createFrameCache } from './assets/frame-cache.js?v=frames-e50d5678e968';
import { createFramePacer } from './assets/frame-pacing.js?v=frames-fcf79e1ee64b';
import { createBufferPacingController } from './assets/buffer-pacing.js?v=frames-f38413a3e34d';
import { createNativeFrameScheduler } from './assets/native-frame-scheduler.js?v=frames-52d03cbc9f75';
import { prepareInlineVideo, waitForVideo, connectOpeningVideo } from './assets/video-playback.js?v=frames-82220d500c54';

const FPS = 60;

export async function createSequence(setInteractive, requestFrame, media) {
  const opening = document.querySelector('#opening');
  const journey = document.querySelector('#journey');
  const frame = document.querySelector('#journey-frame');
  const hold = document.querySelector('#hold-frame');
  const progress = document.querySelector('#progress');
  const game = document.querySelector('#game-page');
  const enter = document.querySelector('#enter');
  const status = document.querySelector('#status');
  const resumeJourney = document.querySelector('#journey-resume');
  const preparation = document.querySelector('#journey-preparation');
  const preparationTitle = document.querySelector('#preparation-title');
  const preparationStatus = document.querySelector('#preparation-status');
  const preparationProgress = document.querySelector('#preparation-progress');
  const preparationRetry = document.querySelector('#preparation-retry');
  const main = document.querySelector('main');
  prepareInlineVideo(opening);
  prepareInlineVideo(journey);
  journey.crossOrigin = 'anonymous';
  frame.width = media.journey.width;
  frame.height = media.journey.height;
  // Native video does not need this surface until a settled frame is captured.
  let context;
  let canvasDrawCount=0,canvasDrawMs=0,canvasDrawMaxMs=0,canvasPresentedFrame=null;
  function drawFrame(image,index) {
    context ||= frame.getContext('2d', { alpha: false });
    const started=performance.now();
    context.drawImage(image, 0, 0, frame.width, frame.height);
    const elapsed=performance.now()-started;
    canvasDrawCount++;canvasDrawMs+=elapsed;canvasDrawMaxMs=Math.max(canvasDrawMaxMs,elapsed);canvasPresentedFrame=index;
  }
  const updateCopy = await createLandingCopy();
  const indexURL = media.indexURL;
  const indexRequest = new AbortController();
  const indexTimeout = setTimeout(() => indexRequest.abort(), 15000);
  const metadata = fetch(indexURL, {signal:indexRequest.signal}).then(async response => {
    if (!response.ok) throw new Error('Frame index unavailable');
    const index = await response.json();
    if (index.version !== 1 || index.fps !== FPS || index.width !== frame.width || index.height !== frame.height ||
      !/^[a-f0-9]{64}$/.test(index.sha256) || !/^avc1\.[a-f0-9]{6}$/i.test(index.codec) || !/^(?:[a-f0-9]{2}){7,}$/i.test(index.description) ||
      index.colorSpace?.primaries !== 'bt709' || index.colorSpace?.transfer !== 'bt709' || index.colorSpace?.matrix !== 'bt709' ||
      new URL(index.source,indexURL).href !== media.journey.local || (media.journey.sha256 && index.sha256 !== media.journey.sha256) || !Number.isSafeInteger(index.bytes) ||
      !Array.isArray(index.frames) || index.frames.length !== index.frameCount ||
      !index.frames.every(entry => Array.isArray(entry) && entry.length === 2 && entry.every(Number.isSafeInteger) && entry[0] >= 0 && entry[1] > 0 && entry[0] + entry[1] <= index.bytes)) throw new Error('Invalid frame index');
    return {...index,source:media.journey.url,fallbackSource:media.journey.local};
  }).catch(async () => {
    journey.preload = 'metadata'; journey.src = media.journey.local;
    await waitForVideo(journey);
    return {source: journey.currentSrc, fps: FPS, width: journey.videoWidth, height: journey.videoHeight, frameCount: Math.round(journey.duration * FPS)};
  }).finally(() => clearTimeout(indexTimeout));
  const [index] = await Promise.all([metadata, hold.decode(), document.querySelector('#background').decode()]);
  if (index.frameCount < CHESS_HIT_FRAME - 240 + 1 || index.width !== frame.width || index.height !== frame.height) throw new Error('The journey video is incomplete');
  const frameCount = CHESS_HIT_FRAME - 240 + 1;
  const travel = (frameCount - 1) * 8;
  document.documentElement.style.setProperty('--travel', `${travel}px`);
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  let phase = 'opening';
  let desiredFrame = 0;
  let displayedFrame = 0;
  let interactive = false;
  let gameLoaded = false;
  let waitingForGameDocument = false;
  let gameVisible = false;
  let scrollDirty = false;
  let wantedFrame = 0;
  let refreshFrame = false;
  let preparationStarted = 0, preparationPhrase = -1, preparationPercent = -1;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pacedAt = performance.now(), paintedFrame = 0;
  let nativeMotionReady = false;
  const events = new AbortController();
  const scrollFrame = () => Math.round(Math.min(1, Math.max(0, window.scrollY / travel)) * (frameCount - 1));
  // Freeze only settled destinations inside their video-frame callback. Safari
  // can replace its paused compositor surface after that callback has returned.
  frame.transient = true; frame.close = () => {};
  const source = await createFrameSource(journey,index,indexURL,index => {
    if (scrollDirty || index !== scrollFrame()) throw new DOMException('Scroll resumed','AbortError');
    drawFrame(journey,index);
    return frame;
  }, () => {
    resumeJourney.hidden = true;
    cache.retry();
    requestFrame();
  },{renderer:new URLSearchParams(location.search).get('renderer')||'worker'});
  const pacer = createFramePacer();
  const nativePacer = createFramePacer({responsive: true});
  const workerPacer = createFramePacer({responsive: true});
  const bufferPacing = createBufferPacingController();
  let bufferDirection = 1, bufferMetrics = null;
  const workerTravelSpeed = 180;
  function resetBufferPacing() {
    bufferPacing.reset(); workerPacer.reset(displayedFrame);
    bufferDirection = Math.sign(desiredFrame - displayedFrame) || 1;
    bufferMetrics = null; pacedAt = performance.now();
  }
  // Verified keyframe seeking benefits from independent scheduling in WebKit.
  // Precise currentTime seeking retains its existing responsive RAF path;
  // independent scheduling is limited to the verified keyframe capability.
  const usesNativeScheduler = () => source.transient && source.nativeFastSeek;
  const constrained = matchMedia('(any-pointer: coarse)').matches || navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4;
  // Immutable frames are presented in tick(). Older Safari presents the video
  // itself through its compositor; only its completed position is reported here.
  const cache = createFrameCache({count: frameCount, source, canConfirm: index => !scrollDirty && index === scrollFrame(), onReady(available, image) {
    const advances = wantedFrame > displayedFrame ? available > displayedFrame && available <= wantedFrame : available < displayedFrame && available >= wantedFrame;
    if (image?.transient && (advances || refreshFrame && available === wantedFrame && phase === 'journey' || phase === 'journey' && available === displayedFrame && cache.settled)) {
      display(image,available);
      if (usesNativeScheduler() && displayedFrame !== scrollFrame()) nativeScheduler.ready();
    }
    requestFrame();
  },
    // Fast desktop scrolling needs more compressed frames available through
    // range-delivery gaps. Keep worker output surfaces bounded to four and
    // retain the same opening readiness threshold on every device.
    config: source.mode==='worker'
      ? constrained ? {network:2,batch:24,decoded:4,ahead:80,behind:40,prefetch:128,preparationFrames:57,compressedBytes:16*1024*1024} : {network:3,batch:24,decoded:4,ahead:192,behind:40,prefetch:256,preparationFrames:57,compressedBytes:24*1024*1024}
      : constrained ? {network:2,batch:24,decoded:4,ahead:56,behind:8,prefetch:80,preparationFrames:57,compressedBytes:10*1024*1024} : {},
    onError(error) {
      status.hidden = false;
      if (error.name === 'NotAllowedError') {
        status.hidden = true;
        resumeJourney.hidden = false;
      } else if (['NotSupportedError','EncodingError'].includes(error.name)) {
        cache.suspend();
        status.textContent = 'This browser cannot play the journey. Use Skip to Game to enter the game.';
      } else {
        // Preserve the scene during transient loading; details remain in Debug.
        status.hidden = true;
        status.textContent = '';
      }
    },
  });

  const bufferCapacity = cache.stats.settings.ahead;

  const nativeScheduler = createNativeFrameScheduler({onFrame() {
    if (!usesNativeScheduler() || !nativeMotionReady || document.hidden || !['idle','journey'].includes(phase)) return {active: false};
    readScrollTarget(true);
    const previous = wantedFrame;
    const pending = previous !== displayedFrame;
    const target = requestNextFrame(true);
    return {
      active: displayedFrame !== desiredFrame,
      pending: target !== displayedFrame,
      started: target !== displayedFrame && (!pending || target !== previous),
    };
  }});

  resumeJourney.addEventListener('click', () => { source.activate(); }, {signal: events.signal});

  function readScrollTarget(force = false) {
    if (!scrollDirty && !force) return;
    scrollDirty = false;
    desiredFrame = scrollFrame();
    if (desiredFrame > 0) allowHover(false);
  }

  function requestNextFrame(native = false) {
    const now = performance.now();
    const delta = (now - pacedAt) / 1000;
    let target;
    if (source.mode === 'worker') {
      bufferDirection = Math.sign(desiredFrame - displayedFrame) || bufferDirection;
      const coverage = cache.coverage(displayedFrame, bufferDirection, bufferCapacity);
      const pacing = bufferPacing.update({delta, bufferedFrames: coverage.available,
        remainingFrames: coverage.remaining, direction: bufferDirection,
        desiredDistance: Math.abs(desiredFrame - displayedFrame),
        consumptionSpeed: workerTravelSpeed, capacityFrames: bufferCapacity});
      bufferMetrics = {bufferAheadFrames: coverage.available, bufferAheadSeconds: coverage.available / FPS,
        bufferRequiredFrames: pacing.recoveryWatermark, bufferPacingScale: pacing.scale,
        bufferPacingLimited: pacing.limited, bufferPacingSpeed: workerTravelSpeed * pacing.scale};
      target = workerPacer.next(displayedFrame, desiredFrame, delta, paintedFrame,
        {scale: pacing.scale, maxSpeed: workerTravelSpeed * pacing.scale, maxAdvance: coverage.available});
    } else {
      if (bufferMetrics) resetBufferPacing();
      target = (source.transient ? nativePacer : pacer).next(displayedFrame, desiredFrame, delta, native ? displayedFrame : paintedFrame);
    }
    pacedAt = now;
    wantedFrame = target;
    cache.request(target, desiredFrame, displayedFrame);
    return target;
  }

  function preloadGame() {
    if (!game.getAttribute('src')) game.src = './play.html';
  }
  function setGameVisibility(visible) {
    if (gameVisible === visible) return;
    gameVisible = visible;
    game.contentWindow?.postMessage({type:'sofacet:experience-visibility',visible},location.origin);
  }

  function showGame() {
    if (!gameLoaded || desiredFrame !== frameCount - 1 || displayedFrame !== frameCount - 1 || !cache.settled) return;
    status.hidden = true;
    waitingForGameDocument = false;
    window.sofacetGameLoader?.cancel();
    document.body.dataset.game = 'visible';
    setGameVisibility(true);
    game.inert = false;
    game.removeAttribute('aria-hidden');
    game.focus();
  }
  game.addEventListener('load', () => {
    if (!game.getAttribute('src')) return;
    gameLoaded = true;
    showGame();
  }, {signal: events.signal});

  function allowHover(value) {
    if (interactive === value) return;
    interactive = value;
    setInteractive(value);
  }
  function changePhase(value) {
    if (phase === value) return;
    phase = value;
    document.body.dataset.phase = value;
    document.querySelector('#story-copy').setAttribute('aria-hidden', String(value === 'buffering' || value === 'settling'));
  }
  const openingPlayback = connectOpeningVideo(opening, enter, () => {
    updateCopy(240);
    opening.hidden = true;
    if (cache.preparation.ready) { changePhase('idle'); allowHover(true); }
    else {
      preparationStarted = performance.now();
      preparation.hidden = false;
      hold.hidden = true;
      changePhase('buffering');
    }
    requestFrame();
  }, requestFrame);
  preparationRetry.addEventListener('click', () => {
    cache.suspend(); cache.resume();
    preparationStarted = performance.now(); preparationPhrase = -1;
    preparationRetry.hidden = true; status.hidden = true; requestFrame();
  }, {signal: events.signal});
  document.addEventListener('visibilitychange', () => {
    resetBufferPacing();
    if (document.hidden) {
      setGameVisibility(false);
      nativeScheduler.suspend();
      cache.suspend();
    } else {
      setGameVisibility(document.body.dataset.game === 'visible');
      refreshFrame = true;
      nativeScheduler.resume();
      cache.resume();
      requestFrame();
    }
  }, {signal: events.signal});
  window.addEventListener('scroll', () => {
    if (['opening','buffering','settling'].includes(phase)) return;
    updateCopy.setScrolled(window.scrollY > 0);
    scrollDirty = true;
    if (usesNativeScheduler()) nativeScheduler.request();
    requestFrame();
  }, { passive: true, signal: events.signal });
  function display(image,index) {
    const direct = image === journey;
    if (direct) {
      if (journey.parentNode !== frame.parentNode) frame.after(journey);
      if (!journey.classList.contains('native-renderer')) journey.classList.add('native-renderer');
    } else {
      if (image !== frame) drawFrame(image,index);
      // Keep the native compositor surface sized behind the captured canvas.
      // Shrinking it after every stop forces WebKit to rebuild it on resume.
    }
    refreshFrame = false;
    if (!source.playbackBlocked) resumeJourney.hidden = true;
    displayedFrame = index;
    // Start the game only at the settled handoff below. Loading its iframe
    // creates another WebGL scene and compiles physics while the final video
    // frames are still being decoded, even when the iframe is hidden.
    updateCopy(240 + displayedFrame);
    if (displayedFrame !== frameCount - 1 || cache.settled) siteSound.frame(240 + displayedFrame);
    const atEnd = displayedFrame === frameCount - 1 && cache.settled;
    if (main.inert !== atEnd) main.inert = atEnd;
    if (displayedFrame === frameCount - 1 && cache.settled) {
      siteSound.handoff();
      if (!gameLoaded) { waitingForGameDocument = true; window.sofacetGameLoader?.show(); }
      preloadGame();
      status.hidden = gameLoaded;
      status.textContent = 'Loading game…';
      showGame();
    } else {
      if (waitingForGameDocument) { waitingForGameDocument = false; window.sofacetGameLoader?.cancel(); }
      siteSound.setActive(true);
      if (!status.hidden) status.hidden = true;
      if (document.body.hasAttribute('data-game')) delete document.body.dataset.game;
      setGameVisibility(false);
      if (!game.inert) game.inert = true;
      if (game.getAttribute('aria-hidden') !== 'true') game.setAttribute('aria-hidden', 'true');
    }
    if (displayedFrame > 0) {
      if (frame.hidden !== direct) frame.hidden = direct;
      changePhase('journey');
    } else if (desiredFrame === 0) {
      if (!frame.hidden) frame.hidden = true;
      changePhase('idle');
      allowHover(true);
    }
    progress.style.transform = `scaleX(${displayedFrame / (frameCount - 1)})`;
  }
  const destroy = () => { nativeScheduler.destroy(); openingPlayback.destroy(); cache.destroy(); events.abort(); updateCopy.destroy(); frame.width = frame.height = 1; };
  window.addEventListener('pagehide', event => { resetBufferPacing(); setGameVisibility(false); nativeScheduler.suspend(); event.persisted ? cache.suspend() : destroy(); }, {signal: events.signal});
  window.addEventListener('pageshow', event => { if (event.persisted) { resetBufferPacing(); refreshFrame = true; nativeScheduler.resume(); cache.resume(); setGameVisibility(document.body.dataset.game === 'visible' && !document.hidden); scrollDirty = true; requestFrame(); } }, {signal: events.signal});
  status.hidden = true;
  await finishLoading();
  updateCopy(0);
  siteSound.setActive(true);
  openingPlayback.start(reducedMotion);

  return {
    tick(delta, hoverWeight) {
      paintedFrame = displayedFrame;
      nativeMotionReady = false;
      if (phase === 'opening') {
        updateCopy(opening.currentTime * FPS);
        return !opening.paused && !opening.ended;
      }
      if (phase === 'buffering') {
        const readiness = cache.preparation;
        const elapsed = (performance.now() - preparationStarted) / 1000;
        const phrases = ['A world taking shape.', 'Every facet has a story.', 'Yours is about to begin.'];
        const phrase = Math.floor(elapsed / 4.5) % phrases.length;
        if (phrase !== preparationPhrase) {
          preparationTitle.textContent = phrases[phrase]; preparationPhrase = phrase;
        }
        const percent = Math.floor(readiness.progress * 100);
        if (percent !== preparationPercent) {
          preparationProgress.value = percent; preparationPercent = percent;
        }
        const message = elapsed > 20 ? 'Taking a little longer. You can retry or skip to the game.' : 'Preparing your journey';
        if (preparationStatus.textContent !== message) preparationStatus.textContent = message;
        preparationRetry.hidden = elapsed < 20;
        if (readiness.ready) {
          preparationStatus.textContent = 'Ready to explore';
          changePhase('settling');
        }
        return true;
      }
      if (phase === 'settling') {
        if (hoverWeight > .001) return true;
        preparation.hidden = true; status.hidden = true; hold.hidden = false;
        changePhase('idle'); allowHover(true);
        return false;
      }
      readScrollTarget();
      const hideHold = hoverWeight > .0001;
      if (hold.hidden !== hideHold) hold.hidden = hideHold;
      // Let lifted plates settle before the rendered ball starts travelling.
      if (hoverWeight > .001 && !interactive) return false;
      nativeMotionReady = hoverWeight <= .001;
      // Pace from the frame actually on screen, not an unseen scroll target.
      // Nearby samples remain useful while a slower connection catches up.
      if (usesNativeScheduler()) nativeScheduler.request();
      const target = usesNativeScheduler() ? wantedFrame : requestNextFrame();
      const available = cache.get(target) ? target : cache.closest(target,displayedFrame);
      const image = cache.get(available);
      if (image && (available !== displayedFrame || refreshFrame && phase === 'journey')) display(image,available);
      else if (desiredFrame === 0 && displayedFrame === 0) allowHover(true);
      return displayedFrame !== desiredFrame;
    },
    get phase() { return phase; },
    get desiredFrame() { return desiredFrame; },
    get displayedFrame() { return displayedFrame; },
    get seeking() { return displayedFrame !== desiredFrame; },
    get interactive() { return interactive; },
    get stats() { return {canvasDrawCount,canvasDrawMs,canvasDrawMaxMs,canvasPresentedFrame,...bufferMetrics,...cache.stats,...nativeScheduler.stats,preparation:cache.preparation,sourceWidth:index.width,sourceHeight:index.height,sourceFrames:index.frameCount,fps:index.fps}; },
    destroy,
    frameCount, travel,
  };
}
