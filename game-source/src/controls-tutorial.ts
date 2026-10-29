import './controls-tutorial.css';
import {Box3, Vector3} from 'three';
import type {TableView} from './renderer';
import {TutorialState, createTutorialHistory} from './tutorial-state';
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
      <ol class="practice-steps" aria-label="Practice progress"><li>01</li><li>02</li></ol>
      <h2 id="practice-title"></h2><p id="practice-copy"></p>
      <div class="practice-keys" aria-hidden="true"></div>
      <p class="practice-feedback" role="status" aria-live="polite"></p>
      <p class="practice-note">Just practice. Your three balls are waiting.</p>
    </section>`;
  document.body.append(dialog);
  const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const table = get('.practice-table'), card = get('.practice-card'), marker = get('.practice-marker');
  const title = get('#practice-title'), copy = get('#practice-copy'), keys = get('.practice-keys');
  const feedback = get('.practice-feedback');
  const skip = get<HTMLButtonElement>('.practice-skip');
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-control]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(any-pointer: coarse)');
  const bounds = new Box3(), point = new Vector3();
  let viewportRect = viewport.getBoundingClientRect();
  let state = new TutorialState(), elapsed = 0, amount = 0, tapUntil = 0, input: string | null = null;
  let afterClose: ((result: 'complete' | 'skip' | 'cancel') => void) | undefined;
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Storage is optional. */ }
  const history = createTutorialHistory(storage);

  function refresh() {
    view.needsRender = true;
    const control = state.control;
    dialog.dataset.step = control;
    dialog.dataset.tried = String(state.tried);
    title.textContent = control === 'left' ? 'Left side. Your move.' : 'Now, the right side.';
    copy.textContent = `Press the highlighted ${control} half and watch that flipper lift. Release to lower it.`;
    keys.innerHTML = control === 'left' ? '<kbd>A</kbd><span>or</span><kbd>←</kbd>' : '<kbd>D</kbd><span>or</span><kbd>→</kbd>';
    keys.hidden = coarse.matches;
    buttons.forEach(button => { button.disabled = button.dataset.control !== control; button.setAttribute('aria-pressed', String(state.held && button.dataset.control === control)); });
    dialog.querySelectorAll('.practice-steps li').forEach((step, index) => {
      step.classList.toggle('is-done', index < state.index);
      if (index === state.index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    feedback.textContent = state.held ? 'That’s it. Release to lower it.' : state.tried ? control === 'right' ? dialog.dataset.mode === 'replay' ? 'Ready. Returning to your game…' : 'Ready. Starting your game…' : 'Got it. Moving on…' : 'Tap once to try it and move on.';
    if (dialog.open) layout();
  }
  function press(control: PracticeControl, token: string) {
    if (!dialog.open || input !== null || !state.press(control)) return;
    input = token;
    onPress(control);
    refresh();
  }
  function release(token: string | null, cancelled = false) {
    if (token !== input) return;
    const succeeded = state.release(cancelled); input = null;
    // A quick tap still gives a visible full lift, even between two render frames.
    tapUntil = succeeded ? elapsed + .16 : 0;
    if (dialog.open) refresh();
  }
  function finish(result: 'complete' | 'skip' | 'cancel') {
    if (!dialog.open) return;
    release(input, true);
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
      if (input !== 'assistive') return;
      release('assistive');
    });
  }
  function controlFor(event: KeyboardEvent): PracticeControl | undefined {
    if (['KeyA', 'ArrowLeft'].includes(event.code)) return 'left';
    if (['KeyD', 'ArrowRight'].includes(event.code)) return 'right';
    const target = event.target as HTMLElement;
    if (['Space', 'Enter'].includes(event.code) && target.matches('[data-control]')) return target.dataset.control as PracticeControl;
  }
  for (const type of ['keydown', 'keyup']) dialog.addEventListener(type, event => {
    const e = event as KeyboardEvent, control = controlFor(e);
    if (!control) return;
    e.preventDefault(); e.stopPropagation();
    if (type === 'keyup') release(`key:${e.code}`);
    else if (!e.repeat) press(control, `key:${e.code}`);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
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
    get seen() { return history.seen; },
    open(mode: 'onboarding' | 'replay', callback: (result: 'complete' | 'skip' | 'cancel') => void) {
      if (dialog.open) return;
      state = new TutorialState(); elapsed = 0; amount = 0; tapUntil = 0; input = null; afterClose = callback;
      dialog.dataset.mode = mode; skip.textContent = mode === 'replay' ? 'Close guide ↗' : 'Skip guide ↗';
      get('.practice-note').textContent = mode === 'replay' ? 'Your game is paused. No points or lives used.' : 'Just practice. Your three balls are waiting.';
      document.body.classList.add('practising-controls');
      refresh(); dialog.showModal(); layout();
      // Mark the first display, including users who dismiss or reload mid-guide.
      history.markShown();
      buttons[0].focus({preventScroll: true});
    },
    cancelHold() { release(input, true); },
    update(delta: number) {
      if (!dialog.open) return;
      elapsed += delta;
      const progress = state.tick(delta);
      if (progress === 'complete') { finish('complete'); return; }
      if (progress === 'advanced') {
        elapsed = 0; amount = 0; tapUntil = 0; refresh();
        buttons.find(button => button.dataset.control === state.control)?.focus({preventScroll: true});
      }
      const demo = !reducedMotion.matches && !state.tried && !state.held;
      const wave = Math.max(0, Math.sin(elapsed * 3.2));
      const target = state.held ? 1 : elapsed < tapUntil ? 1 : demo ? wave * .8 : 0;
      const previousAmount = amount;
      amount = reducedMotion.matches ? target : amount + (target - amount) * (1 - Math.exp(-delta * 24));
      for (const paddle of view.manifest.calibration.paddles) view.updatePaddle(paddle.game_id, paddle.game_id === `flipper_${state.control}` ? paddle.up_angle_degrees * Math.PI / 180 * amount : 0);
      const id = `flipper_${state.control}`;
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
