export const CHESS_HIT_FRAME = 2164;

export function createSiteSound() {
  let context, master, musicGain, rollingGain, rolling, hit;
  let loading, stopTimer, duckTimer, pauseTimer, requested = false;
  let enabled = true, unlocked = false, active = !document.body?.hasAttribute('data-loading'), moving = false, lastFrame = 240, lastMove = 0;
  const music = new Audio();
  music.preload = 'none';
  music.src = '/sounds/sofacet-experience-music.mp3';
  let musicPosition = 52;
  try {
    enabled = localStorage.getItem('sofacet-site-sound') !== 'off';
    const saved = Number(sessionStorage.getItem('sofacet-site-music'));
    if (Number.isFinite(saved) && saved >= 52) musicPosition = saved;
  } catch {}
  music.addEventListener('loadedmetadata', () => { music.currentTime = musicPosition < music.duration ? musicPosition : 52; });
  music.addEventListener('ended', () => { music.currentTime = 52; if (audible()) void music.play().catch(() => {}); });
  const audible = () => enabled && unlocked && active && !document.hidden;
  const fade = (node, value, seconds = .08) => node.gain.setTargetAtTime(value, context.currentTime, seconds);
  const musicLevel = () => fade(musicGain, duckTimer ? .045 : moving ? .065 : .1, .18);
  const paint = () => {
    const button = document.querySelector('#site-sound');
    if (!button) return;
    const on = enabled && unlocked;
    const previous = button.dataset.on;
    if (previous === String(on)) return;
    button.dataset.on = String(on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    button.title = on ? 'Mute sound' : 'Enable sound';
    if (previous !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const label of button.querySelectorAll('.sound-state')) {
        const entering = label.dataset.state === String(on);
        label.querySelectorAll('.sound-char').forEach((letter, index) => {
          letter.getAnimations().forEach(animation => animation.cancel());
          const animation = letter.animate([
            { transform: `translateY(${entering ? 110 : 0}%)`, opacity: entering ? 0 : 1 },
            { transform: `translateY(${entering ? 0 : -110}%)`, opacity: entering ? 1 : 0 },
          ], { duration: 360, delay: index * 18, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' });
          animation.onfinish = () => animation.cancel();
        });
      }
    }
  };
  function setup() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    musicGain = context.createGain(); musicGain.gain.value = .1;
    context.createMediaElementSource(music).connect(musicGain).connect(master);
    rollingGain = context.createGain(); rollingGain.gain.value = 0; rollingGain.connect(master);
    context.addEventListener('statechange', () => { unlocked = context.state === 'running'; paint(); });
  }
  function loadEffects() {
    if (!loading) loading = Promise.all(['sofacet-ball-roll.wav', 'sofacet-queen-impact.mp3'].map(async file => {
      const response = await fetch('/sounds/' + file);
      if (!response.ok) throw new Error('Could not load ' + file);
      return context.decodeAudioData(await response.arrayBuffer());
    })).then(([buffer, impact]) => {
      rolling = context.createBufferSource(); rolling.buffer = buffer; rolling.loop = true;
      rolling.loopStart = .12; rolling.loopEnd = buffer.duration;
      rolling.connect(rollingGain); rolling.start(); hit = impact;
    }).catch(error => { loading = undefined; console.warn('Website sound unavailable', error); });
    return loading;
  }
  function update() {
    if (!context) return;
    clearTimeout(pauseTimer);
    fade(master, audible() ? 1 : 0, .1);
    if (audible()) { musicLevel(); void music.play().catch(() => {}); }
    else {
      moving = false; clearTimeout(stopTimer); fade(rollingGain, 0, .04);
      pauseTimer = setTimeout(() => { if (!audible()) { music.pause(); void context.suspend(); } }, 400);
    }
    paint();
  }
  function unlock() {
    requested = true;
    if (!enabled || !active || document.hidden) return;
    setup();
    void context.resume().then(() => { unlocked = context.state === 'running'; update(); }).catch(() => {});
    // Keep play() in the gesture handler for Safari's media activation rule.
    void music.play().catch(() => {});
    void loadEffects();
  }
  function stopRolling() {
    moving = false;
    if (context) { fade(rollingGain, 0, .045); musicLevel(); }
  }
  function impact() {
    if (!audible() || !hit) return;
    const source = context.createBufferSource(), gain = context.createGain();
    const now = context.currentTime, duration = Math.min(.45, hit.duration);
    source.buffer = hit; gain.gain.setValueAtTime(.1, now);
    gain.gain.setValueAtTime(.1, now + Math.max(0, duration - .18));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain).connect(master); source.start(now, 0, duration);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    fade(musicGain, .045, .025); clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { duckTimer = undefined; musicLevel(); }, 450);
  }
  let hitArmed = true;
  return {
    unlock,
    toggle() {
      enabled = !enabled || !unlocked;
      try { localStorage.setItem('sofacet-site-sound', enabled ? 'on' : 'off'); } catch {}
      if (enabled) unlock(); else update();
    },
    setActive(value) { if (active === value) return; active = value; if (active && enabled && requested) unlock(); else update(); },
    handoff() {
      if (!active) return;
      active = false;
      moving = false;
      clearTimeout(stopTimer); clearTimeout(duckTimer); clearTimeout(pauseTimer);
      duckTimer = undefined;
      if (!context) return;
      fade(rollingGain, 0, .025); fade(musicGain, 0, .035);
      // Keep the impact's short reverb audible across the visual transition.
      pauseTimer = setTimeout(() => {
        if (!active) { music.pause(); fade(master, 0, .025); void context.suspend(); }
      }, 500);
    },
    frame(frame) {
      if (frame === lastFrame) return;
      const previous = lastFrame, now = performance.now(); lastFrame = frame;
      if (frame < CHESS_HIT_FRAME - 12) hitArmed = true;
      if (previous < CHESS_HIT_FRAME && frame >= CHESS_HIT_FRAME && hitArmed) { hitArmed = false; impact(); }
      moving = false;
      if (context && audible()) {
        clearTimeout(stopTimer);
        moving = frame < CHESS_HIT_FRAME && previous < CHESS_HIT_FRAME;
        const speed = Math.abs(frame - previous) / Math.max(1, (now - lastMove) * .06);
        fade(rollingGain, moving ? .7 * Math.min(.2, .09 + speed * .06) : 0, .035);
        if (!duckTimer) musicLevel();
        stopTimer = setTimeout(stopRolling, 130);
      }
      lastMove = now;
    },
    visibility() { stopRolling(); if (document.hidden) update(); else if (enabled && context) unlock(); },
    save() { try { if (music.readyState && music.currentTime >= 52) sessionStorage.setItem('sofacet-site-music', String(music.currentTime)); sessionStorage.setItem('sofacet-site-sound-active', enabled && unlocked ? 'on' : 'off'); } catch {} },
    get enabled() { return enabled && unlocked; },
  };
}

