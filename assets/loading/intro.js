import { mountReveal } from './reveal.js';

const overlay = document.querySelector('#site-loader');
const stage = overlay?.querySelector('#loading-stage');
const skipIntro = document.documentElement.hasAttribute('data-skip-intro');
let cleanup;
const revealed = new Promise(resolve => {
  if (!stage || skipIntro) return resolve();
  cleanup = mountReveal(stage, resolve);
});
let handoff;
export function finishLoading({ready}={}) {
  return handoff ||= (async () => {
    if(ready)overlay?.setAttribute('data-preparing','');
    await revealed;
    if(ready){
      overlay?.setAttribute('data-waiting','');
      await ready;
      overlay?.removeAttribute('data-waiting');
      overlay?.removeAttribute('data-preparing');
    }
    if (!overlay) return;
    cleanup?.();
    overlay.classList.add('leaving');
    if (!skipIntro && !matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 450));
    const heldFocus = overlay.contains(document.activeElement);
    overlay.remove();
    document.body.removeAttribute('data-loading');
    const main = document.querySelector('main');
    main.inert = false;
    main.removeAttribute('aria-hidden');
    if (heldFocus) { main.tabIndex = -1; main.focus({ preventScroll: true }); }
  })();
}
