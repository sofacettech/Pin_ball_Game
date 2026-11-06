export function connectCardMotion(root) {
  const cards = [...root.querySelectorAll('.sofacet-card')];
  const stage = root.querySelector('.stage'), deck = root.querySelector('.deck');
  const lifetime = new AbortController(), running = new Set();
  let disposed = false, visible = false, resumeFrame;
  const listen = (target, type, handler) => target.addEventListener(type, handler, {signal: lifetime.signal});
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const names = ['Diamond', 'Jewellery', 'Pinball'];
  const poses = ['translate(0,0) rotate(0deg) scale(1)', 'translate(14px,-8px) rotate(3deg) scale(.97)', 'translate(28px,-16px) rotate(6deg) scale(.94)'];
  const brightness = [1, .68, .48];
  const DURATION = 1600, INTERVAL = 8000, CLICK_DELAY = 500;
  const backStates = cards.map(() => false);
  let current = 0, busy = false, paused = reduced.matches, timer, clickTimer;
  const rank = (index, front = current) => (index - front + cards.length) % cards.length;

  function schedule() {
    clearTimeout(timer);
    if (!disposed && visible && !paused && !reduced.matches && !document.hidden && !backStates[current] && !busy && !clickTimer && document.activeElement !== deck) {
      timer = setTimeout(() => exchange((current + 1) % cards.length, false), INTERVAL);
    }
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
  async function exchange(target, manual = true, direction = 1, exitRight = false) {
    if (disposed || busy || target === current) return;
    clearTimeout(timer);
    busy = true;
    stage.setAttribute('aria-busy', 'true');
    const backwards = direction < 0;
    const moving = cards[backwards ? target : current];
    const animations = [];
    try {
      if (!reduced.matches) {
        const width = deck.getBoundingClientRect().width;
        const mobile = innerWidth < 600;
        const travel = mobile ? Math.max(width * 1.12, (innerWidth + width) / 2 + 32) : width * 1.12;
        const bend = (exitRight ? 1 : -1) * travel * 1.45;
        const curve = (a, b, c, d, t) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;
        const smooth = (a, b, t) => {const value = Math.max(0, Math.min(1, (t-a)/(b-a))); return value*value*(3-2*value);};
        cards.forEach((card, index) => {
          const start = {transform: poses[rank(index)], filter: `brightness(${brightness[rank(index)]})`, opacity: 1};
          const end = {transform: poses[rank(index, target)], filter: `brightness(${brightness[rank(index, target)]})`, opacity: 1};
          card.style.zIndex = card === moving ? (backwards ? 1 : 4) : 3 - rank(index, backwards ? current : target);
          card.style.willChange = 'transform, opacity, filter';
          // One continuous arc; the layer handoff travels with the animation,
          // where the card is clear of the stack (and faded out on phones).
          const frames = card === moving ? Array.from({length: 65}, (_, step) => {
            const offset = step / 64, t = backwards ? 1-offset : offset;
            const x = curve(0, bend, bend, 28, t);
            const y = curve(0, -28, -54, -16, t);
            const angle = curve(0, -10, -8, 6, t);
            const scale = curve(1, .985, .92, .94, t);
            const opacity = mobile ? (t < .5 ? 1-smooth(.08, .42, t) : smooth(.58, .94, t)) : 1;
            const frame = {offset, transform: `translate(${x}px,${y}px) rotate(${angle}deg) scale(${scale})`, filter: `brightness(${1+(brightness[2]-1)*t})`, opacity, zIndex: t < .5 ? 4 : 1};
            // Match the resting CSS exactly when the animation releases it.
            return step === 0 ? {...frame, ...start} : step === 64 ? {...frame, ...end} : frame;
          }) : [start, end];
          animations.push(card.animate(frames, {duration: DURATION, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards'}));
        });
        for (const animation of animations) {running.add(animation);if (!visible || document.hidden) animation.pause();}
        await Promise.all(animations.map(animation => animation.finished));
      }
      current = target;
    } catch (error) {if (!disposed) console.error('Card transition failed:', error);} finally {
      if (!disposed) render(manual);
      animations.forEach(animation => {running.delete(animation);animation.cancel();});
      cards.forEach(card => {card.style.zIndex = ''; card.style.willChange = '';});
      busy = false;
      stage.setAttribute('aria-busy', 'false');
      schedule();
    }
  }
  async function flip() {
    if (disposed || busy) return;
    const showBack = backStates[current];
    clearTimeout(timer);
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
        await Promise.all(animations.map(animation => animation.finished));
      }
      backStates[current] = !showBack;
    } catch (error) {if (!disposed) console.error('Card flip failed:', error);} finally {
      if (!disposed) render(true);
      animations.forEach(animation => {running.delete(animation);animation.cancel();});
      busy = false;
      stage.setAttribute('aria-busy', 'false');
      schedule();
    }
  }
  function move(direction, exitRight = false) {
    clearTimeout(clickTimer); clickTimer = undefined;
    exchange((current + direction + cards.length) % cards.length, true, direction, exitRight);
  }
  let pointerStart, swiped = false, pointerType = 'mouse';
  listen(deck, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    clearTimeout(clickTimer); clickTimer = undefined;
    clearTimeout(timer);
    pointerType = event.pointerType;
    pointerStart = {x: event.clientX, y: event.clientY, id: event.pointerId}; swiped = false;
    deck.setPointerCapture(event.pointerId);
  });
  listen(deck, 'pointercancel', () => { pointerStart = null; swiped = true; schedule(); });
  listen(deck, 'pointerup', event => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
    pointerStart = null;
    swiped = Math.hypot(dx, dy) > 12;
    if (pointerType !== 'mouse' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, dx > 0);
    deck.blur();
    schedule();
  });
  listen(deck, 'click', event => {
    if (swiped) {swiped = false; return;}
    if (disposed || busy) return;
    // WebKit can label a synthesized touch click as mouse; trust pointerdown.
    if (pointerType !== 'mouse') {flip(); return;}
    clearTimeout(clickTimer); clickTimer = undefined;
    if (event.detail >= 2) move(-1);
    else clickTimer = setTimeout(() => move(1), CLICK_DELAY);
  });
  listen(deck, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') flip();
    else if (event.key === ' ') { paused = !paused; render(); schedule(); }
    else move(event.key === 'ArrowRight' ? 1 : -1);
  });
  listen(document, 'visibilitychange', () => {
    setActive(visible);
  });
  listen(reduced, 'change', () => { if (reduced.matches) paused = true; render(); schedule(); });
  listen(deck, 'focus', () => clearTimeout(timer));
  listen(deck, 'blur', () => {cancelAnimationFrame(resumeFrame);resumeFrame = requestAnimationFrame(schedule);});
  render();
  Promise.all([...root.querySelectorAll('img')].map(image => image.decode().catch(() => {}))).then(schedule);
  function setActive(value) {
    visible = value;root.classList.toggle('tab-hidden', !visible || document.hidden);
    for (const animation of running) {if (visible && !document.hidden) animation.play();else animation.pause();}
    schedule();
  }
  return {setActive, dispose() {disposed = true;visible = false;lifetime.abort();clearTimeout(timer);clearTimeout(clickTimer);cancelAnimationFrame(resumeFrame);for (const animation of running) animation.cancel();running.clear();}};
}
