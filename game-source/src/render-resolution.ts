export type GameQuality = 'auto' | 'full' | 'low';
export const gameQualityStorageKey = 'sofacet.game-quality.v1';
export const parseGameQuality = (value: unknown): GameQuality => value === 'full' || value === 'low' ? value : 'auto';

// Bound total pixels as well as DPR: a large desktop can cost more than a phone.
const levels = [
  { ratio: .65, pixels: 450_000 },
  { ratio: .8, pixels: 700_000 },
  { ratio: 1, pixels: 1_000_000 },
  { ratio: 1.25, pixels: 1_250_000 },
];

export function gameRenderResolution(mode: GameQuality, level: number, width: number, height: number, deviceRatio: number) {
  const nativeRatio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  if (mode === 'full') return { pixelRatio: Math.min(nativeRatio, 1.5), samples: 2, transmissionScale: 1 };
  const budget = mode === 'low' ? levels[0] : levels[Math.max(0, Math.min(levels.length - 1, Math.round(level)))];
  const area = Math.max(1, width) * Math.max(1, height);
  return { pixelRatio: Math.min(nativeRatio, budget.ratio, Math.sqrt(budget.pixels / area)), samples: 0, transmissionScale: .5 };
}

/** Uses consecutive rendered frames, never the clamped physics timestep. */
export class AdaptiveResolution {
  mode: GameQuality;
  level = 2;
  private last: number | null = null;
  private warmup = 1000;
  private windowMs = 0;
  private count = 0;
  private stableMs = 0;

  constructor(mode: GameQuality = 'auto') { this.mode = mode; }

  setMode(mode: GameQuality) {
    this.mode = mode;
    this.level = 2;
    this.resetTiming();
  }

  resetTiming() {
    this.last = null;
    this.windowMs = this.count = this.stableMs = 0;
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
    if (average > 22) {
      this.stableMs = 0;
      const next = Math.max(0, this.level - (average > 40 ? 2 : 1));
      if (next === this.level) return false;
      this.level = next;
    } else {
      this.stableMs = average < 18 ? this.stableMs + duration : 0;
      // Recover slowly, so marginal devices do not keep swapping resolutions.
      if (this.stableMs < 8000 || this.level === levels.length - 1) return false;
      this.level++;
    }
    this.resetTiming();
    return true;
  }
}
