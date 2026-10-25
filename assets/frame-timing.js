// Debug-only stage timing. Weak references never extend bitmap lifetimes;
// percentiles use a bounded recent window, while counts/means/maxima are lifetime.
export function createFrameTimingRecorder({now = () => performance.now(), timeOrigin = performance.timeOrigin, limit = 120} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 120) throw new RangeError('Invalid frame timing window');
  const names = ['requestToReceipt', 'requestToWorker', 'workerToOutput', 'outputToBitmap', 'bitmapToReceipt', 'receiptToDraw', 'requestToDraw'];
  const stages = new Map(names.map(name => [name, {count: 0, total: 0, max: 0, recent: [], cursor: 0}]));
  const images = new WeakMap();
  let completed = 0, drawn = 0;
  function record(name, duration) {
    // Independent clock resolution can put epoch timestamps slightly out of
    // order. Ignore invalid clocks rather than reporting invented durations.
    if (!Number.isFinite(duration) || duration < -2) return;
    const value = Math.max(0, duration), stage = stages.get(name);
    stage.count++; stage.total += value; stage.max = Math.max(stage.max, value);
    stage.recent[stage.cursor] = value; stage.cursor = (stage.cursor + 1) % limit;
  }
  return {
    received(image, started, timing) {
      const received = now();
      completed++; images.set(image, {started, received});
      record('requestToReceipt', received - started);
      if (timing && [timing.received, timing.output, timing.bitmap].every(Number.isFinite) &&
          timing.output >= timing.received && timing.bitmap >= timing.output) {
        record('requestToWorker', timing.received - (timeOrigin + started));
        record('workerToOutput', timing.output - timing.received);
        record('outputToBitmap', timing.bitmap - timing.output);
        record('bitmapToReceipt', timeOrigin + received - timing.bitmap);
      }
    },
    drawn(image) {
      const timing = images.get(image);
      if (!timing) return;
      images.delete(image); drawn++;
      const at = now();
      record('receiptToDraw', at - timing.received);
      record('requestToDraw', at - timing.started);
    },
    get stats() {
      const workerFrameTimings = Object.fromEntries([...stages].map(([name, stage]) => {
        const values = [...stage.recent].sort((a, b) => a - b);
        return [name, {count: stage.count, meanMs: stage.count ? stage.total / stage.count : null,
          p95Ms: values.length ? values[Math.ceil(values.length * .95) - 1] : null,
          maxMs: stage.count ? stage.max : null, recentCount: values.length}];
      }));
      // Undrawn includes useful lookahead/history, not just discarded work.
      return {workerDrawnOutputs: drawn, workerUndrawnOutputs: completed - drawn, workerFrameTimings};
    },
  };
}
