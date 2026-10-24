// Adapt source-frame travel to contiguous ready coverage. This controls the
// animation's advance, not browser FPS, and never accrues elapsed-time debt.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function createBufferPacingController() {
  let scale = 1, pressure = false, previousDirection = 0;
  function reset() { scale = 1; pressure = false; previousDirection = 0; }
  return {
    reset,
    update({delta = 0, bufferedFrames = 0, remainingFrames = 0, direction = 0,
      desiredDistance = 0, consumptionSpeed = 180, capacityFrames = 192} = {}) {
      const elapsed = Number.isFinite(delta) ? clamp(delta, 0, .1) : 0;
      const travel = Number.isFinite(direction) ? Math.sign(direction) : 0;
      const remaining = count(remainingFrames), capacity = Math.max(1, count(capacityFrames));
      const buffered = Math.min(count(bufferedFrames), remaining, capacity);
      const speed = Number.isFinite(consumptionSpeed) && consumptionSpeed > 0 ? clamp(consumptionSpeed, 1, 720) : 180;
      // A reversal evaluates the new direction independently; the old side's
      // low-water latch must not throttle a fully supplied reverse movement.
      if (travel && previousDirection && travel !== previousDirection) reset();
      if (travel) previousDirection = travel;
      // Smaller phone windows must slow early enough to preserve useful runway.
      const low = Math.min(remaining, Math.max(12, speed * .6), capacity * .8);
      const recovery = Math.min(remaining, capacity * .9, Math.max(low + 12, speed));
      const critical = Math.min(low * .5, Math.max(1, speed * .15));
      const complete = buffered >= remaining;
      let targetScale = 1;
      if (!remaining) { reset(); }
      else if (!buffered) { pressure = true; scale = targetScale = 0; }
      else {
        if (complete || buffered >= recovery) pressure = false;
        else if (buffered < low) pressure = true;
        if (pressure) targetScale = buffered < critical ? .25 + .5 * buffered / critical : .75;
        // Decrease promptly, but restore more slowly so individual range
        // completions cannot turn into abrupt catch-up acceleration.
        const timeConstant = targetScale < scale ? .08 : .7;
        scale += (targetScale - scale) * -Math.expm1(-elapsed / timeConstant);
        scale = clamp(scale, .25, 1);
        if (Math.abs(scale - targetScale) < .001) scale = targetScale;
      }
      const limited = pressure || scale < 1;
      return {scale, targetScale, state: !remaining ? 'end' : !buffered ? 'depleted' : pressure ? 'limited' : limited ? 'recovering' : 'healthy',
        limited, bufferedFrames: buffered, remainingFrames: remaining, desiredDistance: count(desiredDistance),
        lowWatermark: low, recoveryWatermark: recovery, runwayMs: buffered / speed * 1000};
    },
  };
}

// Restore responsive catch-up only as runway recovers. Keep every pending
// request inside the retained history, so recentering the cache cannot evict
// the ready samples between the painted frame and its requested destination.
export function getBufferPacingLimits(pacing = {}, {bufferedFrames = pacing.bufferedFrames,
  retainedBehindFrames = 40, baseSpeed = 180, catchupSpeed = 720} = {}) {
  const scale = Number.isFinite(pacing.scale) ? clamp(pacing.scale, 0, 1) : 1;
  const base = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : 180;
  const catchup = Math.max(base, Number.isFinite(catchupSpeed) && catchupSpeed > 0 ? catchupSpeed : 720);
  // Do not spend a thin or reversed runway on the healthy catch-up boost
  // while the slower controller scale is still easing down.
  const recovery = pacing.targetScale === 1 ? clamp((scale - .75) / .25, 0, 1) : 0;
  return {scale, maxSpeed: base * scale + (catchup - base) * recovery,
    maxAdvance: Math.min(count(bufferedFrames), count(retainedBehindFrames))};
}
