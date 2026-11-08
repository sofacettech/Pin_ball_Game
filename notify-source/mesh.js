import {referenceMesh} from './mesh-topology.js';
export function initializeMesh(scope){
 const {document,window,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,addEventListener,matchMedia,ResizeObserver}=scope;

  const surface = document.getElementById('mesh-background');
  const scene = document.getElementById('scene');
  const canvas = surface.querySelector('canvas');
  const ctx = canvas.getContext('2d', {alpha:false});
  if (!ctx) return;
  const background = document.createElement('canvas');
  const bg = background.getContext('2d');
  if (!bg) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const excluded = 'a,button,input,select,textarea,label,.intro,.notification,.site-header,.site-footer,.collection-controls,.scroll-cue';
  let width = 1, height = 1, scale = 1, triangles = [], segments = [];
  let waves = [], down = null, frame = 0, openingPlayed = false;
  const sweep = 2100, tail = 1100;

  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(render);
  }

  function resize() {
    const nextWidth = Math.max(1, surface.clientWidth);
    const nextHeight = Math.max(1, surface.clientHeight);
    if (triangles.length && nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    scale = Math.min(devicePixelRatio || 1, 1.5);
    for (const layer of [canvas,background]) {
      layer.width = Math.ceil(width * scale);
      layer.height = Math.ceil(height * scale);
    }
    bg.setTransform(scale,0,0,scale,0,0);
    bg.fillStyle = '#08040c';
    bg.fillRect(0,0,width,height);
    for (const [x,y,radius,color] of [
      [width*.5,height*.16,Math.max(width,height)*.63,'rgba(20,5,28,.40)'],
      [width*.61,height*.72,Math.max(width,height)*.49,'rgba(22,5,31,.40)']
    ]) {
      const gradient = bg.createRadialGradient(x,y,0,x,y,radius);
      gradient.addColorStop(0,color);
      gradient.addColorStop(1,'rgba(20,5,28,0)');
      bg.fillStyle = gradient;
      bg.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    // Keep the account page's facet proportions, cropping on narrower screens.
    const factor = Math.max(width / 1672, height / 941);
    const points = referenceMesh.points.map(([x, y]) => ({
      x:x * factor + (width - 1672 * factor) / 2,
      y:y * factor + (height - 941 * factor) / 2
    }));
    let seed = 21987;
    triangles = referenceMesh.triangles.map(indices => {
      const vertices = indices.map(i => points[i]);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return {vertices, x:vertices.reduce((sum,p) => sum+p.x,0)/3,
        y:vertices.reduce((sum,p) => sum+p.y,0)/3, shade:seed/4294967296};
    });
    segments = referenceMesh.edges.flatMap(([a, b]) => {
      const A = points[a], B = points[b];
      const steps = Math.max(1, Math.ceil(Math.hypot(B.x-A.x, B.y-A.y) / 14));
      return Array.from({length:steps}, (_,i) => ({
        x1:A.x+(B.x-A.x)*i/steps, y1:A.y+(B.y-A.y)*i/steps,
        x2:A.x+(B.x-A.x)*(i+1)/steps, y2:A.y+(B.y-A.y)*(i+1)/steps,
        x:A.x+(B.x-A.x)*(i+.5)/steps, y:A.y+(B.y-A.y)*(i+.5)/steps
      }));
    });
    waves = [];
    schedule();
  }

  function createWave(x, y, delay = 0) {
    return {x, y, start:performance.now() + delay, reach:Math.max(
      Math.hypot(x,y), Math.hypot(width-x,y),
      Math.hypot(x,height-y), Math.hypot(width-x,height-y))};
  }

  function start(x, y) {
    if (surface.dataset.opening === 'running') surface.dataset.opening = 'interrupted';
    waves = [createWave(x,y)];
    surface.dataset.waveCount = String(Number(surface.dataset.waveCount || 0) + 1);
    surface.dataset.waveOrigin = `${Math.round(x)},${Math.round(y)}`;
    schedule();
  }

  function opening() {
    if (openingPlayed || document.hidden) return;
    openingPlayed = true;
    if (reduced.matches) { surface.dataset.opening = 'skipped'; return; }
    waves = [createWave(0,height), createWave(width,0,320)];
    surface.dataset.opening = 'running';
    surface.dataset.openingOrigins = 'bottom-left,top-right';
    surface.dataset.waveCount = String(Number(surface.dataset.waveCount || 0) + 2);
    schedule();
  }

  function strength(wave, x, y, elapsed) {
    const distance = Math.hypot(x-wave.x, y-wave.y);
    if (reduced.matches) return Math.max(0, 1-distance/(Math.max(width,height)*.42)) * .65;
    const age = elapsed - distance / Math.max(1,wave.reach) * sweep;
    if (age <= 0 || age >= tail) return 0;
    if (age < 150) { const t=age/150; return t*t*(3-2*t); }
    if (age < 330) return 1;
    const t = (age-330)/(tail-330);
    return 1-t*t*(3-2*t);
  }

  function render(now) {
    frame = 0;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(background,0,0);
    ctx.setTransform(scale,0,0,scale,0,0);
    surface.dataset.animating = 'false';
    if (!reduced.matches) waves = waves.filter(wave => now-wave.start < sweep+tail);
    if (!waves.length) {
      if (surface.dataset.opening === 'running') surface.dataset.opening = 'complete';
      return;
    }
    // Use the stronger wave, rather than adding brightness where they cross.
    const lightAt = (x,y) => waves.reduce((light,wave) => Math.max(light,strength(wave,x,y,now-wave.start)),0);
    ctx.save();
    if (!reduced.matches) {
      ctx.beginPath();
      for (const wave of waves) {
        const radius = Math.max(0,(now-wave.start)/sweep*wave.reach);
        if (!radius) continue;
        ctx.moveTo(wave.x+radius,wave.y);
        ctx.arc(wave.x,wave.y,radius,0,Math.PI*2);
      }
      ctx.clip();
    }
    for (const triangle of triangles) {
      const light = lightAt(triangle.x,triangle.y);
      if (light < .001) continue;
      const [A,B,C] = triangle.vertices;
      ctx.beginPath();
      ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineTo(C.x,C.y); ctx.closePath();
      const alpha = light * (.30 + triangle.shade * .25);
      const gradient = ctx.createLinearGradient(A.x,A.y,(B.x+C.x)/2,(B.y+C.y)/2);
      gradient.addColorStop(0,`rgba(68,10,87,${alpha})`);
      gradient.addColorStop(1,`rgba(48,6,66,${alpha*.5})`);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    for (const segment of segments) {
      const light = lightAt(segment.x,segment.y);
      if (light < .001) continue;
      ctx.beginPath(); ctx.moveTo(segment.x1,segment.y1); ctx.lineTo(segment.x2,segment.y2);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgba(77,16,108,${light*.09})`;
      ctx.stroke();
      ctx.lineWidth = .7;
      ctx.strokeStyle = `rgba(85,22,112,${light*.68})`;
      ctx.stroke();
    }
    ctx.restore();
    if (!reduced.matches) { surface.dataset.animating='true'; schedule(); }
  }

  function clear() {
    waves = [];
    if (surface.dataset.opening === 'running') surface.dataset.opening = 'interrupted';
    down = null;
    cancelAnimationFrame(frame);
    frame = 0;
    schedule();
  }

  scene.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || event.target.closest(excluded)) return;
    down = {id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp};
  }, {passive:true});
  scene.addEventListener('pointermove', event => {
    if (down && down.id === event.pointerId && Math.hypot(event.clientX-down.x,event.clientY-down.y)>10) down=null;
  }, {passive:true});
  scene.addEventListener('pointerup', event => {
    const tap = down;
    down = null;
    if (!tap || tap.id !== event.pointerId || event.timeStamp-tap.time>500 ||
        event.target.closest(excluded) || Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>10) return;
    const rect = surface.getBoundingClientRect();
    start(event.clientX-rect.left,event.clientY-rect.top);
  }, {passive:true});
  scene.addEventListener('pointercancel', () => { down=null; }, {passive:true});
  surface.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      start(width/2,height/2);
    }
  });
  scene.addEventListener('keydown', event => { if (event.key === 'Escape') clear(); });
  reduced.addEventListener('change', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      waves = [];
    } else {
      if (!openingPlayed) opening();
      schedule();
    }
  });
  canvas.addEventListener('contextlost', event => { event.preventDefault(); clear(); });
  canvas.addEventListener('contextrestored', () => { width=0; resize(); });
  new ResizeObserver(resize).observe(surface);
  resize();
  addEventListener('load', opening, {once:true});
  if (document.readyState === 'complete') opening();

}
