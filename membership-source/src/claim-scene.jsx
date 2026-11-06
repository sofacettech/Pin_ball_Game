import React, {useEffect, useLayoutEffect, useRef} from 'react';
import {mountScoreMesh} from '../../game-source/src/score-mesh';

const artwork = '/assets/membership/claim/';

const flightTiming = {
 red: {duration: 6000, delay: 100},
 cyan: {duration: 4800, delay: 400},
 yellow: {duration: 6600, delay: 650},
};

function flightFrames(node, color) {
 const {left, top, width, height} = node.getBoundingClientRect();
 const style = getComputedStyle(node);
 const [hx,hy] = style.getPropertyValue('--hinge').trim().split(/\s+/).map(value => parseFloat(value)/100);
 const axis = style.getPropertyValue('--axis');
 const x = left + width*hx, y = top + height*hy, W = innerWidth, H = innerHeight;
 const rise = H-y, end = [x,y];
 let curves;
 if (color === 'red') {
  const mid = [x*.54,y+rise*.6];
  curves = [[[W*.025,H+height],[W*.09,H*.91],[mid[0]-x*.15,mid[1]+rise*.1],mid],
   [mid,[mid[0]+x*.15,mid[1]-rise*.1],[x-W*.035,y+H*.16],end]];
 } else if (color === 'cyan') {
  curves = [[[W+width,y+H*.2],[W*.985,y+H*.19],[x+W*.025,y+H*.1],end]];
 } else {
  const mid = [W*.67,y+rise*.57];
  curves = [[[W*.94,H+height],[W*.82,H*.97],[mid[0]+W*.075,mid[1]+H*.13],mid],
   [mid,[mid[0]-W*.1,mid[1]-H*.14],[x+W*.035,y+H*.15],end]];
 }
 // Sample the curves by distance so the two segments share the same travel speed.
 let distance = 0, previous;
 const samples = curves.flatMap(curve => Array.from({length: 61}, (_, index) => {
  const t = index/60, s = 1-t;
  const point = curve[0].map((_, i) => s**3*curve[0][i]+3*s*s*t*curve[1][i]+3*s*t*t*curve[2][i]+t**3*curve[3][i]);
  if (previous) distance += Math.hypot(point[0]-previous[0],point[1]-previous[1]);
  previous = point;
  return {point, distance};
 }));
 const arrival = [], leftWing = [], rightWing = [];
 let next = 1;
 for (let i = 0; i <= 120; i++) {
  const t = i/120, progress = (.5-.5*Math.cos(Math.PI*t))*distance;
  while (next < samples.length-1 && samples[next].distance < progress) next++;
  const a = samples[next-1], b = samples[next];
  const u = (progress-a.distance)/(b.distance-a.distance||1);
  const [px,py] = a.point.map((v,k) => v+(b.point[k]-v)*u);
  const swell = Math.sin(Math.PI*t);
  const fold = (.5-.5*Math.cos(12*Math.PI*t))*(1-.5*t);
  const bank = (color === 'cyan' ? 14 : -18)*swell;
  arrival.push({offset:t,transform:`translate3d(${px-x}px,${py-y-1.4*fold*swell}px,0) rotate(${bank}deg)`});
  leftWing.push({offset:t,transform:`rotate3d(${axis},${(color==='yellow'?49.3:42)*fold}deg)`});
  rightWing.push({offset:t,transform:`rotate3d(${axis},${(color==='yellow'?-53.9:-46)*fold}deg)`});
 }
 return [arrival,leftWing,rightWing];
}

