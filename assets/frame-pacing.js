export function createFramePacer({responsive = false} = {}) {
  let position = 0, pending = 0, direction = 0, elapsed = 0;
  let paintAnchor, paintBudget = 4;
  return {
    next(displayed, desired, delta, painted = displayed) {
      const travel = Math.sign(desired - displayed);
      // Native decoders may complete only 10 seeks/second on a phone. Retain
      // that interval, but never turn a long network stall into a time debt.
      elapsed = Math.min(responsive ? .1 : 1 / 30, elapsed + Math.max(delta, 0));
      if (paintAnchor !== painted) { paintAnchor = painted; paintBudget = 4; }
      if (!travel) {
        position = pending = displayed;
        direction = 0;
        elapsed = 0;
        return displayed;
      }
      // Keep a useful seek stable until it is presented. Advancing an unseen
      // timeline during buffering causes a large camera jump on recovery.
      if (pending !== displayed && travel === direction &&
          (pending - displayed) * travel > 0 && (desired - pending) * travel >= 0) return pending;
      if (travel !== direction || Math.abs(position - displayed) > .5) position = displayed;
      direction = travel;
      // Ease wheel detents, with a bounded cinematic catch-up speed for swipes.
      // Carry fractional frames so 120 Hz displays do not double playback speed.
      const distance = Math.abs(desired - displayed);
      const speed = Math.min(180, Math.max(60, distance * 12));
      let step = Math.min(4, speed * elapsed);
      // A fixed four-frame limit turns a large swipe into tens of seconds of
      // queued motion on slow native decoders. Skip obsolete samples while
      // easing the remaining distance; keep the small-step behavior near the
      // finger's destination so ordinary wheel/touch motion still settles.
      if (responsive) step = Math.max(step, Math.max(0, distance - 16) * -Math.expm1(-elapsed / .1));
      elapsed = 0;
      paintBudget = Math.max(paintBudget, Math.ceil(step));
      position += travel * Math.min(Math.abs(desired - position), step);
      position = Math.max(displayed - paintBudget, Math.min(displayed + paintBudget, position));
      // Native seeks may complete between paints. They share one paint's jump
      // budget even when the decoder is ready for another small step already.
      position = Math.max(painted - paintBudget, Math.min(painted + paintBudget, position));
      pending = Math.round(position);
      return pending;
    },
  };
}
