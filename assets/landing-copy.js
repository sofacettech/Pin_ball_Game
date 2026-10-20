const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function copyPose(frame, from, until = Infinity) {
  const enter = ease((frame - from) / 38);
  const detail = ease((frame - from - 10) / 38);
  const leave = ease((frame - until + 32) / 32);
  return {
    opacity: enter * (1 - leave),
    detailOpacity: detail * (1 - leave),
    y: 20 * (1 - enter) - 12 * leave,
    detailY: 14 * (1 - detail) - 10 * leave,
  };
}

export function scrollCuePose(frame) {
  // Two 100px wheel steps at the existing 8px per frame; touch uses the same distance.
  const progress = clamp((frame - 240) / 25);
  return { angle: -30 + 150 * progress, radius: 224 - 70 * ease((progress - .32) / .68), progress };
}

export function createScrollCue(reference) {
  const cue = document.querySelector('#scroll-cue');
  const orbit = document.querySelector('#scroll-cue-orbit');
  const arc = document.querySelector('#scroll-cue-arc');
  const mask = document.querySelector('#scroll-cue-ball');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const from = Number(cue.dataset.from);
  const [left, top, right, bottom] = reference.ballBoundsPixels;
  mask.setAttribute('rx', (right - left) / 2 + 2);
  mask.setAttribute('ry', (bottom - top) / 2 + 2);
  return (frame, point) => {
    const visible = frame >= from && frame < 265;
    cue.toggleAttribute('hidden', !visible);
    if (!visible) return;
    const { angle, radius, progress } = scrollCuePose(frame);
    const [x, y] = point.map((v, i) => v * reference.resolution[i]);
    const r = reduced.matches ? 224 : radius;
    mask.setAttribute('cx', x);
    mask.setAttribute('cy', y);
    orbit.setAttribute('transform', `translate(${x} ${y}) rotate(${reduced.matches ? -30 : angle})`);
    arc.setAttribute('d', `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`);
    cue.style.opacity = reduced.matches ? 1 - progress : copyPose(frame, from).opacity;
  };
}

