import {finishLoading} from '../assets/loading/intro.js';
import {downloadModel} from './download-model.mjs';
import {createLoadingCopy} from './loading-copy.mjs';
import {setBrandText} from '../shared/brand-text.ts';

const controller = new AbortController();
let lastProgress;
const loadingCopy=createLoadingCopy(message=>{for(const status of document.querySelectorAll('[data-scene-status]'))setBrandText(status,message)});
export const finishStartupStatus=()=>loadingCopy.ready();
export function setStartupStatus(message, progress = null) {
  if (progress === lastProgress) return;
  lastProgress = progress;
  for (const bar of document.querySelectorAll('[data-scene-progress]')) {
    if (progress === null) bar.removeAttribute('value'); else bar.value = progress;
  }
}
// Start the lightweight logo immediately, but hold its handoff until real GPU
// preparation finishes. A slow download must never expose an unprepared scene.
let releasePreparation;
const prepared=new Promise(resolve=>{releasePreparation=resolve});
export const completePreparation=()=>releasePreparation();
export const presentationReady = finishLoading({ready:prepared});
export const videoEntrance = new URLSearchParams(location.search).get('entrance') === '2';
export const modelDownload = videoEntrance ? Promise.resolve(null) : downloadModel('/assets/entrance-3d/journey-compact.glb', {
  signal: controller.signal,
  onProgress: value => setStartupStatus(value === null ? 'Loading the world…' : `Loading the world… ${value}%`, value),
});
// The renderer can attach later, after its own module has downloaded.
modelDownload.catch(() => {});
export function cancelStartup() { completePreparation();loadingCopy.cancel(); controller.abort(); }
addEventListener('pagehide',event=>{if(!event.persisted)loadingCopy.cancel()});
