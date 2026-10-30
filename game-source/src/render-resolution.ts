export type GameQuality = 'auto' | 'full' | 'low';
export const gameQualityStorageKey = 'sofacet.game-quality.v1';
export const parseGameQuality = (value: unknown): GameQuality => value === 'full' || value === 'low' ? value : 'auto';

// Auto starts at Full's density and scales down to CSS resolution, preserving
// board detail. Only unusually large buffers need to go below 1x to stay bounded.
const levels = [1, 1.15, 1.3, 1.5];
const maxAutoPixels = 3840 * 2160;

export function gameRenderResolution(mode: GameQuality, level: number, width: number, height: number, deviceRatio: number) {
  const nativeRatio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  if (mode === 'full') return { pixelRatio: Math.min(nativeRatio, 1.5), samples: 2, transmissionScale: 1 };
  const area = Math.max(1, width) * Math.max(1, height);
  const tier = Number.isFinite(level) ? Math.max(0, Math.min(levels.length - 1, Math.round(level))) : levels.length - 1;
  const ratio = mode === 'low' ? .65 : levels[tier];
  const pixels = mode === 'low' ? 450_000 : maxAutoPixels;
  return { pixelRatio: Math.min(nativeRatio, ratio, Math.sqrt(pixels / area)), samples: 0, transmissionScale: .5 };
}

/** Uses consecutive rendered frames, never the clamped physics timestep. */
export class AdaptiveResolution {
  mode: GameQuality;
  level = levels.length - 1;
  private last: number | null = null;
  private warmup = 1000;
  private windowMs = 0;
  private count = 0;
  private stableMs = 0;
  private slowMs = 0;

  constructor(mode: GameQuality = 'auto') { this.mode = mode; }

  setMode(mode: GameQuality) {
    this.mode = mode;
    this.level = levels.length - 1;
    this.resetTiming();
  }

  resetTiming() {
    this.last = null;
    this.windowMs = this.count = this.stableMs = this.slowMs = 0;
    this.warmup = 1000;
  }

  sample(now: number): boolean {
    if (this.mode !== 'auto' || !Number.isFinite(now)) return false;
    if (this.last === null) { this.last = now; return false; }
    const elapsed = now - this.last;
    this.last = now;
    // Ignore tab suspension and startup/resize shader compilation.
    if (elapsed <= 0 || elapsed > 1000) { this.resetTiming(); return false; }
    if (this.warmup > 0) { this.warmup -= elapsed; return false; }
    this.windowMs += elapsed;
    this.count++;
    if (this.windowMs < 800 || this.count < 8) return false;
    const average = this.windowMs / this.count, duration = this.windowMs;
    this.windowMs = this.count = 0;
    if (average > 25) {
      this.stableMs = 0;
      this.slowMs += duration;
      // A single busy window must not turn the whole board blurry. Severe
      // sustained stalls can react sooner, but still change one tier at a time.
      if (this.slowMs < 1600 && average <= 50) return false;
      const next = Math.max(0, this.level - 1);
      if (next === this.level) return false;
      this.level = next;
    } else {
      this.slowMs = 0;
      this.stableMs = average < 19 ? this.stableMs + duration : 0;
      // Recover detail after sustained headroom, with a separate threshold from
      // downscaling so a smooth 45–50fps device does not keep swapping buffers.
      if (this.stableMs < 4000 || this.level === levels.length - 1) return false;
      this.level++;
    }
    this.resetTiming();
    return true;
  }
}
