import { siteSound, CHESS_HIT_FRAME } from './sounds/site-audio.js?v=meter-4e09c8fb';
import { finishLoading } from './assets/loading/intro.js?v=return-24daee91';
import { createLandingCopy } from './assets/kinetic-copy.js?v=frames-7b1133b75300';
import { createFrameSource } from './assets/frame-source.js?v=frames-cbe98f608065';
import { createFrameCache } from './assets/frame-cache.js?v=frames-05437ea6cdaf';
import { prepareInlineVideo, waitForVideo, connectOpeningVideo } from './assets/video-playback.js?v=frames-b1954aae3e53';

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
  let easedFrame = 0;
  let displayedFrame = 0;
  let interactive = false;
  let gameLoaded = false;
  let gameVisible = false;
  let scrollDirty = false;
  let refreshFrame = false;
  const events = new AbortController();
  const source = await createFrameSource(journey,index,indexURL);
  const constrained = matchMedia('(any-pointer: coarse)').matches || navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4;
  // Both decoders return immutable frames. Present only in tick(), together
  // with scene positioning and copy, once per browser animation frame.
  const cache = createFrameCache({count: frameCount, source, onReady: requestFrame,
    config: constrained ? {network:2,batch:24,decoded:4,ahead:56,behind:8,prefetch:80,compressedBytes:10*1024*1024} : {},
    onError(error) {
      status.hidden = false;
      if (['NotSupportedError','EncodingError'].includes(error.name)) {
        cache.suspend();
        status.textContent = 'This browser cannot play the journey. Use Play now to enter the game.';
      } else status.textContent = 'This frame is still loading. Your last frame stays visible.';
    },
  });

  function preloadGame() {
    if (!game.getAttribute('src')) game.src = './play.html';
  }
  function setGameVisibility(visible) {
    if (gameVisible === visible) return;
    gameVisible = visible;
    game.contentWindow?.postMessage({type:'sofacet:experience-visibility',visible},location.origin);
  }

  function showGame() {
    if (!gameLoaded || desiredFrame !== frameCount - 1 || displayedFrame !== frameCount - 1) return;
    status.hidden = true;
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
  }
  const openingPlayback = connectOpeningVideo(opening, enter, () => {
    updateCopy(240);
    opening.hidden = true;
    changePhase('idle');
    allowHover(true);
    requestFrame();
  }, requestFrame);
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
    if (phase === 'opening') return;
    scrollDirty = true;
    requestFrame();
  }, { passive: true, signal: events.signal });
  function display(image,index) {
    context.drawImage(image, 0, 0, frame.width, frame.height);
    refreshFrame = false;
    displayedFrame = index;
    updateCopy(240 + displayedFrame);
    siteSound.frame(240 + displayedFrame);
    document.querySelector('main').inert = displayedFrame === frameCount - 1;
    if (displayedFrame === frameCount - 1) {
      siteSound.handoff();
      preloadGame();
      status.hidden = gameLoaded;
      status.textContent = 'Loading game…';
      showGame();
    } else {
      siteSound.setActive(true);
      status.hidden = true;
      delete document.body.dataset.game;
      setGameVisibility(false);
      game.inert = true;
      game.setAttribute('aria-hidden', 'true');
    }
    if (displayedFrame > 0) {
      frame.hidden = false;
      changePhase('journey');
    } else if (desiredFrame === 0) {
      frame.hidden = true;
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
  openingPlayback.start(matchMedia('(prefers-reduced-motion: reduce)').matches);

  return {
    tick(delta, hoverWeight) {
      if (phase === 'opening') {
        updateCopy(opening.currentTime * FPS);
        return !opening.paused && !opening.ended;
      }
      if (scrollDirty) {
        scrollDirty = false;
        desiredFrame = Math.round(Math.min(1, Math.max(0, window.scrollY / travel)) * (frameCount - 1));
        if (desiredFrame > 0) allowHover(false);
        // Avoid loading the game's large 3D assets while the journey is buffering.
        if (desiredFrame >= frameCount - 180) preloadGame();
      }
      hold.hidden = hoverWeight > .0001;
      // Let lifted plates settle before the rendered ball starts travelling.
      if (hoverWeight > .001 && !interactive) return false;
      easedFrame += (desiredFrame - easedFrame) * (1 - Math.exp(-16 * delta));
      if (Math.abs(easedFrame - desiredFrame) < .05) easedFrame = desiredFrame;
      const target = Math.round(easedFrame);
      cache.request(target,desiredFrame,displayedFrame);
      const available = cache.get(target) ? target : cache.closest(target,displayedFrame);
      const image = cache.get(available);
      if (image && (available !== displayedFrame || refreshFrame && phase === 'journey')) display(image,available);
      else if (desiredFrame === 0 && displayedFrame === 0) allowHover(true);
      return easedFrame !== desiredFrame;
    },
    get phase() { return phase; },
    get desiredFrame() { return desiredFrame; },
    get displayedFrame() { return displayedFrame; },
    get seeking() { return displayedFrame !== Math.round(easedFrame); },
    get interactive() { return interactive; },
    get stats() { return {...cache.stats,sourceWidth:index.width,sourceHeight:index.height,sourceFrames:index.frameCount,fps:index.fps}; },
    destroy,
    frameCount, travel,
  };
}
