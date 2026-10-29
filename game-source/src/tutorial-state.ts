export type PracticeControl = 'left' | 'right';
const steps: PracticeControl[] = ['left', 'right'];
export const tutorialStorageKey = 'sofacet.controls-practised.v1';

/** Practice never advances the simulation or contributes inputs to a scored run. */
export class TutorialState {
  index = 0;
  held = false;
  tried = false;
  private advanceIn = .4;
  private complete = false;
  get control() { return steps[this.index]; }
  press(control: PracticeControl) {
    if (control !== this.control || this.held || this.tried || this.complete) return false;
    this.held = true;
    return true;
  }
  tick(delta: number): 'advanced' | 'complete' | null {
    const dt = Math.max(0, delta);
    if (!this.tried || this.held || this.complete) return null;
    this.advanceIn -= dt;
    if (this.advanceIn > 0) return null;
    if (this.index === steps.length - 1) { this.complete = true; return 'complete'; }
    this.index++;
    this.tried = false;
    this.advanceIn = .4;
    return 'advanced';
  }
  release(cancelled = false) {
    if (!this.held) return false;
    const success = !cancelled;
    this.held = false;
    this.tried ||= success;
    return success;
  }
}

export function hasPractised(storage: Pick<Storage, 'getItem'> | undefined) {
  try { return storage?.getItem(tutorialStorageKey) === 'done'; } catch { return false; }
}
export function rememberPractice(storage: Pick<Storage, 'setItem'> | undefined) {
  try { storage?.setItem(tutorialStorageKey, 'done'); } catch { /* Private browsing can deny storage. */ }
}

export function createTutorialHistory(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let shown = hasPractised(storage);
  return {
    get seen() { return shown || hasPractised(storage); },
    markShown() { shown = true; rememberPractice(storage); },
  };
}
