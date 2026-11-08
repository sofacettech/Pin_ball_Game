export function connectCardMotion(root, onComplete) {
  const cards = [...root.querySelectorAll('.sofacet-card')];
  const stage = root.querySelector('.stage'), deck = root.querySelector('.deck');
  const lifetime = new AbortController(), running = new Set();
  let disposed = false, visible = false, completed = false;
  const listen = (target, type, handler) => target.addEventListener(type, handler, {signal: lifetime.signal});
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const names = ['Diamond', 'Jewellery', 'Pinball'];
  const poses = ['translate(0,0) rotate(0deg) scale(1)', 'translate(14px,-8px) rotate(3deg) scale(.97)', 'translate(28px,-16px) rotate(6deg) scale(.94)'];
  const brightness = [1, .68, .48];
  const DURATION = 1600, INTERVAL = 8000;
  const backStates = cards.map(() => false);
  let current = 0, busy = false, paused = false, timer, startedAt, remaining = INTERVAL;
  let pointerStart, swiped = false, pointerType = 'mouse';
  const rank = (index, front = current) => (index - front + cards.length) % cards.length;

  function stopTimer() {
    clearTimeout(timer);
    if (startedAt === undefined) return;
    remaining = Math.max(0, remaining - (performance.now() - startedAt));
    startedAt = undefined;
  }
  function schedule() {
    if (disposed || completed || !visible || document.hidden || paused || busy || pointerStart || startedAt !== undefined) return;
    startedAt = performance.now();
    timer = setTimeout(() => exchange(), remaining);
  }
  function render(announce = false) {
    const showBack = backStates[current];
    cards.forEach((card, index) => {
      card.dataset.slot = rank(index);
      if (!busy) card.style.zIndex = '';
      card.setAttribute('aria-hidden', String(index !== current));
      card.classList.toggle('is-reversed', backStates[index]);
      card.querySelector('.front-face').setAttribute('aria-hidden', String(backStates[index]));
      card.querySelector('.reverse-face').setAttribute('aria-hidden', String(!backStates[index]));
    });
    deck.setAttribute('aria-label', `${names[current]} card. ${showBack ? 'Back' : 'Front'} view`);
    root.classList.toggle('paused', paused);
    if (announce) root.querySelector('[data-card-status]').textContent = `${names[current]} card, ${current + 1} of 3. ${showBack ? 'Back' : 'Front'} view.`;
  }
  async function exchange(exitRight = false) {
    if (disposed || completed || busy || !visible || document.hidden) return;
    stopTimer();
    busy = true;
    stage.setAttribute('aria-busy', 'true');
    const target = current + 1;
    const last = target === cards.length;
    const moving = cards[current];
    const animations = [];
    try {
      if (!reduced.matches) {
        const width = deck.getBoundingClientRect().width;
        const mobile = innerWidth < 600;
        const travel = mobile ? Math.max(width * 1.12, (innerWidth + width) / 2 + 32) : width * 1.12;
        const direction = exitRight ? 1 : -1;
        const bend = direction * travel * 1.45;
        const curve = (a, b, c, d, t) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;
        const smooth = (a, b, t) => {const value = Math.max(0, Math.min(1, (t-a)/(b-a))); return value*value*(3-2*value);};
        cards.forEach((card, index) => {
          const start = {transform: poses[rank(index)], filter: `brightness(${brightness[rank(index)]})`, opacity: 1};
          const end = last ? {...start, opacity: 0} : {transform: poses[rank(index, target)], filter: `brightness(${brightness[rank(index, target)]})`, opacity: 1};
          if (last && card === moving) end.transform = `translate(${direction * Math.max(travel, innerWidth)}px,-30px) rotate(${direction * 10}deg) scale(.94)`;
          card.style.zIndex = card === moving ? 4 : 3 - rank(index, last ? current : target);
          card.style.willChange = 'transform, opacity, filter';
          // One continuous arc; the layer handoff travels with the animation,
          // where the card is clear of the stack (and faded out on phones).
          const frames = card === moving && !last ? Array.from({length: 65}, (_, step) => {
            const t = step / 64;
            const x = curve(0, bend, bend, 28, t);
            const y = curve(0, -28, -54, -16, t);
            const angle = curve(0, -10, -8, 6, t);
            const scale = curve(1, .985, .92, .94, t);
            const opacity = mobile ? (t < .5 ? 1-smooth(.08, .42, t) : smooth(.58, .94, t)) : 1;
            const frame = {offset: t, transform: `translate(${x}px,${y}px) rotate(${angle}deg) scale(${scale})`, filter: `brightness(${1+(brightness[2]-1)*t})`, opacity, zIndex: t < .5 ? 4 : 1};
            // Match the resting CSS exactly when the animation releases it.
            return step === 0 ? {...frame, ...start} : step === 64 ? {...frame, ...end} : frame;
          }) : [start, end];
          animations.push(card.animate(frames, {duration: DURATION, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards'}));
        });
        for (const animation of animations) {running.add(animation);if (!visible || document.hidden) animation.pause();}
        await Promise.all(animations.map(animation => animation.finished));
      }
    } catch (error) {if (!disposed) console.error('Card transition failed:', error);} finally {
      if (!disposed && !last) {
        current = target;
        remaining = INTERVAL;
        render(true);
      }
      animations.forEach(animation => {running.delete(animation);animation.cancel();});
      cards.forEach(card => {card.style.zIndex = ''; card.style.willChange = '';});
      busy = false;
      stage.setAttribute('aria-busy', 'false');
      if (!disposed && last) {
        completed = true;
        onComplete();
      } else schedule();
    }
  }
  async function flip() {
    if (disposed || completed || busy || !visible || document.hidden) return;
    const showBack = backStates[current];
    let faceFrame;
    stopTimer();
    busy = true;
    stage.setAttribute('aria-busy', 'true');
    const animations = [];
    try {
      if (!reduced.matches) {
        animations.push(cards[current].querySelector('.card-turn').animate([
          {transform: `rotateY(${showBack ? 180 : 0}deg)`},
          {transform: `rotateY(${showBack ? 0 : 180}deg)`}
        ], {duration: 1000, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards'}));
        for (const animation of animations) {running.add(animation);if (!visible || document.hidden) animation.pause();}
        // Switch faces at 90 degrees instead of relying on WebKit's backface compositing.
        const swapAtEdge = () => {
          if (disposed) return;
          if ((animations[0].effect.getComputedTiming().progress ?? 0) < .5) {
            faceFrame = requestAnimationFrame(swapAtEdge);return;
          }
          backStates[current] = !showBack;
          render();
        };
        faceFrame = requestAnimationFrame(swapAtEdge);
        await Promise.all(animations.map(animation => animation.finished));
      }
      backStates[current] = !showBack;
    } catch (error) {if (!disposed) console.error('Card flip failed:', error);} finally {
      if (faceFrame !== undefined) cancelAnimationFrame(faceFrame);
      if (!disposed) render(true);
      animations.forEach(animation => {running.delete(animation);animation.cancel();});
      busy = false;
      stage.setAttribute('aria-busy', 'false');
      schedule();
    }
  }
  listen(deck, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || busy || completed) return;
    stopTimer();
    pointerType = event.pointerType;
    pointerStart = {x: event.clientX, y: event.clientY, id: event.pointerId}; swiped = false;
    deck.setPointerCapture(event.pointerId);
  });
  listen(deck, 'pointercancel', () => { pointerStart = null; swiped = true; schedule(); });
  listen(deck, 'lostpointercapture', () => { if (pointerStart) {pointerStart = null; schedule();} });
  listen(deck, 'pointerup', event => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
    pointerStart = null;
    swiped = Math.hypot(dx, dy) > 12;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) exchange(dx > 0);
    deck.blur();
    schedule();
  });
  listen(deck, 'click', () => {
    if (swiped) {swiped = false; return;}
    if (disposed || busy) return;
    // WebKit can label a synthesized touch click as mouse; trust pointerdown.
    if (pointerType !== 'mouse') {flip(); return;}
    exchange();
  });
  listen(deck, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') flip();
    else if (event.key === ' ') { paused = !paused; render(); if (paused) stopTimer(); else schedule(); }
    else if (!event.repeat) exchange(event.key === 'ArrowRight');
  });
  listen(document, 'visibilitychange', () => {
    setActive(visible);
  });
  render();
  function setActive(value) {
    visible = value;root.classList.toggle('tab-hidden', !visible || document.hidden);
    const playing = visible && !document.hidden;
    for (const animation of running) {if (playing) animation.play();else animation.pause();}
    if (playing) schedule();
    else stopTimer();
  }
  return {setActive, dispose() {disposed = true;visible = false;lifetime.abort();stopTimer();for (const animation of running) animation.cancel();running.clear();}};
}
