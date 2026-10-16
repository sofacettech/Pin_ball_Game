const FPS = 60;

function ready(video) {
  const metadataOnly = video.preload === 'metadata';
  if (video.readyState >= (metadataOnly ? 1 : 2)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener(metadataOnly ? 'loadedmetadata' : 'loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error(`Could not load ${video.id} video`)), { once: true });
  });
}

export async function createSequence(setInteractive, requestFrame) {
  const opening = document.querySelector('#opening');
  const journey = document.querySelector('#journey');
  const frame = document.querySelector('#journey-frame');
  const hold = document.querySelector('#hold-frame');
  const hint = document.querySelector('#hint');
  const progress = document.querySelector('#progress');
  const blackout = document.querySelector('#blackout');
  const game = document.querySelector('#game-page');
  const enter = document.querySelector('#enter');
  const context = frame.getContext('2d', { alpha: false });
  await Promise.all([ready(opening), ready(journey), hold.decode(), document.querySelector('#background').decode()]);
  const frameCount = Math.round(journey.duration * FPS);
  if (frameCount !== 1990 || journey.videoWidth !== 1920 || journey.videoHeight !== 1080) {
    throw new Error('The journey must contain 1990 Full HD frames, ending at the supplied Clip 6 final frame');
  }
  const travel = (frameCount - 1) * 8;
  document.documentElement.style.setProperty('--travel', `${travel}px`);
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  let phase = 'opening';
  let desiredFrame = 0;
  let easedFrame = 0;
  let displayedFrame = 0;
  let pendingFrame = null;
  let interactive = false;
  let resumeOpening = false;
  let gameLoaded = false;
  let fadedOut = false;

  function showGame() {
    if (!fadedOut || !gameLoaded || desiredFrame !== frameCount - 1 || displayedFrame !== frameCount - 1) return;
    document.body.dataset.game = 'visible';
    game.inert = false;
    game.removeAttribute('aria-hidden');
    game.focus();
  }
  game.addEventListener('load', () => {
    if (!game.getAttribute('src')) return;
    gameLoaded = true;
    showGame();
  });
  blackout.addEventListener('transitionend', event => {
    if (event.target !== blackout || event.propertyName !== 'opacity') return;
    fadedOut = blackout.classList.contains('visible');
    showGame();
  });

  function allowHover(value) {
    if (interactive === value) return;
    interactive = value;
    setInteractive(value);
  }
  function changePhase(value) {
    if (phase === value) return;
    phase = value;
    document.body.dataset.phase = value;
    hint.textContent = value === 'idle' ? (matchMedia('(hover: hover)').matches ? 'Hover to lift the plates · Scroll to explore' : 'Scroll to explore') : value === 'journey' ? 'Scroll to explore · Scroll up to return' : '';
  }
  opening.addEventListener('ended', () => {
    opening.hidden = true;
    journey.preload = 'auto';
    changePhase('idle');
    allowHover(true);
    requestFrame();
  });
  async function playOpening() {
    enter.hidden = true;
    try { await opening.play(); requestFrame(); }
    catch { enter.hidden = false; }
  }
  enter.addEventListener('click', playOpening);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeOpening = phase === 'opening' && !opening.paused;
      if (resumeOpening) opening.pause();
    } else if (resumeOpening) {
      resumeOpening = false;
      playOpening();
    }
  });
  window.addEventListener('scroll', () => {
    if (phase === 'opening') return;
    desiredFrame = Math.round(Math.min(1, Math.max(0, window.scrollY / travel)) * (frameCount - 1));
    if (desiredFrame > 0) allowHover(false);
    requestFrame();
  }, { passive: true });
  journey.addEventListener('seeked', () => {
    if (pendingFrame === null) return;
    context.drawImage(journey, 0, 0, frame.width, frame.height);
    displayedFrame = pendingFrame;
    pendingFrame = null;
    blackout.classList.toggle('visible', displayedFrame === frameCount - 1);
    document.querySelector('main').inert = displayedFrame === frameCount - 1;
    if (displayedFrame === frameCount - 1) {
      if (!game.getAttribute('src')) game.src = './play.html';
    } else {
      fadedOut = false;
      delete document.body.dataset.game;
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
    requestFrame();
  });
  for (const video of [opening, journey]) {
    video.addEventListener('error', () => {
      const status = document.querySelector('#status');
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'The video could not load. Reload to try again.';
    });
  }
  document.querySelector('#status').hidden = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) enter.hidden = false;
  else playOpening();

  return {
    tick(delta, hoverWeight) {
      if (phase === 'opening') return false;
      hold.hidden = hoverWeight > .0001;
      // Let lifted plates settle before the rendered ball starts travelling.
      if (hoverWeight > .001 && !interactive) return false;
      easedFrame += (desiredFrame - easedFrame) * (1 - Math.exp(-16 * delta));
      if (Math.abs(easedFrame - desiredFrame) < .05) easedFrame = desiredFrame;
      const target = Math.round(easedFrame);
      if (pendingFrame === null && target !== displayedFrame) {
        pendingFrame = target;
        journey.currentTime = (target + .25) / FPS;
      } else if (desiredFrame === 0 && displayedFrame === 0 && pendingFrame === null) allowHover(true);
      return easedFrame !== desiredFrame || (pendingFrame === null && displayedFrame !== desiredFrame);
    },
    get phase() { return phase; },
    get desiredFrame() { return desiredFrame; },
    get displayedFrame() { return displayedFrame; },
    get seeking() { return pendingFrame !== null; },
    get interactive() { return interactive; },
    frameCount, travel,
  };
}
