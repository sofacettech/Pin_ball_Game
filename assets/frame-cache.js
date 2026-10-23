export const FRAME_CACHE_DEFAULTS = {
  behind: 16, ahead: 192, prefetch: 224, network: 3, batch: 32,
  decoded: 8, compressedBytes: 24 * 1024 * 1024, idleMs: 100,
};

export function createFrameCache({count, source, onReady, onError, config = {}}) {
  const settings = {...FRAME_CACHE_DEFAULTS, ...config};
  const compressed = new Map(), decoded = new Map(), active = new Set(), loading = new Set(), failures = new Map();
  for (const name of Object.keys(FRAME_CACHE_DEFAULTS)) {
    if (!Number.isSafeInteger(settings[name]) || settings[name] < (name === 'behind' || name === 'ahead' ? 0 : 1)) {
      throw RangeError('Invalid frame cache setting: ' + name);
    }
  }
  let target = 0, lead = 0, presented = 0, direction = 1, order = [], timer, decoding = false;
  let suspended = false, destroyed = false, bytes = 0, reserved = 0, requestedAt = 0, generation = 0;
  const counters = {hits: 0, decodedTotal: 0, evictions: 0, cancelled: 0, peakDecoded: 0, peakNetwork: 0, latencyMs: 0};
  const valid = frame => frame >= 0 && frame < count;
  const estimate = frame => source.frameBytes?.(frame) ?? 256 * 1024;
  const advances = frame => frame > Math.min(presented, target) && frame < Math.max(presented, target);
  const useful = frame => order.includes(frame) || advances(frame);
  function progressFrame() {
    let best;
    for (const frame of compressed.keys()) {
      if (advances(frame) && (best === undefined || Math.abs(target - frame) < Math.abs(target - best))) best = frame;
    }
    return best;
  }

  function plan() {
    const result = new Set([target]);
    const add = frame => { if (valid(frame) && result.size < settings.prefetch) result.add(frame); };
    // Keep the destination available for large jumps, then buffer in travel order.
    add(lead);
    for (let i = 1; i <= settings.ahead; i++) add(target + i * direction);
    for (let i = 1; i <= settings.behind; i++) add(target - i * direction);
    for (let i = settings.ahead + 1; result.size < Math.min(settings.prefetch, count) && valid(target + i * direction); i++) add(target + i * direction);
    for (let i = settings.behind + 1; result.size < Math.min(settings.prefetch, count) && valid(target - i * direction); i++) add(target - i * direction);
    order = [...result];
  }

  function warmFrames() {
    if (source.transient) return [target];
    const frames = [target];
    // A completed range can trail a moving target and still advance the image.
    // Present that progress instead of cancelling every request on a slow link.
    const progress = source.mode === 'video' ? undefined : progressFrame();
    if (progress !== undefined) frames.push(progress);
    // Decode ahead during scrolling, keeping a couple of frames for reversals.
    const ahead = Math.max(1, settings.decoded - 2);
    for (let i = 1; i <= ahead; i++) if (valid(target + i * direction)) frames.push(target + i * direction);
    for (let i = 1; frames.length < settings.decoded && i <= settings.decoded; i++) {
      if (valid(target - i * direction)) frames.push(target - i * direction);
    }
    for (let i = ahead + 1; frames.length < settings.decoded && valid(target + i * direction); i++) frames.push(target + i * direction);
    return [...new Set(frames)].filter(useful).slice(0, settings.decoded);
  }

  function trim() {
    const progress = progressFrame();
    for (const [frame, data] of compressed) {
      if (!order.includes(frame) && frame !== progress) {
        bytes -= data?.byteLength || 0; compressed.delete(frame);
      }
    }
    while (compressed.size > settings.prefetch || bytes > settings.compressedBytes) {
      const key = [...compressed.keys()].find(key => key !== target);
      if (key === undefined) break;
      bytes -= compressed.get(key)?.byteLength || 0;
      compressed.delete(key);
    }
    const warm = warmFrames();
    while (decoded.size > settings.decoded) {
      const key = [...decoded.keys()].find(key => !warm.includes(key)) ?? [...decoded.keys()].find(key => key !== target);
      decoded.get(key).close(); decoded.delete(key); counters.evictions++;
    }
  }

  function arm() {
    clearTimeout(timer);
    if (!suspended && !destroyed) timer = setTimeout(pump, settings.idleMs);
  }

  function fail(error, frame, transient = false) {
    if (destroyed || suspended || error.name === 'AbortError') return;
    if (!transient && source.fallback()) {
      generation++;
      for (const job of active) job.controller.abort();
      for (const image of decoded.values()) image.close();
      decoded.clear(); compressed.clear(); bytes = 0; failures.clear();
      onReady(); arm(); return;
    }
    failures.set(frame, Date.now() + 1000);
    if (frame === target) onError(error, frame);
    clearTimeout(timer); timer = setTimeout(pump, 1000);
  }

  function pump() {
    if (destroyed || suspended) return;
    const video = source.mode === 'video';
    // Native seeking has no compressed-sample download. Make the target ready
    // synchronously; an artificial download promise otherwise lets old
    // lookahead take the decoder before the latest scroll target.
    if (video) for (const frame of warmFrames()) if (!compressed.has(frame)) compressed.set(frame, null);
    const downloads = video ? [] : order;
    const unavailable = frame => compressed.has(frame) || decoded.has(frame) || loading.has(frame) || (failures.get(frame) || 0) > Date.now();
    for (const frame of downloads) {
      if (active.size >= (video ? 1 : settings.network)) break;
      if (unavailable(frame)) continue;
      // Include in-flight bytes so prefetch cannot churn through its own evictions.
      const required = Math.min(estimate(frame), settings.compressedBytes);
      const priority = order.indexOf(frame);
      if (settings.compressedBytes - bytes - reserved < required) {
        const rank = key => order.includes(key) ? order.indexOf(key) : 1;
        const candidates = [...compressed.keys()].filter(key => rank(key) > priority)
          .sort((a, b) => rank(b) - rank(a));
        const reclaimable = candidates.reduce((total, key) => total + (compressed.get(key)?.byteLength || 0), 0);
        if (settings.compressedBytes - bytes - reserved + reclaimable >= required) {
          for (const evict of candidates) {
            if (settings.compressedBytes - bytes - reserved >= required) break;
            bytes -= compressed.get(evict)?.byteLength || 0;
            compressed.delete(evict);
          }
        }
      }
      let budget = Math.max(0, settings.compressedBytes - bytes - reserved);
      const frames = [];
      let size = 0;
      const batch = !video && source.loadFrames ? settings.batch : 1;
      for (let i = 0; i < batch; i++) {
        const next = frame + i * direction;
        if (!order.includes(next) || unavailable(next)) break;
        const length = estimate(next);
        if (length > budget && (next !== target || source.frameBytes)) break;
        frames.push(next); size += Math.min(length, budget); budget = Math.max(0, budget - length);
      }
      // Do not skip a larger nearby sample to repeatedly fill/evict a smaller
      // distant one that happens to fit the remaining bytes.
      if (!frames.length) break;
      // Let the far edge accumulate a useful range instead of opening one HTTP
      // request for every new frame entering the window during a slow scroll.
      if (source.loadFrames && !video && performance.now() - requestedAt < settings.idleMs &&
        frames.length < settings.batch && Math.abs(frame - target) > settings.decoded &&
        frame !== lead && valid(frames.at(-1) + direction)) break;
      const controller = new AbortController(), job = {controller, frames, size}, epoch = generation;
      active.add(job); reserved += size;
      let reservation = size;
      const releaseReservation = () => { reserved -= reservation; reservation = 0; };
      const received = new Set();
      const receive = (next, data) => {
        if (destroyed || suspended || controller.signal.aborted || epoch !== generation || received.has(next)) return;
        received.add(next);
        const released = Math.min(reservation, data?.byteLength || 0);
        reservation -= released; reserved -= released;
        if (useful(next) && !compressed.has(next)) {
          compressed.set(next, data); bytes += data?.byteLength || 0; failures.delete(next);
        }
        trim(); pump();
      };
      for (const next of frames) loading.add(next);
      counters.peakNetwork = Math.max(counters.peakNetwork, active.size);
      const load = source.loadFrames
        ? source.loadFrames(frames, controller.signal, settings.compressedBytes, receive)
        : source.load(frame, controller.signal, settings.compressedBytes).then(data => new Map([[frame, data]]));
      load.then(samples => {
        // Completed bytes replace their reservation before another completion
        // can pump the queue; counting both can evict useful frames repeatedly.
        releaseReservation();
        if (destroyed || suspended || controller.signal.aborted || epoch !== generation) return;
        let total = 0;
        for (const data of samples.values()) total += data?.byteLength || 0;
        if (total > settings.compressedBytes) throw Error('Compressed frames exceed the cache budget');
        for (const [next, data] of samples) {
          if (!useful(next) || compressed.has(next)) continue;
          compressed.set(next, data); bytes += data?.byteLength || 0; failures.delete(next);
        }
        trim();
      }).catch(error => {
        if (epoch !== generation) return;
        for (const next of frames) {
          fail(error, next, ['TypeError', 'NetworkError', 'TimeoutError'].includes(error.name));
          if (epoch !== generation) break;
        }
      }).finally(() => {
        active.delete(job); releaseReservation();
        for (const next of frames) loading.delete(next);
        pump();
      });
    }
    if (decoding) return;
    const next = warmFrames().find(frame => !decoded.has(frame) && compressed.has(frame) && (failures.get(frame) || 0) <= Date.now());
    if (next === undefined) {
      if (!active.size) {
        const retry = Math.min(...downloads.map(frame => failures.get(frame) || Infinity).filter(time => time > Date.now()));
        if (Number.isFinite(retry)) { clearTimeout(timer); timer = setTimeout(pump, Math.max(1, retry - Date.now())); }
      }
      return;
    }
    decoding = true;
    const epoch = generation;
    source.decode(next, compressed.get(next)).then(image => {
      if (destroyed || suspended || epoch !== generation || !useful(next)) { image.close(); return; }
      if (image.transient) {
        for (const retained of decoded.values()) retained.close();
        decoded.clear();
        if (next !== target) { onReady(next, image); return; }
      }
      decoded.set(next, image); trim(); counters.decodedTotal++;
      counters.peakDecoded = Math.max(counters.peakDecoded, decoded.size);
      if (next === target) counters.latencyMs = performance.now() - requestedAt;
      onReady(next, image);
    }).catch(error => { if (epoch === generation) fail(error, next); }).finally(() => { decoding = false; pump(); });
  }

  function request(frame, next = frame, visible = frame) {
    if (![frame, next, visible].every(value => Number.isInteger(value) && valid(value))) throw RangeError('Frame is outside the source sequence');
    if (order.length && target === frame && lead === next && presented === visible) return;
    if (next !== lead) direction = Math.sign(next - lead);
    else if (frame !== target) direction = Math.sign(frame - target);
    target = frame; lead = next; presented = visible; requestedAt = performance.now(); plan();
    source.retarget?.(target,presented);
    for (const [index, image] of decoded) if (image.transient && index !== target) decoded.delete(index);
    for (const [index, data] of compressed) {
      if (!useful(index)) { bytes -= data?.byteLength || 0; compressed.delete(index); }
    }
    trim();
    for (const job of active) {
      if (!job.frames.some(useful) && !job.controller.signal.aborted) { job.controller.abort(); counters.cancelled++; }
    }
    if (decoded.has(frame)) { counters.hits++; counters.latencyMs = 0; }
    pump(); arm();
  }

  request(0);
  return {
    request,
    // Readiness describes a bounded opening window, never the whole movie.
    // Keep room for the decoder and for requests already in flight.
    get preparation() {
      if (source.mode === 'video') {
        const progress = Math.min(1, (source.stats.bufferedSeconds || 0) / 3);
        return {progress: decoded.has(0) ? progress : 0, ready: decoded.has(0) && progress === 1};
      }
      let required = 0, available = 0, size = 0;
      const limit = Math.min(count, settings.ahead + 1, settings.prefetch, 180);
      for (let frame = 0; frame < limit; frame++) {
        const length = estimate(frame);
        if (size + length > settings.compressedBytes * .75 && required) break;
        size += length; required++;
        if (compressed.has(frame) || decoded.has(frame)) available++;
      }
      const progress = required ? available / required : 0;
      return {progress: decoded.has(0) ? progress : Math.min(progress, .99), ready: decoded.has(0) && progress === 1};
    },
    get: frame => decoded.get(frame),
    closest(frame, previous) {
      let best;
      for (const index of decoded.keys()) {
        if ((frame >= previous ? index >= previous && index <= frame : index <= previous && index >= frame) &&
          (best === undefined || Math.abs(frame - index) < Math.abs(frame - best))) best = index;
      }
      return best;
    },
    get stats() {
      return {
        ...counters, target, direction, decoded: decoded.size, decodedBytes: decoded.size * (source.decodedFrameBytes || 1920 * 1080 * 4),
        compressed: compressed.size, compressedBytes: bytes, reservedBytes: reserved,
        pending: active.size + (decoding ? 1 : 0), network: active.size,
        queued: (source.mode === 'video' ? warmFrames() : order).filter(i => !compressed.has(i) && !decoded.has(i) && !loading.has(i)).length,
        settings, ...source.stats,
      };
    },
    suspend() {
      suspended = true; generation++; clearTimeout(timer);
      for (const job of active) job.controller.abort();
      for (const image of decoded.values()) image.close();
      decoded.clear();
      source.suspend?.();
    },
    resume() { if (!destroyed) { suspended = false; pump(); arm(); } },
    destroy() {
      destroyed = true; generation++; clearTimeout(timer);
      for (const job of active) job.controller.abort();
      for (const image of decoded.values()) image.close();
      decoded.clear(); compressed.clear(); bytes = 0; source.destroy();
    },
  };
}
