export type PracticeControl = 'left' | 'right' | 'launch';
const steps: PracticeControl[] = ['left', 'right', 'launch'];
export const tutorialStorageKey = 'sofacet.controls-practised.v1';

/** Practice never advances the simulation or contributes inputs to a scored run. */
export class TutorialState {
  index = 0;
  held = false;
  charge = 0;
  tried = false;
  get control() { return steps[this.index]; }
  press(control: PracticeControl) {
    if (control !== this.control || this.held) return false;
    this.held = true;
    this.charge = 0;
    return true;
  }
  tick(delta: number) {
    if (this.held && this.control === 'launch') this.charge = Math.min(1, this.charge + Math.max(0, delta) / 1.1);
  }
  release(cancelled = false) {
    if (!this.held) return false;
    const success = !cancelled && (this.control !== 'launch' || this.charge >= .25);
    this.held = false;
    this.charge = 0;
    this.tried ||= success;
    return success;
  }
  next() {
    if (!this.tried || this.held) return false;
    if (this.index === steps.length - 1) return true;
    this.index++;
    this.tried = false;
    return false;
  }
}

export function hasPractised(storage: Pick<Storage, 'getItem'> | undefined) {
  try { return storage?.getItem(tutorialStorageKey) === 'done'; } catch { return false; }
}
export function rememberPractice(storage: Pick<Storage, 'setItem'> | undefined) {
  try { storage?.setItem(tutorialStorageKey, 'done'); } catch { /* Private browsing can deny storage. */ }
}
