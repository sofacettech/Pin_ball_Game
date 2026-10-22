export function createFramePacer() {
  let position = 0, pending = 0, direction = 0, elapsed = 0;
  return {
    next(displayed, desired, delta) {
      const travel = Math.sign(desired - displayed);
      elapsed = Math.min(1 / 30, elapsed + Math.max(delta, 0));
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
      const speed = Math.min(180, Math.max(60, Math.abs(desired - displayed) * 12));
      const step = Math.min(4, speed * elapsed);
      elapsed = 0;
      position += travel * Math.min(Math.abs(desired - position), step);
      position = Math.max(displayed - 4, Math.min(displayed + 4, position));
      pending = Math.round(position);
      return pending;
    },
  };
}
