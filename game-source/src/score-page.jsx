import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {formatPoints, rewardMoney, resultHeadline} from './player-copy';
import {ScoreArtwork} from './score-artwork';
import {mountScoreMesh} from './score-mesh';
import {mountPetalMotion} from './score-petal-motion';
import './score-page.css';

function ScoreScene({children}) {
 const pageRef = useRef(null);
 const artRef = useRef(null);
 const meshRef = useRef(null);

 useEffect(() => {
  const page = pageRef.current;
  const art = artRef.current;
  const surface = meshRef.current;
  const brand = page.querySelector('.coin-brand');
  const canvas = art.querySelector('.art-canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const options = {signal: events.signal};
  const reveal = () => page.classList.remove('wave-intro-pending');
  const mesh = mountScoreMesh(surface, reveal);
  const revealTimeout = setTimeout(reveal, 5500);
  if (reduced.matches || !mesh) reveal();

  function positionButterflies() {
   const range = document.createRange();
   range.selectNodeContents(brand);
   const style = getComputedStyle(brand);
   const transform = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
   const label = range.getBoundingClientRect();
   const box = brand.getBoundingClientRect();
   const stage = canvas.getBoundingClientRect();
   const centerX = label.right - transform.m41 + parseFloat(style.columnGap) + 31;
   const centerY = box.top - transform.m42 + box.height / 2 - 20;
   const anchors = {desktop: [.4589552239, .5450819672], mobile: [.4705882353, .3958333333]};
   for (const [variant, [x, y]] of Object.entries(anchors)) {
    const butterfly = art.querySelector(`.scene-${variant} .purple-butterfly`);
    if (!butterfly.offsetWidth) continue;
    butterfly.style.left = `${centerX - stage.left - butterfly.offsetWidth * x}px`;
    butterfly.style.top = `${centerY - stage.top - butterfly.offsetHeight * y}px`;
   }
   art.classList.add('purple-positioned');
  }

  const intersections = new Map();
  function syncMotion() {
   const visible = selector => [...intersections].some(([node, shown]) => shown && node.matches(selector));
   const plantVisible = visible('.plant-visibility');
   const butterflyVisible = visible('.purple-butterfly');
   art.classList.toggle('reduced-motion', reduced.matches);
   art.classList.toggle('plant-paused', !plantVisible);
   art.classList.toggle('purple-paused', !butterflyVisible);
   art.classList.toggle('ambient-paused', document.hidden || reduced.matches || (!plantVisible && !butterflyVisible));
   if (reduced.matches) reveal();
  }

  const resize = new ResizeObserver(positionButterflies);
  resize.observe(canvas);
  resize.observe(brand);
  const visibility = new IntersectionObserver(entries => {
   for (const entry of entries) intersections.set(entry.target, entry.isIntersecting);
   syncMotion();
  }, {threshold: .01});
  art.querySelectorAll('.plant-visibility,.purple-butterfly').forEach(node => visibility.observe(node));
  document.addEventListener('visibilitychange', syncMotion, options);
  reduced.addEventListener('change', syncMotion, options);
  syncMotion();

  const images = [...art.querySelectorAll('img')];
  let disposePetals = () => {};
  Promise.allSettled([document.fonts.ready, ...images.map(img => img.decode())]).then(() => {
   if (events.signal.aborted) return;
   positionButterflies();
   art.classList.add('motion-ready', 'ambient-active');
   syncMotion();
   disposePetals = mountPetalMotion(art, reduced);
   if (!mesh || reduced.matches || document.hidden) {
    reveal();
    return;
   }
   const bloom = art.querySelector(`${matchMedia('(max-width: 767px)').matches ? '.scene-mobile' : '.scene-desktop'} .right-bloom-origin`);
   const origin = bloom.getBoundingClientRect();
   const bounds = surface.getBoundingClientRect();
   const text = page.querySelector('.reward').getBoundingClientRect();
   mesh.start(origin.left - bounds.left, origin.top - bounds.top, 'opening', {
    left: text.left - bounds.left, right: text.right - bounds.left,
    top: text.top - bounds.top, bottom: text.bottom - bounds.top,
   });
  });

  let touch = null;
  let lastTouch = -Infinity;
  const interactive = event => event.target.closest('button,a');
  const wave = event => {
   const bounds = surface.getBoundingClientRect();
   mesh?.start(event.clientX - bounds.left, event.clientY - bounds.top);
  };
  page.addEventListener('pointerdown', event => {
   if (event.pointerType !== 'mouse' && !interactive(event)) {
    touch = {id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now()};
   }
  }, options);
  const moved = event => Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >= 14;
  page.addEventListener('pointermove', event => {
   if (touch?.id === event.pointerId && moved(event)) touch = null;
  }, options);
  page.addEventListener('pointerup', event => {
   if (event.pointerType === 'mouse') return;
   lastTouch = performance.now();
   if (touch?.id === event.pointerId && !moved(event) && lastTouch - touch.time < 300) wave(event);
   touch = null;
  }, options);
  page.addEventListener('pointercancel', () => { touch = null; }, options);
  page.addEventListener('click', event => {
   if (!interactive(event) && performance.now() - lastTouch >= 500) wave(event);
  }, options);
  surface.addEventListener('keydown', event => {
   if (event.repeat || !['Enter', ' '].includes(event.key)) return;
   event.preventDefault();
   mesh?.start(surface.clientWidth / 2, surface.clientHeight / 2);
  }, options);

  return () => {
   events.abort();
   clearTimeout(revealTimeout);
   resize.disconnect();
   visibility.disconnect();
   disposePetals();
   mesh?.dispose();
  };
 }, []);

 return (
  <div className="score-page wave-intro-pending" ref={pageRef}>
   <div className="mesh-layer" ref={meshRef} role="button" tabIndex={0} aria-label="Reveal the purple mesh">
    <canvas aria-hidden="true" />
    <p className="mesh-caption" aria-hidden="true">
     <span className="mesh-mouse-hint">CLICK TO REVEAL · ENTER / SPACE</span>
     <span className="mesh-touch-hint">TAP TO REVEAL</span>
    </p>
   </div>
   <ScoreArtwork artRef={artRef} />
   <div className="page text-layer">{children}</div>
  </div>
 );
}

export function ScorePage({result, onSave, onReplay, onLeaderboard}) {
 const low = result.points < 10;
 const coins = formatPoints(result.points);
 return (
  <ScoreScene>
   <section className="reward" aria-label="Your unlocked reward">
    <div className="coin-brand">SO/ UNLOCKED</div>
    <div className="headline-pair">
     <div className="headline-left">
      <p className="eyebrow">You've unlocked a facet.</p>
      <h1 id="rewards-heading" tabIndex={-1}>{low ? resultHeadline(result.points) : <><span>HERE’S</span><span>what’s yours.</span></>}</h1>
     </div>
     <div className="headline-right">
      <div className={`amount-line${coins.length > 6 ? ' long-amount' : ''}`} id="rewards-score">
       <span className="amount" id="rewards-points">{coins}</span><span className="coins">SO/ COINS</span>
      </div>
      {low
       ? <p className="conversion" id="rewards-low-copy">Play again. Every 10 SO/ COINS is ₹1 off <span className="wordmark">SO/ FACET</span> diamond jewellery.</p>
       : <p className="conversion" id="rewards-value-line">That's <span id="rewards-value">{rewardMoney(result.points)}</span> off <span className="wordmark">SO/FACET</span> diamond jewellery.</p>}
     </div>
    </div>
    <hr className="rule" />
    {!low && <p className="notice" id="rewards-expiry">Unsaved SO/ COINS disappear when you leave this page.</p>}
    <div className="buttons">
     {!low && <button className="btn" type="button" id="rewards-register" onClick={onSave}>
      SAVE MY SO/ COINS <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" /></svg>
     </button>}
     <button className="btn" type="button" id="rewards-retry" onClick={onReplay}>
      PLAY AGAIN <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 10V4m0 6h6M5 10a8 8 0 1 1-1 6" /></svg>
     </button>
    </div>
    <button className="coin-leaderboard" id="rewards-leaderboard" type="button" onClick={onLeaderboard}>SEE FULL LEADERBOARD</button>
   </section>
  </ScoreScene>
 );
}

export function mountScorePage(container, actions) {
 const root = createRoot(container);
 return {
  render(result) { flushSync(() => root.render(<ScorePage result={result} {...actions} />)); },
  clear() { flushSync(() => root.render(null)); },
 };
}
