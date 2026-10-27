import './controls-tutorial.css';
import {Box3, Vector3} from 'three';
import type {TableView} from './renderer';
import {TutorialState, hasPractised, rememberPractice} from './tutorial-state';
import type {PracticeControl} from './tutorial-state';

export function connectControlsTutorial(view: TableView, viewport: HTMLElement, panel: HTMLElement, onPress: (side: 'left' | 'right') => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'controls-tutorial';
  dialog.setAttribute('aria-labelledby', 'practice-title');
  dialog.setAttribute('aria-describedby', 'practice-copy');
  dialog.innerHTML = `
    <div class="practice-table">
      <button type="button" class="practice-zone" data-control="left" aria-label="Try the left flipper"><span>← LEFT SIDE</span></button>
      <button type="button" class="practice-zone" data-control="right" aria-label="Try the right flipper"><span>RIGHT SIDE →</span></button>
    </div>
    <div class="practice-marker" aria-hidden="true"><span></span><i></i></div>
    <section class="practice-card">
      <div class="practice-topline"><span>QUICK PRACTICE</span><button type="button" class="practice-skip">Skip guide ↗</button></div>
      <ol class="practice-steps" aria-label="Practice progress"><li>01</li><li>02</li><li>03</li></ol>
      <h2 id="practice-title"></h2><p id="practice-copy"></p>
      <div class="practice-keys" aria-hidden="true"></div>
      <button type="button" class="practice-launch" data-control="launch" aria-label="Hold to charge, then release" aria-pressed="false" hidden><span>Hold to charge · release to launch</span><i></i></button>
      <p class="practice-feedback" role="status" aria-live="polite"></p>
      <button type="button" class="practice-next" disabled>Try the highlighted side</button>
      <p class="practice-note">Just practice. Your three balls are waiting.</p>
    </section>`;
  document.body.append(dialog);
  const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const table = get('.practice-table'), card = get('.practice-card'), marker = get('.practice-marker');
  const title = get('#practice-title'), copy = get('#practice-copy'), keys = get('.practice-keys');
  const feedback = get('.practice-feedback'), next = get<HTMLButtonElement>('.practice-next');
  const skip = get<HTMLButtonElement>('.practice-skip'), launch = get<HTMLButtonElement>('.practice-launch');
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-control]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(any-pointer: coarse)');
  const bounds = new Box3(), point = new Vector3();
  let viewportRect = viewport.getBoundingClientRect();
  let state = new TutorialState(), elapsed = 0, amount = 0, tapUntil = 0, input: string | null = null;
  let afterClose: ((result: 'complete' | 'skip' | 'cancel') => void) | undefined;
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Storage is optional. */ }

  function refresh() {
    view.needsRender = true;
    const control = state.control, isLaunch = control === 'launch';
    dialog.dataset.step = control;
    dialog.dataset.tried = String(state.tried);
    title.textContent = isLaunch ? 'Ready. Set. Launch.' : control === 'left' ? 'Left side. Your move.' : 'Now, the right side.';
    copy.textContent = isLaunch ? 'Hold to pull back the spring. Release to send the ball into play.' : `Press the highlighted ${control} half and watch that flipper lift. Release to lower it.`;
    keys.innerHTML = isLaunch ? '<kbd>SPACE</kbd><span>hold + release</span>' : control === 'left' ? '<kbd>A</kbd><span>or</span><kbd>←</kbd>' : '<kbd>D</kbd><span>or</span><kbd>→</kbd>';
    keys.hidden = coarse.matches;
    launch.hidden = !isLaunch;
    buttons.forEach(button => { button.disabled = button.dataset.control !== control; button.setAttribute('aria-pressed', String(state.held && button.dataset.control === control)); });
    dialog.querySelectorAll('.practice-steps li').forEach((step, index) => {
      step.classList.toggle('is-done', index < state.index);
      if (index === state.index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    feedback.textContent = state.held ? isLaunch ? 'Keep holding… then release.' : 'That’s it. Release to lower it.' : state.tried ? isLaunch ? 'Nice. You’re ready to play.' : 'Got it. One flipper at a time.' : isLaunch ? 'Try holding for a moment.' : 'Your turn — give it a tap.';
    next.disabled = !state.tried || state.held;
    next.textContent = !state.tried ? isLaunch ? 'Try the launcher first' : 'Try the highlighted side' : isLaunch ? 'Start game →' : state.index === 0 ? 'Next: right side →' : 'Next: launch →';
    if (dialog.dataset.mode === 'replay' && isLaunch && state.tried) next.textContent = 'Back to game →';
    if (dialog.open) layout();
  }
  function press(control: PracticeControl, token: string) {
    if (!dialog.open || input !== null || !state.press(control)) return;
    input = token;
    if (control !== 'launch') onPress(control);
    refresh();
  }
  function release(token: string | null, cancelled = false) {
    if (token !== input) return;
    const succeeded = state.release(cancelled); input = null;
    // A quick tap still gives a visible full lift, even between two render frames.
    tapUntil = succeeded && state.control !== 'launch' ? elapsed + .16 : 0;
    if (dialog.open) refresh();
  }
  function finish(result: 'complete' | 'skip' | 'cancel') {
    if (!dialog.open) return;
    release(input, true);
    if (result !== 'cancel') rememberPractice(storage);
    dialog.close();
    document.body.classList.remove('practising-controls');
    view.needsRender = true;
    const callback = afterClose; afterClose = undefined;
    callback?.(result);
  }
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const token = `pointer:${event.pointerId}`;
      press(button.dataset.control as PracticeControl, token);
      if (input === token) button.setPointerCapture(event.pointerId);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, event => {
      const e = event as PointerEvent;
      release(`pointer:${e.pointerId}`, eventName !== 'pointerup');
      if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
    });
    // Assistive technology can activate a button without sending pointer/key events.
    button.addEventListener('click', event => {
      if (event.detail !== 0 || state.held) return;
      press(button.dataset.control as PracticeControl, 'assistive');
      if (state.control === 'launch') state.tick(.4);
      release('assistive');
    });
  }
  function controlFor(event: KeyboardEvent): PracticeControl | undefined {
    if (['KeyA', 'ArrowLeft'].includes(event.code)) return 'left';
    if (['KeyD', 'ArrowRight'].includes(event.code)) return 'right';
    const target = event.target as HTMLElement;
    if (['Space', 'Enter'].includes(event.code) && target.matches('[data-control]')) return target.dataset.control as PracticeControl;
    if (event.code === 'Space' && !target.matches('button')) return 'launch';
  }
  for (const type of ['keydown', 'keyup']) dialog.addEventListener(type, event => {
    const e = event as KeyboardEvent, control = controlFor(e);
    if (!control) return;
    e.preventDefault(); e.stopPropagation();
    if (type === 'keyup') release(`key:${e.code}`);
    else if (!e.repeat) press(control, `key:${e.code}`);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
  next.onclick = () => {
    if (!state.tried || state.held) return;
    if (state.next()) { finish('complete'); return; }
    elapsed = 0; amount = 0; tapUntil = 0; refresh();
    buttons.find(button => button.dataset.control === state.control)?.focus({preventScroll: true});
  };
  skip.onclick = () => finish('skip');

  function layout() {
    const rect = viewport.getBoundingClientRect(), side = panel.getBoundingClientRect();
    viewportRect = rect;
    const stacked = side.top >= rect.bottom - 24;
    const width = Math.min(stacked ? 460 : Math.max(290, side.width), innerWidth - 32);
    card.style.width = `${width}px`;
    card.style.left = `${Math.max(16, Math.min(innerWidth - width - 16, stacked ? (innerWidth - width) / 2 : side.left))}px`;
    const height = card.offsetHeight;
    const top = Math.max(12, Math.min(innerHeight - height - 12, stacked ? side.top - 8 : side.top + (side.height - height) / 2));
    card.style.top = `${top}px`;
    Object.assign(table.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${stacked ? Math.min(rect.height, Math.max(0, top - rect.top - 8)) : rect.height}px`});
  }
  // Keep layout reads out of the animation loop; only projection changes each frame.
  const resize = new ResizeObserver(() => { if (dialog.open) layout(); });
  resize.observe(viewport); resize.observe(panel); resize.observe(card);
  return {
    get active() { return dialog.open; },
    get seen() { return hasPractised(storage); },
    open(mode: 'onboarding' | 'replay', callback: (result: 'complete' | 'skip' | 'cancel') => void) {
      if (dialog.open) return;
      state = new TutorialState(); elapsed = 0; amount = 0; tapUntil = 0; input = null; afterClose = callback;
      dialog.dataset.mode = mode; skip.textContent = mode === 'replay' ? 'Close guide ↗' : 'Skip guide ↗';
      get('.practice-note').textContent = mode === 'replay' ? 'Your game is paused. No points or lives used.' : 'Just practice. Your three balls are waiting.';
      document.body.classList.add('practising-controls');
      refresh(); dialog.showModal(); layout();
      buttons[0].focus({preventScroll: true});
    },
    cancelHold() { release(input, true); },
    update(delta: number) {
      if (!dialog.open) return;
      elapsed += delta; state.tick(delta);
      const demo = !reducedMotion.matches && !state.tried && !state.held;
      const wave = Math.max(0, Math.sin(elapsed * 3.2));
      const target = state.held ? state.control === 'launch' ? state.charge : 1 : elapsed < tapUntil ? 1 : demo ? wave * .8 : 0;
      const previousAmount = amount;
      amount = reducedMotion.matches ? target : amount + (target - amount) * (1 - Math.exp(-delta * 24));
      for (const paddle of view.manifest.calibration.paddles) view.updatePaddle(paddle.game_id, paddle.game_id === `flipper_${state.control}` ? paddle.up_angle_degrees * Math.PI / 180 * amount : 0);
      view.updateSpring(state.control === 'launch' ? amount : 0);
      launch.style.setProperty('--practice-charge', String(state.held ? state.charge : 0));
      const id = state.control === 'launch' ? view.manifest.calibration.spring.render_groups[0] : `flipper_${state.control}`;
      const object = view.groups.get(id)?.[0];
      marker.hidden = !object;
      if (object) {
        object.updateWorldMatrix(true, true); bounds.setFromObject(object); bounds.getCenter(point);
        point.project(view.activeCamera);
        const rect = viewportRect;
        marker.style.left = `${rect.left + (point.x + 1) / 2 * rect.width}px`;
        marker.style.top = `${rect.top + (1 - point.y) / 2 * rect.height}px`;
        marker.classList.toggle('is-held', state.held);
      }
      if (Math.abs(previousAmount - amount) > .00001) view.needsRender = true;
    },
  };
}
