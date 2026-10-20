export function mountReveal(stage, onComplete = () => {}) {
  const $ = id => stage.querySelector(`#${id}`);
  const audio = $('introAudio');
  audio.volume = .25;
  try { audio.muted = localStorage.getItem('sofacet-site-sound') === 'off'; } catch {}
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const elements = Object.fromEntries(['revealEdge','scanArea','texture','atmosphere','sideReflections','groundReflection','logoBloom','scanner','beamA','beamB','reflectedBeamA','reflectedBeamB'].map(id => [id, $(id)]));
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  const opacity = (id, value) => elements[id].setAttribute('opacity', value.toFixed(4));
  let frame = 0, start = 0, elapsed = 0, completed = false;
  let soundGeneration = 0, resumeSound = false;

  function stopSound() {
    soundGeneration++;
    audio.pause();
    if (stage.dataset.sound !== 'blocked') stage.dataset.sound = 'paused';
  }
  function playSound(restart = false) {
    const generation = ++soundGeneration;
    if (restart) audio.currentTime = 0;
    stage.dataset.sound = 'starting';
    // A blocked autoplay attempt must leave the silent visual intro usable.
    audio.play().then(() => {
      if (generation === soundGeneration) stage.dataset.sound = 'playing';
    }).catch(error => {
      if (generation === soundGeneration) stage.dataset.sound = error.name === 'NotAllowedError' ? 'blocked' : 'unavailable';
    });
  }

  function render(time) {
    const reveal = smooth(.8, 2.65, time);
    const activation = smooth(3.4, 4.75, time);
    const settle = smooth(4.65, 5.55, time);
    // A stepped, directional reveal exposes the diagonal etched microstructure.
    const edge = -35 + reveal * 390;
    elements.revealEdge.setAttribute('d', `M0 -30H344V${edge-62}H294V${edge-37}H224V${edge-15}H130V${edge}H0Z`);
    opacity('texture', (.24 + .48 * smooth(.9, 2.2, time)) * (1 - settle));

    // Two very thin parallel boundaries travel apart from the same diagonal.
    // Expanding the lit band replaces the etched material with solid lime.
    const center = 1824;
    const halfWidth = Math.pow(activation, 2.5) * 910;
    const a = center - halfWidth;
    const b = center + halfWidth;
    const top = 825, bottom = 825 + 515 * smooth(3.38, 3.85, time), mid = 1080;
    const xAt = (x, y) => x - (y - mid) * 1.18;
    const line = x => `M${xAt(x,bottom)} ${bottom}L${xAt(x,top)} ${top}`;
    elements.beamA.setAttribute('d', line(a));
    elements.beamB.setAttribute('d', line(b));
    const localX = (x, y) => xAt(x, y + 943) - 1652;
    elements.scanArea.setAttribute('d', activation === 0 ? 'M0 0Z' : `M${localX(a,-20)} -20H${localX(b,-20)}V-20L${localX(b,300)} 300H${localX(a,300)}Z`);
    const sweepLight = smooth(3.36, 3.7, time) * (1 - smooth(4.35, 4.78, time));
    opacity('scanner', sweepLight);
    // Soft, oblique reflected streaks, displaced from the source light.
    elements.reflectedBeamA.setAttribute('d', `M${xAt(a,1225)} 1225l180 110`);
    elements.reflectedBeamB.setAttribute('d', `M${xAt(b,1225)} 1225l180 110`);
    opacity('atmosphere', .3 + reveal * .35 + activation * .35 + sweepLight * .1);
    opacity('sideReflections', .012 + reveal * .012 + activation * .033);
    opacity('groundReflection', .35 + reveal * .4 + activation * .25);
    opacity('logoBloom', .001 + activation * .02 + sweepLight * .012);
    stage.dataset.phase = time >= 6 ? 'complete' : time < .8 ? 'darkness' : time < 3.4 ? 'etching' : time < 4.6 ? 'scan' : 'settling';
  }

  function tick(now) {
    if (!start) start = now - elapsed * 1000;
    const clock = !audio.paused && !audio.ended ? audio.currentTime : (now - start) / 1000;
    elapsed = Math.min(6, clock);
    render(elapsed);
    frame = elapsed < 6 ? requestAnimationFrame(tick) : 0;
    if (elapsed >= 6) finish();
  }
  function finish() {
    if (completed) return;
    completed = true;
    cancelAnimationFrame(frame);
    frame = 0; elapsed = 6; audio.autoplay = false; stopSound(); render(6);
    onComplete();
  }
  function replay() {
    if (completed) return;
    cancelAnimationFrame(frame);
    start = 0; elapsed = 0;
    if (reduceMotion.matches) return finish();
    audio.autoplay = true;
    playSound(true);
    render(0); frame = requestAnimationFrame(tick);
  }
  const onKeyDown = event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onFirstInteraction(); }
    else if (event.key === 'Escape') finish();
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); audio.muted = !audio.muted; }
  };
  stage.addEventListener('keydown', onKeyDown);
  const onFirstInteraction = event => {
    if (event?.key === 'Escape') return finish();
    if (!completed && !reduceMotion.matches && audio.paused) {
      audio.currentTime = elapsed;
      playSound();
    }
  };
  document.addEventListener('click', onFirstInteraction);
  document.addEventListener('keydown', onFirstInteraction);
  const onMotionChange = () => reduceMotion.matches ? finish() : replay();
  reduceMotion.addEventListener('change', onMotionChange);
  const onVisibilityChange = () => {
    if (document.hidden) {
      resumeSound = !audio.paused;
      stopSound(); cancelAnimationFrame(frame); frame = 0;
    } else if (elapsed < 6 && !completed) {
      if (resumeSound) playSound();
      start = 0; frame = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const onPageHide = () => { cancelAnimationFrame(frame); stopSound(); };
  window.addEventListener('pagehide', onPageHide);
  replay();
  return () => {
    cancelAnimationFrame(frame);
    audio.autoplay = false;
    stopSound();
    document.removeEventListener('click', onFirstInteraction);
    document.removeEventListener('keydown', onFirstInteraction);
    stage.removeEventListener('keydown', onKeyDown);
    reduceMotion.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
  };
}
