export function initializeCarousel(scope){
 const {document,window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,addEventListener,matchMedia,ResizeObserver}=scope;

  const orbit = document.getElementById('orbit');
  const pieces = [...orbit.querySelectorAll('.piece')];
  const scene = document.getElementById('scene');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const status = document.getElementById('photo-status');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const descriptions = ['yellow pear-shaped ring', 'blue earrings, worn', 'leaf-shaped earrings', 'butterfly-shaped jewel', 'oval-stone ring', 'bracelet, worn'];
  const total = pieces.length;
  let position = 0, target = 0, velocity = 0, active = -1;
  let radius = 0, orbitHeight = 0, dragDistance = 180;
  let frame = 0, lastFrame = 0, settleTimer = 0;
  let dragging = null, ignoreClick = false;
  let intro = null, introStarted = false, hiddenAt = 0;
  let wheelOrigin = null, inputMode = 'pointer';
  scene.dataset.intro = 'pending';
  const wrap = value => ((value % total) + total) % total;
  const nearest = index => target + ((index - wrap(target) + total * 1.5) % total - total / 2);

  function updateSelection(index) {
    if (index === active) return;
    active = index;
    pieces.forEach((piece, i) => {
      piece.setAttribute('aria-pressed', String(i === index));
      piece.tabIndex = i === index ? 0 : -1;
    });
    if (inputMode === 'keyboard' && pieces.includes(document.activeElement)) pieces[index].focus({preventScroll:true});
    status.textContent = `Photograph ${index + 1} of ${total}: ${descriptions[index]}.`;
    scene.dataset.active = String(index);
  }

  function render(now) {
    frame = 0;
    const dt = Math.min(.05, Math.max(.001, (now - lastFrame) / 1000 || .016));
    lastFrame = now;
    if (intro) {
      if (intro.start === null) intro.start = now;
      const progress = Math.min(1, (now - intro.start) / 4800);
      position = intro.base + total * progress * progress * (3 - 2 * progress);
      velocity = 0;
      if (progress === 1) {
        position = intro.base;
        intro = null;
        scene.dataset.intro = 'complete';
        scene.dataset.introTurns = '1';
        status.setAttribute('aria-live', 'polite');
      }
    } else if (reduced.matches) {
      target = Math.round(target);
      position = target;
      velocity = 0;
    } else {
      // Exact critically damped spring: interrupted turns retain their velocity.
      const omega = dragging?.moved ? 30 : 16;
      const offset = position - target;
      const impulse = velocity + omega * offset;
      const decay = Math.exp(-omega * dt);
      position = target + (offset + impulse * dt) * decay;
      velocity = (velocity - omega * impulse * dt) * decay;
      if (Math.abs(target - position) < .0001 && Math.abs(velocity) < .001) {
        position = target;
        velocity = 0;
      }
    }
    const moving = Boolean(intro) || position !== target;
    if (!moving && Math.abs(target) > total * 1000) {
      const turns = Math.trunc(target / total) * total;
      target -= turns;
      position -= turns;
    }
    pieces.forEach((piece, i) => {
      const angle = (i - position) * Math.PI * 2 / total;
      const side = Math.sin(angle);
      const depth = (1 - Math.cos(angle)) / 2;
      const scale = 1 - depth * .55;
      const x = side * radius * (1 + depth * .7);
      const y = depth * orbitHeight * .14;
      const fade = Math.max(0, Math.min(1, (1 - depth) / .28));
      const visible = fade > .08;
      piece.style.transform = `translate3d(calc(-50% + ${x}px),calc(-50% + ${y}px),0) perspective(1200px) rotateY(${-side * 38}deg) scale(${scale})`;
      piece.style.opacity = String(fade * fade * (3 - 2 * fade) * (1 - depth * .65));
      piece.style.zIndex = String(Math.round((1 - depth) * 100));
      piece.style.willChange = moving && !reduced.matches ? 'transform, opacity' : 'auto';
      piece.style.pointerEvents = visible ? 'auto' : 'none';
      piece.setAttribute('aria-hidden', String(!visible));
    });
    orbit.dataset.position = position.toFixed(3);
    orbit.dataset.target = target.toFixed(3);
    updateSelection(Math.round(wrap(position)) % total);
    if (moving && !document.hidden) frame = requestAnimationFrame(render);
    else lastFrame = 0;
  }

  function requestRender() {
    if (!frame && !document.hidden) {
      if (!lastFrame) lastFrame = performance.now();
      frame = requestAnimationFrame(render);
    }
  }

  function beginIntro() {
    if (introStarted || document.hidden) return;
    introStarted = true;
    if (reduced.matches) { scene.dataset.intro = 'skipped'; return; }
    intro = {base:target, start:null};
    position = intro.base;
    scene.dataset.intro = 'running';
    status.setAttribute('aria-live', 'off');
    requestRender();
  }

  function stopIntro() {
    if (!introStarted) { introStarted = true; scene.dataset.intro = 'interrupted'; }
    if (!intro) return;
    intro = null;
    scene.dataset.intro = 'interrupted';
    status.setAttribute('aria-live', 'polite');
    target = position;
    velocity = 0;
    requestRender();
  }

  function measure() {
    orbitHeight = orbit.clientHeight * .95;
    radius = (orbit.clientWidth < 700 ? orbit.clientWidth * .46 : Math.min(orbit.clientWidth * .18, 240)) * .95;
    dragDistance = Math.max(130, pieces[0].offsetWidth * .72);
    requestRender();
  }

  function select(index) {
    stopIntro();
    clearTimeout(settleTimer);
    wheelOrigin = null;
    target = reduced.matches ? Math.round(index) : index;
    requestRender();
  }

  function settleWheel() {
    if (dragging || wheelOrigin === null) return;
    const delta = target - wheelOrigin;
    let destination = Math.round(target);
    if (destination === Math.round(wheelOrigin) && Math.abs(delta) > .06) destination += Math.sign(delta);
    select(destination);
  }

  // Wheel rotation has its own unbounded position, independent of page scroll.
  addEventListener('wheel', event => {
    if (event.ctrlKey || window.document.querySelector('[data-menu-panel][data-open],dialog[open]') ||
        event.target.closest('input,textarea,select,[contenteditable],.notification,[data-menu-panel],#sf-cookie-root')) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    stopIntro();
    inputMode = 'pointer';
    if (wheelOrigin === null) wheelOrigin = target;
    const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    target += reduced.matches ? Math.sign(pixels) : pixels / 420;
    requestRender();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleWheel, 240);
  }, {passive:false});
  document.addEventListener('pointerdown', () => { inputMode='pointer'; stopIntro(); }, {passive:true, capture:true});
  document.addEventListener('keydown', () => { inputMode='keyboard'; stopIntro(); }, {capture:true});
  previous.addEventListener('click', () => select(Math.round(target) - 1));
  next.addEventListener('click', () => select(Math.round(target) + 1));
  pieces.forEach((piece, index) => piece.addEventListener('click', () => {
    if (!ignoreClick) select(nearest(index));
  }));
  document.querySelector('.collection').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') select(nearest(0));
    else if (event.key === 'End') select(nearest(total - 1));
    else select(Math.round(target) + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1));
  });

  orbit.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    stopIntro();
    inputMode = 'pointer';
    if (event.cancelable) event.preventDefault();
    clearTimeout(settleTimer);
    wheelOrigin = null;
    const capture = event.target.closest('.piece') || orbit;
    capture.setPointerCapture(event.pointerId);
    dragging = {id:event.pointerId, capture, x:event.clientX, y:event.clientY, start:target, last:target, time:event.timeStamp, speed:0, moved:false};
  });
  orbit.addEventListener('pointermove', event => {
    if (!dragging || dragging.id !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    const movement = Math.abs(dx) >= Math.abs(dy) ? -dx : dy;
    if (!dragging.moved && Math.max(Math.abs(dx),Math.abs(dy)) > 6) {
      dragging.moved = true;
      orbit.classList.add('is-dragging');
    }
    if (!dragging.moved) return;
    target = dragging.start + movement / dragDistance;
    const elapsed = event.timeStamp - dragging.time;
    if (elapsed > 0) dragging.speed = (target - dragging.last) / elapsed;
    dragging.last = target;
    dragging.time = event.timeStamp;
    requestRender();
  });
  function release(event) {
    if (!dragging || dragging.id !== event.pointerId) return;
    const {moved, speed, time, capture} = dragging;
    dragging = null;
    orbit.classList.remove('is-dragging');
    if (capture.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId);
    if (!moved) return;
    ignoreClick = true;
    const momentum = !reduced.matches && event.type === 'pointerup' && event.timeStamp - time < 100 ? Math.max(-.65, Math.min(.65, speed * 140)) : 0;
    select(Math.round(target + momentum));
    setTimeout(() => { ignoreClick = false; }, 0);
  }
  orbit.addEventListener('pointerup', release);
  orbit.addEventListener('pointercancel', release);
  orbit.addEventListener('lostpointercapture', release);

  new ResizeObserver(measure).observe(scene);
  addEventListener('resize', measure);
  document.fonts.ready.then(measure);
  reduced.addEventListener('change', () => {
    stopIntro();
    velocity = 0;
    measure();
    select(Math.round(position));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      frame = 0;
      lastFrame = 0;
    } else {
      if (intro && intro.start !== null) intro.start += performance.now() - hiddenAt;
      if (!introStarted) beginIntro();
      requestRender();
    }
  });
  addEventListener('load', beginIntro, {once:true});
  if (document.readyState === 'complete') beginIntro();
  measure();

}
