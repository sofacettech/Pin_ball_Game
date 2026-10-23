import { siteSound, CHESS_HIT_FRAME } from './sounds/site-audio.js?v=meter-4e09c8fb';
import { finishLoading } from './assets/loading/intro.js?v=return-24daee91';
import { createLandingCopy } from './assets/kinetic-copy.js?v=frames-a4de83d217c2';
import { createFrameSource } from './assets/frame-source.js?v=frames-ddf88a251c00';
import { createFrameCache } from './assets/frame-cache.js?v=frames-8349e271bb0f';
import { createFramePacer } from './assets/frame-pacing.js?v=frames-9ac56988ee3c';
import { prepareInlineVideo, waitForVideo, connectOpeningVideo } from './assets/video-playback.js?v=frames-33fa5be3fea7';

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
  const context = frame.getContext('2d', { alpha: false });
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
  const pacer = createFramePacer();
  let pacedAt = performance.now(), paintedFrame = 0;
  const events = new AbortController();
  const source = await createFrameSource(journey,index,indexURL);
  const constrained = matchMedia('(any-pointer: coarse)').matches || navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4;
  // Immutable frames are presented in tick(). Older Safari presents the video
  // itself through its compositor; only its completed position is reported here.
  const cache = createFrameCache({count: frameCount, source, onReady(available, image) {
    const advances = wantedFrame > displayedFrame ? available > displayedFrame && available <= wantedFrame : available < displayedFrame && available >= wantedFrame;
    if (image?.transient && (advances || refreshFrame && available === wantedFrame && phase === 'journey' || phase === 'journey' && available === displayedFrame && cache.settled)) {
      display(image,available);
      // Native playback can start its next useful seek as soon as this one
      // completes, without paying another animation-frame scheduling delay.
      if (!scrollDirty && phase === 'journey' && displayedFrame !== desiredFrame) requestNextFrame();
    }
    requestFrame();
  },
    config: constrained ? {network:2,batch:24,decoded:4,ahead:144,behind:12,prefetch:160,compressedBytes:16*1024*1024} : {},
    onError(error) {
      status.hidden = false;
      if (['NotSupportedError','EncodingError'].includes(error.name)) {
        cache.suspend();
        status.textContent = 'This browser cannot play the journey. Use Skip to Game to enter the game.';
      } else status.textContent = 'This frame is still loading. Your last frame stays visible.';
    },
  });

  function requestNextFrame() {
    const now = performance.now();
    const target = pacer.next(displayedFrame, desiredFrame, (now - pacedAt) / 1000, paintedFrame);
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
    if (document.hidden) {
      setGameVisibility(false);
      cache.suspend();
    } else {
      setGameVisibility(document.body.dataset.game === 'visible');
      refreshFrame = true;
      cache.resume();
      requestFrame();
    }
  }, {signal: events.signal});
  window.addEventListener('scroll', () => {
    if (['opening','buffering','settling'].includes(phase)) return;
    updateCopy.setScrolled(window.scrollY > 0);
    scrollDirty = true;
    requestFrame();
  }, { passive: true, signal: events.signal });
  function display(image,index) {
    const direct = image === journey;
    if (direct) {
      if (journey.parentNode !== frame.parentNode) frame.after(journey);
      if (!journey.classList.contains('native-renderer')) journey.classList.add('native-renderer');
    } else context.drawImage(image, 0, 0, frame.width, frame.height);
    refreshFrame = false;
    displayedFrame = index;
    // Wait until playback approaches the handoff before competing with the
    // journey for bandwidth, even if a fast swipe has already reached the end.
    if (displayedFrame >= frameCount - 180) preloadGame();
    updateCopy(240 + displayedFrame);
    if (displayedFrame !== frameCount - 1 || cache.settled) siteSound.frame(240 + displayedFrame);
    const atEnd = displayedFrame === frameCount - 1;
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
  const destroy = () => { openingPlayback.destroy(); cache.destroy(); events.abort(); updateCopy.destroy(); };
  window.addEventListener('pagehide', event => { setGameVisibility(false); event.persisted ? cache.suspend() : destroy(); }, {signal: events.signal});
  window.addEventListener('pageshow', event => { if (event.persisted) { refreshFrame = true; cache.resume(); setGameVisibility(document.body.dataset.game === 'visible' && !document.hidden); scrollDirty = true; requestFrame(); } }, {signal: events.signal});
  status.hidden = true;
  await finishLoading();
  updateCopy(0);
  siteSound.setActive(true);
  openingPlayback.start(reducedMotion);

  return {
    tick(delta, hoverWeight) {
      paintedFrame = displayedFrame;
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
      if (scrollDirty) {
        scrollDirty = false;
        desiredFrame = Math.round(Math.min(1, Math.max(0, window.scrollY / travel)) * (frameCount - 1));
        if (desiredFrame > 0) allowHover(false);
      }
      const hideHold = hoverWeight > .0001;
      if (hold.hidden !== hideHold) hold.hidden = hideHold;
      // Let lifted plates settle before the rendered ball starts travelling.
      if (hoverWeight > .001 && !interactive) return false;
      // Pace from the frame actually on screen, not an unseen scroll target.
      // Nearby samples remain useful while a slower connection catches up.
      const target = requestNextFrame();
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
    get stats() { return {...cache.stats,preparation:cache.preparation,sourceWidth:index.width,sourceHeight:index.height,sourceFrames:index.frameCount,fps:index.fps}; },
    destroy,
    frameCount, travel,
  };
}
