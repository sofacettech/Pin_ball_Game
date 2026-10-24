// Native video owns its compositor surface. Schedule its next seek without
// waiting for the page's next RAF, while leaving time for each frame to show.
export function createNativeFrameScheduler({onFrame, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, fps = 30}) {
  const interval = 1000 / fps;
  let timer, nextAt = 0, suspended = false, destroyed = false, running = false;
  let readyAt, lastStartedAt;
  const stats = {nativeScheduleStarts: 0, nativeScheduleWaitMs: 0, nativeScheduleWaitSamples: 0, nativeScheduleMaxWaitMs: 0};

  function clear() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }
  function schedule(defer = false) {
    if (destroyed || suspended || running || timer !== undefined) return;
    const remaining = nextAt - now();
    // Timer resolution may round down by a fraction of a millisecond. Avoid
    // adding another clamped timer just to wait that final fractional instant.
    if (remaining <= 1 && !defer) run();
    else timer = setTimer(() => { timer = undefined; run(); }, remaining);
  }
  function run() {
    if (destroyed || suspended) return;
    const time = now();
    if (time + 1 < nextAt) { schedule(); return; }
    running = true;
    let result;
    try { result = onFrame(time); }
    finally { running = false; }
    if (result?.started) {
      stats.nativeScheduleStarts++;
      if (readyAt !== undefined) {
        const wait = Math.max(0, time - readyAt);
        stats.nativeScheduleWaitMs += wait;
        stats.nativeScheduleWaitSamples++;
        stats.nativeScheduleMaxWaitMs = Math.max(stats.nativeScheduleMaxWaitMs, wait);
      }
      readyAt = undefined;
      lastStartedAt = time;
    }
    // An unfinished seek does not spend another cadence slot. If it finishes
    // just after this check, ready() can continue immediately, rather than
    // waiting a second 33 ms interval and dropping to 15 updates/second.
    if (result?.started || !result?.pending) {
      // Keep the original phase through small timer delays. Resetting from
      // every actual start compounds a 3 ms delay into a ~27.5 Hz cadence.
      // A late decoder or longer pause starts a fresh interval instead of
      // building a burst of overdue work; recovery keeps at least half a slot.
      nextAt = time - nextAt <= interval / 2 ? nextAt + interval : time + interval;
    }
    if (!result?.active) { readyAt = undefined; return; }
    if (!result.pending) schedule();
  }
  return {
    request() { schedule(); },
    // Let the cache's promise finally release its decoder before continuing.
    ready() { if (!destroyed && !suspended) { readyAt ??= now(); schedule(true); } },
    suspend() { suspended = true; clear(); readyAt = undefined; },
    resume() { if (!destroyed) { suspended = false; nextAt = 0; readyAt = undefined; } },
    destroy() { destroyed = true; clear(); readyAt = undefined; },
    get stats() { return {...stats, nativeScheduleIntervalMs: interval, nativeScheduleLastStartedAt: lastStartedAt ?? null}; },
  };
}