export const siteSound = createSiteSound();
const button = document.createElement('button');
button.id = 'site-sound'; button.type = 'button'; button.className = 'site-sound';
button.dataset.on = 'false';
button.setAttribute('aria-label', 'Sound off'); button.setAttribute('aria-pressed', 'false'); button.title = 'Enable sound';
button.innerHTML = '<span class="sound-text" aria-hidden="true">' + ['OFF', 'ON'].map(state =>
  `<span class="sound-state" data-state="${state === 'ON'}">${Array.from('Sound ' + state.toLowerCase()).map(letter => `<span class="sound-char">${letter}</span>`).join('')}</span>`
).join('') + '</span><svg class="sound-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4Z"/><path class="sound-on-icon" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off-icon" d="m16 9 5 6m0-6-5 6"/></svg><span class="sound-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
(document.querySelector('.site-navigation') || document.querySelector('.info-page header')).prepend(button);
button.addEventListener('click', () => siteSound.toggle());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
  if (event.matches) button.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
});
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, event => {
  if (event.target.closest?.('#site-sound') || event.metaKey || event.ctrlKey || event.altKey) return;
  siteSound.unlock();
}, { passive: true });
document.addEventListener('visibilitychange', () => siteSound.visibility());
window.addEventListener('pagehide', () => { siteSound.save(); siteSound.setActive(false); });
window.addEventListener('pageshow', () => siteSound.setActive(!document.body.hasAttribute('data-loading') && document.body.dataset.game !== 'visible'));
siteSound.unlock();
