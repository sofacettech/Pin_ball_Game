export const FRAME_CACHE_DEFAULTS = {
  // Retain compressed history for reversals; only the tiny decoded window
  // occupies full-resolution image memory. Prepare six seconds at 60 FPS.
  behind: 224, ahead: 256, prefetch: 512, preparationFrames: 360, network: 3, batch: 32,
  decoded: 8, compressedBytes: 48 * 1024 * 1024, idleMs: 100,
};

export function createFrameCache({count, source, onReady, onError, canConfirm, config = {}}) {
  const settings = {...FRAME_CACHE_DEFAULTS, ...config};
  const compressed = new Map(), decoded = new Map(), active = new Set(), loading = new Set(), failures = new Map(), decodeJobs = new Map();
  for (const name of Object.keys(FRAME_CACHE_DEFAULTS)) {
    if (!Number.isSafeInteger(settings[name]) || settings[name] < (name === 'behind' || name === 'ahead' ? 0 : 1)) {
      throw RangeError('Invalid frame cache setting: ' + name);
    }
  }
  let target = 0, lead = 0, presented = 0, direction = 1, order = [], ranks = new Map(), timer, progressPin;
  let suspended = false, destroyed = false, bytes = 0, reserved = 0, requestedAt = 0, generation = 0, lastError = null;
  const counters = {hits: 0, decodedTotal: 0, evictions: 0, cancelled: 0, decodeCancelled: 0, peakDecoded: 0, peakDecoding: 0, peakDecodedAndPending: 0, peakNetwork: 0, latencyMs: 0};
  const valid = frame => frame >= 0 && frame < count;
  const estimate = frame => source.frameBytes?.(frame) ?? 256 * 1024;
  const advances = frame => frame > Math.min(presented, target) && frame < Math.max(presented, target);
  const useful = frame => ranks.has(frame) || advances(frame);
  const pinned = frame => source.mode === 'worker' && frame === progressPin && decoded.has(frame) && advances(frame);
  const decodeConcurrency = () => Math.min(settings.decoded,
    Number.isSafeInteger(source.decodeConcurrency) && source.decodeConcurrency > 0 ? source.decodeConcurrency : 1);
  const needsNativeConfirmation = () => source.transient && target > 0 && target === lead && 'presentedFrame' in source && source.presentedFrame !== target;
  function progressFrame(frames = compressed.keys()) {
    let best;
    for (const frame of frames) {
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
    // Near the end, let the window shrink. Filling spare slots with older
    // history re-downloads discarded frames while the final scene needs data.
    // Give the next few ranges priority over a distant wheel/swipe destination:
    // the pacer must display these intervening frames before it can get there.
    const immediate = [target];
    for (let i = 1; i <= Math.min(settings.ahead, settings.batch * settings.network); i++) {
      const frame = target + i * direction;
      if (result.has(frame)) immediate.push(frame);
    }
    order = [...new Set([...immediate, ...result])];
    ranks = new Map(order.map((frame, priority) => [frame, priority]));
  }

  function warmFrames() {
    if (source.transient) return [target];
    const frames = [target];
    if (pinned(progressPin)) frames.push(progressPin);
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
      if (!ranks.has(frame) && frame !== progress) {
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
      const candidates = [...decoded.keys()].filter(key => !pinned(key));
      const key = candidates.find(key => !warm.includes(key)) ?? candidates.find(key => key !== target);
      decoded.get(key).close(); decoded.delete(key); counters.evictions++;
    }
  }

  function arm() {
    clearTimeout(timer);
    if (!suspended && !destroyed) timer = setTimeout(pump, settings.idleMs);
  }

  function cancelDecodes(obsolete = () => true) {
    for (const [frame, job] of decodeJobs) {
      if (obsolete(frame) && !job.controller.signal.aborted) {
        job.controller.abort(); counters.decodeCancelled++;
      }
    }
    // Keep canceled jobs reserved until the source acknowledges cancellation.
    // A decoder that ignores AbortSignal may still return a full-size image.
  }

  function reserveDecodeSlot(next, warm) {
    while (decoded.size + decodeJobs.size >= settings.decoded) {
      const candidates = [...decoded.keys()].filter(frame => !pinned(frame));
      const key = candidates.find(frame => !warm.includes(frame)) ??
        candidates.reverse().find(frame => warm.indexOf(frame) > warm.indexOf(next));
      if (key === undefined) return false;
      decoded.get(key).close(); decoded.delete(key); counters.evictions++;
    }
    return true;
  }

  function fail(error, frame, transient = false) {
    if (destroyed || suspended || error.name === 'AbortError') return;
    lastError = {frame, name: error.name, message: error.message};
    if (!transient && source.fallback()) {
      generation++;
      for (const job of active) job.controller.abort();
      cancelDecodes();
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
    const scrollSettled = performance.now() - requestedAt >= settings.idleMs && (canConfirm?.(lead) ?? true);
    // A denied play() needs a gesture, not repeated seek/play retries. Keep
    // scrolling available while the exact settled frame waits for activation.
    if (scrollSettled && needsNativeConfirmation() && source.playbackBlocked) {
      if (lastError?.name !== 'NotAllowedError' || lastError.frame !== target) {
        const error = new DOMException('Tap to resume the journey', 'NotAllowedError');
        lastError = {frame: target, name: error.name, message: error.message};
        onError(error, target);
      }
      return;
    }
    if (scrollSettled && needsNativeConfirmation()) decoded.delete(target);
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
      const priority = ranks.get(frame);
      if (settings.compressedBytes - bytes - reserved < required) {
        const rank = key => ranks.get(key) ?? 1;
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
      // HTTP ranges arrive in ascending file order. A reverse miss would put
      // the visible target at the end of a full batch; fetch that frame first.
      const batch = !video && source.loadFrames && !(direction < 0 && frame === target) ? settings.batch : 1;
      // Fill history away from the target too. Using the travel direction
      // there runs straight into cached frames and fragments it into singles.
      const batchDirection = Math.sign(frame - target) || direction;
      for (let i = 0; i < batch; i++) {
        const next = frame + i * batchDirection;
        if (!ranks.has(next) || unavailable(next)) break;
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
        frame !== lead && valid(frames.at(-1) + batchDirection)) break;
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
    while (decodeJobs.size < decodeConcurrency()) {
      const warm = warmFrames();
      const next = warm.find(frame => !decoded.has(frame) && !decodeJobs.has(frame) && compressed.has(frame) && (failures.get(frame) || 0) <= Date.now());
      if (next === undefined) {
        // A pending scroll event or an early idle timer can defer confirmation.
        // Keep the existing idle pump alive until the destination is current.
        if (needsNativeConfirmation() && !decodeJobs.size) { arm(); return; }
        if (!active.size && !decodeJobs.size) {
          const retry = Math.min(...downloads.map(frame => failures.get(frame) || Infinity).filter(time => time > Date.now()));
          if (Number.isFinite(retry)) { clearTimeout(timer); timer = setTimeout(pump, Math.max(1, retry - Date.now())); }
        }
        return;
      }
      // Retained images and pending decoder outputs share the same budget.
      // Close a replaceable image before starting work that can allocate one.
      if (!reserveDecodeSlot(next, warm)) return;
      const controller = new AbortController(), job = {controller}, epoch = generation;
      decodeJobs.set(next, job);
      counters.peakDecoding = Math.max(counters.peakDecoding, decodeJobs.size);
      counters.peakDecodedAndPending = Math.max(counters.peakDecodedAndPending, decoded.size + decodeJobs.size);
      const release = () => { if (decodeJobs.get(next) === job) decodeJobs.delete(next); };
      // Native and existing WebCodecs sources remain serial by default. Worker
      // sources opt into parallel decoding and acknowledge cancellation through
      // the optional fourth argument. Frame zero needs no native confirmation.
      let work;
      try { work = source.decode(next, compressed.get(next), next === lead && next !== 0 && scrollSettled, controller.signal); }
      catch (error) { work = Promise.reject(error); }
      Promise.resolve(work).then(image => {
        release();
        if (destroyed || suspended || controller.signal.aborted || epoch !== generation || !useful(next)) { image.close(); return; }
        if (image.transient) {
          for (const retained of decoded.values()) retained.close();
          decoded.clear();
          if (next !== target) { onReady(next, image); return; }
        }
        decoded.set(next, image); trim(); counters.decodedTotal++;
        counters.peakDecoded = Math.max(counters.peakDecoded, decoded.size);
        if (next === target) { counters.latencyMs = performance.now() - requestedAt; lastError = null; }
        onReady(next, image);
      }).catch(error => {
        release();
        if (epoch === generation && !controller.signal.aborted) fail(error, next);
      }).finally(() => { release(); pump(); });
    }
  }

  function request(frame, next = frame, visible = frame) {
    if (![frame, next, visible].every(value => Number.isInteger(value) && valid(value))) throw RangeError('Frame is outside the source sequence');
    if (order.length && target === frame && lead === next && presented === visible) return;
    // A finger can reverse while the image still needs to catch up forward.
    // Prefetch toward the required painted-frame travel, or a held worker can
    // fill its byte budget behind itself and never receive its next frame.
    if (source.mode === 'worker' && (frame !== visible || next !== visible)) direction = Math.sign(frame - visible) || Math.sign(next - visible);
    else if (next !== lead) direction = Math.sign(next - lead);
    else if (frame !== target) direction = Math.sign(frame - target);
    target = frame; lead = next; presented = visible; requestedAt = performance.now(); plan();
    // request() starts decoding before the caller asks closest() for pixels.
    // Keep the best worker image that can advance this paint, even when new
    // target/lookahead jobs need to replace the rest of the four-frame window.
    progressPin = source.mode === 'worker' && !decoded.has(target) ? progressFrame(decoded.keys()) : undefined;
    source.retarget?.(target,presented,lead);
    for (const [index, image] of decoded) if (image.transient && index !== target) decoded.delete(index);
    for (const [index, data] of compressed) {
      if (!useful(index)) { bytes -= data?.byteLength || 0; compressed.delete(index); }
    }
    trim();
    for (const job of active) {
      if (!job.frames.some(useful) && !job.controller.signal.aborted) { job.controller.abort(); counters.cancelled++; }
    }
    const warm = new Set(warmFrames());
    cancelDecodes(frame => !useful(frame) || (source.mode === 'worker' && !warm.has(frame) && !advances(frame)));
    if (decoded.has(frame)) { counters.hits++; counters.latencyMs = 0; }
    pump(); arm();
  }

  request(0);
  return {
    request,
    retry() { if (!destroyed && !suspended) { failures.clear(); pump(); arm(); } },
    get settled() { return !needsNativeConfirmation(); },
    // Readiness describes a bounded opening window, never the whole movie.
    // Keep room for the decoder and for requests already in flight.
    get preparation() {
      if (source.mode === 'video') {
        // Safari may stop prefetching a paused video before three seconds even
        // after reporting HAVE_ENOUGH_DATA. Respect that native readiness signal
        // instead of leaving a playable journey behind an endless loader.
        const progress = source.stats.canPlayThrough ? 1 : Math.min(1, (source.stats.bufferedSeconds || 0) / 3);
        return {progress: decoded.has(0) ? progress : 0, ready: decoded.has(0) && progress === 1};
      }
      let required = 0, available = 0, size = 0;
      const limit = Math.min(count, settings.prefetch, settings.preparationFrames);
      for (let frame = 0; frame < limit; frame++) {
        const length = estimate(frame);
        if (size + length > settings.compressedBytes * .75 && required) break;
        size += length; required++;
        if (compressed.has(frame) || decoded.has(frame)) available++;
      }
      const progress = required ? available / required : 0;
      return {progress: decoded.has(0) ? progress : Math.min(progress, .99), ready: decoded.has(0) && progress === 1};
    },
    // Count consecutive ready samples after the painted frame, never queued
    // ranges. The remaining distance keeps short endings/reversals distinct
    // from starvation. A caller can use a small pacing horizon; even an
    // oversized limit cannot scan beyond this cache's bounded prefetch window.
    coverage(frame, travel = 1, limit = settings.prefetch) {
      if (!Number.isInteger(frame) || !valid(frame) || (travel !== -1 && travel !== 0 && travel !== 1) ||
          !Number.isSafeInteger(limit) || limit < 0) throw RangeError('Invalid frame coverage query');
      const remaining = travel > 0 ? count - 1 - frame : travel < 0 ? frame : 0;
      const scan = Math.min(remaining, limit, settings.prefetch);
      let available = 0;
      if (!destroyed && !suspended && source.mode !== 'video') {
        while (available < scan) {
          const next = frame + (available + 1) * travel;
          const image = decoded.get(next);
          if (!(image && !image.transient) && compressed.get(next) == null) break;
          available++;
        }
      }
      return {available, remaining};
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
        ...counters, lastError, target, direction, decoded: decoded.size, decodedBytes: decoded.size * (source.decodedFrameBytes || 1920 * 1080 * 4),
        compressed: compressed.size, compressedBytes: bytes, reservedBytes: reserved,
        pending: active.size + decodeJobs.size + (needsNativeConfirmation() ? 1 : 0), network: active.size,
        decoding: decodeJobs.size, decodeConcurrency: decodeConcurrency(),
        queued: (source.mode === 'video' ? warmFrames() : order).filter(i => !compressed.has(i) && !decoded.has(i) && !loading.has(i)).length,
        settings, ...source.stats,
      };
    },
    suspend() {
      suspended = true; generation++; clearTimeout(timer);
      for (const job of active) job.controller.abort();
      cancelDecodes();
      for (const image of decoded.values()) image.close();
      decoded.clear();
      source.suspend?.();
    },
    resume() { if (!destroyed) { suspended = false; pump(); arm(); } },
    destroy() {
      destroyed = true; generation++; clearTimeout(timer);
      for (const job of active) job.controller.abort();
      cancelDecodes();
      for (const image of decoded.values()) image.close();
      decoded.clear(); compressed.clear(); bytes = 0; source.destroy();
    },
  };
}
