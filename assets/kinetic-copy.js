import { gsap, SplitText } from '../vendor/gsap/gsap-text.js';
gsap.registerPlugin(SplitText);

const FPS = 60;
const ENTER = .62;
const EXIT = .48;
const STAGGER = .16;

export async function createLandingCopy() {
  // WebKit can hold fonts.ready until a stalled video finishes the document load.
  await Promise.all(['700 16px Acumin','400 16px Acumin'].map(font => document.fonts.load(font))).catch(() => {});
  const root = document.querySelector('#story-copy');
  // The existing copy and frame attributes remain the editable source for this array.
  const headlines = [...root.querySelectorAll('.story-line')].map(element => ({
    element, heading: element.querySelector('h1,h2'), detail: element.querySelector('p'),
    from: Number(element.dataset.from), until: Number(element.dataset.until ?? Infinity),
  }));
  const timelines = new Map();
  const media = gsap.matchMedia();
  let frame = 0, reduced = false;

  function paint() {
    for (const { element, from, until } of headlines) {
      const active = frame >= from && frame < until;
      element.setAttribute('aria-hidden', String(!active));
      element.style.visibility = active ? 'visible' : 'hidden';
    }
    for (const timeline of timelines.values()) timeline.time(frame / FPS, true);
  }

  media.add({ all: 'all', reduce: '(prefers-reduced-motion: reduce)' }, context => {
    reduced = context.conditions.reduce;
    if (!reduced) {
      for (const { element: section, heading, detail, from, until } of headlines) {
        const opening = section === headlines[0].element;
        const revealRate = opening ? .9 : 1;
        const handoffDelay = section === headlines[1].element ? .28 : 0;
        const parts = heading.children.length ? [...heading.children] : [heading];
        const label = heading.getAttribute('aria-label');
        heading.setAttribute('aria-label', heading.textContent.replace(/\s+/g, ' ').trim());
        context.add(() => () => label === null ? heading.removeAttribute('aria-label') : heading.setAttribute('aria-label', label));
        const targets = [...parts.map(element => ({ element, supporting: false })), ...(detail ? [{ element: detail, supporting: true }] : [])];
        for (const { element, supporting } of targets) {
          const readable = element.textContent.replace(/\s+/g, ' ').trim();
          SplitText.create(element, {
            type: supporting ? 'lines' : 'lines,chars', mask: 'lines', linesClass: 'kinetic-line', charsClass: 'kinetic-char',
            autoSplit: true, aria: supporting ? 'none' : element === heading ? 'auto' : 'hidden',
            onRevert() { element.classList.remove('kinetic-ready'); },
            onSplit(split) {
              element.classList.add('kinetic-ready');
              if (supporting) {
                split.masks.forEach(mask => mask.setAttribute('aria-hidden', 'true'));
                const accessible = document.createElement('span');
                accessible.className = 'kinetic-sr';
                accessible.textContent = readable;
                element.append(accessible);
              }
              const pieces = supporting ? split.lines : split.chars;
              const stagger = { amount: (supporting ? .08 : STAGGER) / revealRate };
              const timeline = gsap.timeline({ paused: true, defaults: { ease: 'power3.inOut' } });
              timeline.fromTo(pieces, { yPercent: 115, opacity: .35 }, {
                yPercent: 0, opacity: 1, duration: (supporting ? .52 : ENTER) / revealRate, stagger,
              }, from / FPS + handoffDelay + (supporting ? .14 / revealRate : 0));
              if (Number.isFinite(until)) {
                const end = until / FPS - EXIT - STAGGER;
                timeline.to(pieces, { yPercent: -115, opacity: .2, duration: EXIT, stagger: { amount: supporting ? .08 : STAGGER } }, end);
              }
              timelines.set(element, timeline);
              timeline.time(frame / FPS, true);
              return timeline;
            },
          });
        }
      }
    }
    paint();
    return () => timelines.clear();
  }, root);

  const update = nextFrame => { frame = nextFrame; paint(); };
  const onPageHide = event => { if (!event.persisted) update.destroy(); };
  update.destroy = () => { media.revert(); window.removeEventListener('pagehide', onPageHide); };
  window.addEventListener('pagehide', onPageHide);
  return update;
}