export function ClaimButterfly({color, revealed}) {
 const butterfly = useRef(null);
 useLayoutEffect(() => {
  if (!revealed) return;
  const node = butterfly.current;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (!node.animate || reduced.matches) {node.classList.add('is-settled');return;}
  const parts = node.querySelectorAll('.claim-butterfly-flight,.claim-wing-left,.claim-wing-right');
  const frames = flightFrames(node, color);
  const animations = [...parts].map((part,i) => part.animate(frames[i],{...flightTiming[color],fill:'both'}));
  const sync = () => {
   for (const animation of animations) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    if (reduced.matches) animation.finish();
    else if (document.hidden) animation.pause();
    else if (animation.playState === 'paused') animation.play();
   }
  };
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);
  sync();
  Promise.all(animations.map(animation => animation.finished)).then(() => {
   node.classList.add('is-settled');
   animations.forEach(animation => animation.cancel());
  }).catch(() => {});
  return () => {
   document.removeEventListener('visibilitychange',sync);
   reduced.removeEventListener('change',sync);
   animations.forEach(animation => animation.cancel());
  };
 }, [color,revealed]);
 return (
  <span className={`claim-butterfly claim-butterfly-${color}${revealed?' is-revealed':''}`} ref={butterfly} aria-hidden="true">
   <span className="claim-butterfly-flight"><span className="claim-butterfly-hover">
    {['left', 'right', 'body'].map(part => (
     <img key={part} className={`claim-wing-${part}`} alt=""
      src={`${artwork}${color}-${part}-320.webp`}
      srcSet={`${artwork}${color}-${part}-320.webp 1x, ${artwork}${color}-${part}-640.webp 2x`} />
    ))}
   </span></span>
  </span>
 );
}

export function ClaimScene({contentRef, revealed, onReveal}) {
 const surface = useRef(null);
 const trigger = useRef(null);
 const artworkRef = useRef(null);
 useEffect(() => {
  const layer = surface.current;
  const fallback = setTimeout(() => onReveal(true), 3000);
  const reveal = () => {clearTimeout(fallback); onReveal(true);};
  const mesh = mountScoreMesh(layer, reveal);
  if (!mesh) {reveal(); return;}
  const input = new AbortController();
  const options = {signal: input.signal};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const center = () => mesh.start(layer.clientWidth / 2, layer.clientHeight / 2);
  trigger.current.addEventListener('click', center, options);
  document.addEventListener('click', event => {
   if (!(event.target instanceof Element) || event.target.closest('button, a, input, select, label, dialog')) return;
   mesh.start(event.clientX, event.clientY);
  }, options);
  reduced.addEventListener('change', event => {if(event.matches)reveal();}, options);
  let frame = 0, disposed = false, fontTimer;
  const start = () => {
   if (disposed) return;
   frame = requestAnimationFrame(() => {
   const content = contentRef.current;
   if (reduced.matches || !content) {reveal(); return;}
   const art = artworkRef.current.getBoundingClientRect();
   const area = content.getBoundingClientRect();
   const x = Math.max(0,Math.min(layer.clientWidth - 20,art.left + art.width * .55));
   const y = Math.max(0,Math.min(layer.clientHeight - 20,art.top + art.height * .65));
   mesh.start(x,y,'opening',area);
   });
  };
  if (reduced.matches) reveal();
  else Promise.race([document.fonts.ready,new Promise(resolve=>{fontTimer=setTimeout(resolve,350);})]).then(start);
  return () => {disposed=true; clearTimeout(fallback); clearTimeout(fontTimer); input.abort(); cancelAnimationFrame(frame); mesh.dispose();};
 }, [contentRef,onReveal]);
 return <>
  <div className="claim-mesh" ref={surface} aria-hidden="true"><canvas /></div>
  <div className="claim-art-clip" aria-hidden="true">
   <div className={'claim-art'+(revealed?' is-revealed':'')} ref={artworkRef}>
    <div className="claim-crystal-arrival"><img className="claim-crystal" src={artwork + 'amethyst.png'} alt="" width="824" height="873"/></div>
    <ClaimButterfly color="red" revealed={revealed}/>
    <ClaimButterfly color="cyan" revealed={revealed}/>
   </div>
  </div>
  <button className="claim-mesh-trigger" ref={trigger} type="button" aria-label="Reveal the purple mesh" />
 </>;
}
